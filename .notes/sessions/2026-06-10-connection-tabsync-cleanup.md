# Connection / tab-sync cleanup sweep — commit backlog, ZLC-16, ZLC-13, ZLC-19 Sync deadlock, E2E green

## Goal
สแกนปัญหา connection/tab-sync ทั้งหมดแล้วเก็บกวาดตามลำดับ: commit งานค้าง, ปิด dead-end ตัวสุดท้าย (ZLC-16), อุดรูรั่ว E2E gate (ZLC-13), เปิด ticket ความเสี่ยง — แล้ว gate ที่เข้มขึ้นจับบั๊กใหญ่ได้จริง (ZLC-19) จนแก้จบ E2E 0 FAIL

## What changed
- **backoffice-frontend `master` `6bd428b2`**: commit fix leader hand-off (ZLC-14 follow-up) ที่ค้างใน working tree ตั้งแต่ 9 มิ.ย. (`tab-leader.js` + `bc-transport.js`); คืน WHY comment เรื่อง steal guard.
- **floating-chat `main` `228cb4c` (ZLC-16, TDD RED→GREEN)**: cold-start TCP failure เข้า reconnect loop แทน terminal banner — `service.ts` catch เรียก `triggerReconnect()`; `connection-manager.ts` ตัด guard `!wasConnectedBefore` ใน `continueReconnectAfterFailure`. เทส 10/10, build ผ่าน. อัปเดต `floating-chat/CLAUDE.md`.
- **root `25342f7` (ZLC-13)**: E2E `REF-R.2` refocus active chat (`setBoActiveChat`) ก่อนส่ง + เปลี่ยน WARN → FAIL.
- **backoffice-frontend `master` `78c3561e` (ZLC-19 — บั๊กใหญ่ที่ gate ใหม่จับได้)**: ปุ่ม Sync (`manualForceReconnect` → `forceClaimLeadership`) เคย `initTabLeadership()` ซ้ำทั้งที่ machine เก่าของ tab เดิมยังถือ Web Lock → request ใหม่แพ้ → tab demote เป็น follower → tear down socket ตัวเอง → machine เก่าตอบ PONG กัน steal → **ไม่มี tab ไหนเป็น leader ได้อีก = Sync ฆ่า socket ทั้ง profile** (มีมาก่อน 2 มิ.ย. แต่ WARN ซ่อนไว้). แก้: leader → `forceReconnect()`, follower → `requestLeaderReconnect()`; เลิก re-init; แก้ pattern `?.() ?? ` ใน `chat-service.js` เป็น `_forceReconnectTransport()` if/else (เดิมเรียกซ้ำสองทางเสมอ). อัปเดต `.cursor/rules/backoffice-chat-tab-sync.mdc`.
- **Jira**: เปิด ZLC-17 (noti `socket.off()` no-op), ZLC-18 (jitter หลัง cap), ZLC-19 (Sync re-init — แก้แล้วใน session นี้); คอมเมนต์ ZLC-14.

## Decisions
- ไม่ push repo ไหนเลย — push `main`/`master` = trigger deploy; user เป็นคน deploy เอง.
- ZLC-16 แก้ minimal 2 จุด; invalid WS URL จะ retry forever (ยอมรับตาม semantic "never give up" ของ ZLC-15).
- E2E run แรก fail 12 ข้อเพราะ `backoffice-frontend/.env` ชี้ prod (`wss://chat.zixma.co/ws`) ส่วน FC ชี้ local → user อนุมัติให้สลับเป็น localhost ชั่วคราว แล้ว**คืนค่า prod แล้ว** (diff ยืนยัน byte-identical). หมายเหตุ: run แรกยิงข้อความ `E2E-*` เข้า prod ห้อง guest ไปบางส่วน.

## Verification done
- floating-chat `npm test` 10/10 + build ผ่าน; backoffice `node --check` clean + `backoff.test.mjs` 6/6; root `node --check` clean.
- **E2E gate เต็ม (local ทั้งสามฝั่ง): PASS 66 / FAIL 0 / WARN 1 / TOTAL 67** — `REF-R.2` เขียว (BO=true, FC=true) และ WARN "connected check" หลัง Sync หายไปด้วย (หลักฐานว่า deadlock fix จริง). WARN เดียวที่เหลือ = REF-O.2 unread timing (flake เดิม ไม่ block).
- บั๊ก Sync ยืนยันด้วยหลักฐาน: ข้อความ REF-R.2 ไม่ลง Mongo local เลย (pending ค้าง) ก่อนแก้ → ลงครบหลังแก้.

## Release-readiness verification (เพิ่มรอบบ่าย — browser automation แทน manual)
- **P0 `E2E-CHAT-SHARED-INBOX-VMB-MALI` ผ่านครบ**: login `vmb` + `mali168` คนละ context, 2 BO tabs/account + 2 FC tabs — ทุก tab `agentId="vmb"`, `isConnected=true`; FC→เห็นครบทั้ง 4 BO tabs; `vmb`→FC ได้รับ + `mali168` เห็น; `mali168`→FC ได้รับ + `vmb` เห็น (ห้องเดียวกันยืนยันแล้ว)
- **Leader hand-off ผ่าน**: navigate ออก (unmount→disconnect→release) → tab อื่นรับช่วง + connected, socket ไม่ fan-out (4→4); ปิด tab ทั้ง tab → รับช่วงเช่นกัน
- **ZLC-16 cold-start ผ่าน**: kill chat-service → เปิดหน้า FC ใหม่ → restart server → widget กลับมาส่งข้อความได้เอง**โดยไม่ refresh**
- backoffice `npm run build` ผ่าน (รวม 2 commits ล่าสุด)
- ข้อค้นพบระหว่างทดสอบ (ไม่ใช่บั๊ก): ปุ่ม X ของ chat panel = `toggleChat` ซ่อน UI เท่านั้น ไม่ disconnect; `hasChatOpen` ใน `Main.vue` คือ permission `HAS_CHAT_OPEN` ไม่ใช่สถานะ panel; `chatService.disconnect()` เกิดตอน unmount/permission flip เท่านั้น
- สคริปต์ verify อยู่ที่ `/tmp/readiness-verify*.js` (one-off ไม่เก็บเข้า repo ตามแนว lean); `.env` คืนค่า prod แล้ว (byte-identical); dev servers ปิดแล้ว

## Open / next steps
- Manual ≥2-tab checks ก่อน prod (ZLC-14 hand-off + ZLC-19 Sync + ZLC-16 cold-start) ตาม checklist ใน `.cursor/rules/backoffice-chat-tab-sync.mdc`.
- หลัง deploy floating-chat: purge Cloudflare cache `/cdn/floating-chat.iife.js`.
- ZLC-17/18 ยังเป็น To Do (ชิ้นเล็ก อิสระ). Push ทุก repo รอ user (push = deploy).
- Dev servers (3000/5173/3333) ยังรันค้างไว้จาก session นี้ — ปิดได้เมื่อไม่ใช้ แต่ถ้าจะ manual test ระวัง BO `.env` ตอนนี้ชี้ prod แล้ว.

## Notes for next session
- Invariant ใหม่: **ห้าม `initTabLeadership()` ซ้ำใน tab เดียว** — อยู่ใน `.cursor/rules/backoffice-chat-tab-sync.mdc` แล้ว; `REF-R.2` เป็น hard FAIL คุ้ม path นี้.
- ห้าม revert guard `wasConnectedBefore` ใน floating-chat `continueReconnectAfterFailure` (invariant อยู่ใน `floating-chat/CLAUDE.md`).
- E2E ต้องเช็คก่อนรันว่า `backoffice-frontend/.env` `VITE_WS_CHAT_URL` ชี้ localhost ไม่งั้น cross-system fail 12 ข้อแบบหลอก (BO prod / FC local).
