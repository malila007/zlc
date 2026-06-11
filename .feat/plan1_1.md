# Plan 1_1: FC — zombie-leader takeover (แท็บ leader ค้างถือ Web Lock → ทุกแท็บไม่มี socket ตลอดไป)


## Context

จากสแกนรอบสอง (ข้อใหม่ 1): `floating-chat/src/services/tab-leader.ts` ใช้ Web Locks แบบเรียบง่าย — `ifAvailable` แล้วถ้าไม่ได้ก็ `navigator.locks.request(...)` ต่อคิว**รอตลอดไป** ไม่มีกลไกตรวจว่า leader ปัจจุบันยังมีชีวิตหรือไม่ ถ้าแท็บ leader ของลูกค้าถูกเบราว์เซอร์ freeze/discard แบบที่ยังถือ lock อยู่ (background tab freezing, renderer ค้าง) ทุกแท็บที่เหลือจะรอ lock ไม่มีกำหนด → **ลูกค้าไม่ได้รับข้อความในทุกแท็บ** จนกว่าจะปิดแท็บที่ค้างเอง

ฝั่ง backoffice แก้ปัญหาเดียวกันนี้ไปแล้ว (`backoffice-frontend/src/services/chat/tab/tab-leader.js:156-333` จากงานยุค ZLC-14): **acquire watchdog (5s) → LEADER_PING ผ่าน control channel → เงียบเกิน 1s = zombie → `navigator.locks.request({ steal: true })`** — แผนนี้คือ port กลไกที่พิสูจน์แล้วนั้นมา FC พร้อมเพิ่ม self-demotion สำหรับ leader เก่าที่ฟื้นกลับมา (ช่องที่ BO เองยังไม่ได้ปิด)

หมายเหตุ: localStorage fallback ของ FC ไม่มีปัญหานี้อยู่แล้ว (heartbeat staleness 2s ตรวจ zombie ได้ในตัว) — gap อยู่เฉพาะเส้นทาง Web Locks

## Requirement summary

- แท็บ follower ต้องได้ leadership เองภายในไม่กี่วินาทีเมื่อ leader ตัวจริงค้าง/ตาย โดยไม่ต้องให้ผู้ใช้ทำอะไร
- ห้ามแย่ง lock จาก leader ที่ยังมีชีวิต (สอง leader = สอง socket = ข้อความซ้ำ/fan-out) — ต้อง probe ก่อน steal เสมอ
- Leader เก่าที่ฟื้นจาก freeze หลังถูก steal ต้อง demote ตัวเองเป็น follower (ไม่ค้างเป็น leader ปลอม)
- พฤติกรรมแท็บเดียว / สองแท็บปกติ / LS fallback ต้องไม่เปลี่ยน

## Scope

- `floating-chat/src/services/tab-leader.ts` — เส้นทาง Web Locks เท่านั้น
- ค่า timing ใหม่ใน `src/config.ts`
- Unit tests (vitest) ด้วย mock `navigator.locks` + `BroadcastChannel`
- เอกสาร: `floating-chat/CLAUDE.md`, `.cursor/rules/floating-chat-tab-sync.mdc`, `PROJECT.md` (FC tab-sync note)

## Out of scope

- **ข้อใหม่ 2 (ปุ่ม retry ของ follower เป็น no-op / FORCE_RECONNECT relay)** — คนละ surface (`connection-manager.ts` + `reconnect-manager.ts`); ไม่ผูกงาน UI เข้ากับการแก้ leadership ที่ความเสี่ยงสูงอยู่แล้ว — แต่กลไก takeover ในแผนนี้ลดความจำเป็นของปุ่มนั้นลงมาก (เคส leader ค้างถูกจัดการอัตโนมัติ)
- ข้อใหม่ 3 (LS fallback dual-leader ชั่วครู่จาก `forceClaimLeadership`) — minor, เฉพาะเบราว์เซอร์ไม่มี Web Locks
- ไม่แตะ localStorage fallback path และไม่แตะ BO

## Technical approach

Port โครงจาก BO `tab-leader.js` มาใส่ `initTabLeadership(scope, { onLead, onFollow })` ของ FC (คง signature เดิม — `main.ts:161` ไม่ต้องแก้):

1. **Control channel ต่อ scope**: `zigma-floating-leader-control-${scope}` — message: `LEADER_PING`, `LEADER_PONG`, `LEADER_TAKEOVER`
2. **Acquire watchdog**: เมื่อเป็น follower ที่ queue รอ lock อยู่ → ตั้ง watchdog `FC_LEADER_ACQUIRE_WATCHDOG_MS` (5,000) → ครบแล้ว `probeThenSteal()`:
   - ส่ง `LEADER_PING`; รอ `LEADER_PONG` ภายใน `FC_LEADER_PING_TIMEOUT_MS` (1,000)
   - มี PONG → leader ยังอยู่ → re-arm watchdog รอต่อ
   - เงียบ → `navigator.locks.request(lockName, { steal: true }, ...)` → ได้ lock → `onLead()` → broadcast `LEADER_TAKEOVER { tabId }`
3. **Leader ตอบ ping**: แท็บที่ `tookLeadership` ตอบ `LEADER_PONG` (zombie ตอบไม่ได้ → ถูก steal อย่างถูกต้อง)
4. **Self-demotion (เพิ่มจาก BO)**: held lock เปลี่ยนจาก `holdForever` เป็น promise ที่ resolve ได้ (`releaseHeldLock` แบบ BO) — แท็บที่คิดว่าตัวเองเป็น leader แล้วได้รับ `LEADER_TAKEOVER` จาก tabId อื่น (จะถูกประมวลผลตอนฟื้นจาก freeze):
   - `tookLeadership = false` → resolve held promise (คืน lock เก่าที่ถูก steal ไปแล้ว — no-op) → `onFollow()` (→ `becomeFollower` ปิด socket ใน bc-transport) → `queueLeadership()` กลับเข้าคิวเผื่อรอบหน้า
5. **Steal ไม่ใช้ signal** (spec ห้ามผสม) — mirror BO `queueLeadership(options.steal)` (`tab-leader.js:210-234`)
6. ค่าคงที่ใหม่ลง `config.ts` ตาม convention FC (`FC_LEADER_ACQUIRE_WATCHDOG_MS`, `FC_LEADER_PING_TIMEOUT_MS`)

การ re-elect หลัง demote วิ่งผ่าน `onLead` เดิมของ `bc-transport.initLeadership` (`becomeLeader` + `initSocket`) — ไม่มี code path ใหม่ฝั่ง connection

## จุดที่ต้องระวังผลกระทบ

| # | จุดเสี่ยง | เหตุผล / วิธีกัน |
|---|---|---|
| 1 | **Steal จาก leader ที่ยังมีชีวิตแต่ช้า** (CPU starved ตอบ PONG ไม่ทัน 1s) → สอง leader ชั่วคราว | probe ก่อนเสมอ + `LEADER_TAKEOVER` ทำให้ตัวเก่า demote ทันทีที่ event loop กลับมา; ระหว่าง overlap ข้อความขาเข้าซ้ำถูกกันด้วย id dedup (fix #5) แต่ **follower send อาจถูกส่งสองรอบ** — ระบุใน session note ว่าเป็น residual risk แบบเดียวกับ BO |
| 2 | **`LEADER_TAKEOVER` ต้องไม่ demote ตัวเอง** | แนบ `tabId` ผู้ส่ง; ผู้รับเช็ค `tabId !== ตัวเอง` ก่อน demote |
| 3 | **BroadcastChannel message ปลุกแท็บใน bfcache** (spec: รับ message = evict จาก bfcache) — TAKEOVER/PING อาจ reload แท็บเก่า | ยอมรับ — reload คือผลลัพธ์ที่ดี (แท็บกลับมาเป็น follower สะอาด ๆ ผ่าน reload-yield ไม่มีใน FC… ผ่าน election ปกติ) |
| 4 | **Watchdog ping ทุก 5s จากทุก follower** ระหว่างรอคิว | เบามาก (1 BC message/5s/แท็บ); PONG ตอบเฉพาะ leader |
| 5 | **becomeFollower จาก demote ตั้ง `manualDisconnect=true`** — ถ้าแท็บนั้นถูกเลือกเป็น leader ใหม่ภายหลัง ต้อง connect ได้ | เส้นทางเดิม: `becomeLeader` + `onLead()` → `initSocket()` → `connect()` reset `manualDisconnect=false` อยู่แล้ว (`connection-manager.ts:53`) — ใส่ unit test คุม |
| 6 | **อย่า re-init election machine ซ้ำ** (บทเรียน ZLC-19 ฝั่ง BO) | กลไกทั้งหมดอยู่ใน closure เดียวของ `initTabLeadership`; `_leadershipRunning` guard เดิมใน bc-transport คงไว้ |
| 7 | **หลายแชท scope บนหน้าเดียว** | ทุก channel/lock name ผูก `${scope}` เหมือนเดิม |
| 8 | **เทสต์เดิม 19 ตัว + tab-sync invariant** (leader เดียวต่อ browser) ต้องไม่แตก | รัน suite เต็ม + manual 2 แท็บตาม checklist ใน FC CLAUDE.md |

## Test strategy (TDD)

Unit (vitest, ไฟล์ใหม่ `src/services/tab-leader.test.ts` — mock `navigator.locks` แบบ in-memory LockManager ที่รองรับ `ifAvailable`/`steal`/queue + stub `BroadcastChannel` ที่ route ข้าม instance, fake timers):

1. **RED (เคสหลัก)**: tab A ถือ lock แล้ว "ค้าง" (ไม่ตอบ PING) → tab B ได้ `onLead` ภายใน watchdog+probe (~6s fake time) ผ่านการ steal
2. Leader มีชีวิตตอบ PONG → tab B ไม่ steal และยังเป็น follower
3. Tab A ฟื้นหลังถูก steal แล้วได้รับ `LEADER_TAKEOVER` → `onFollow` ของ A ถูกเรียก และ A กลับเข้าคิว
4. Guard: สองแท็บเปิดปกติ → A lead, B follow (พฤติกรรมเดิม)
5. รวบยอด: `npx vitest run` ทั้งชุด + `npm run build`

Manual (สำคัญ — leadership คือโซน high-risk ตาม FC CLAUDE.md): เปิด FC 2 แท็บ → freeze แท็บ leader (chrome `chrome://discards` หรือ DevTools pause) → แท็บที่เหลือต้องต่อ socket เองภายใน ~6 วิ และรับข้อความจาก BO ได้; ปลด freeze แท็บเก่า → ต้อง demote ไม่เกิดข้อความซ้ำ; ทดสอบ reconnect ปกติ 1 แท็บ/2 แท็บตาม checklist

Pre-release: `e2e-chat-test.js` เต็มชุด 0 FAIL

## Definition of Done

- [ ] Leader ค้าง → follower ยึด leadership อัตโนมัติภายใน ~6s (เทสต์ RED→GREEN + manual freeze ผ่าน)
- [ ] ไม่ steal จาก leader ที่ตอบ PONG; leader เก่าฟื้นแล้ว demote ตัวเอง
- [ ] เทสต์เดิม 19 ตัวผ่าน + build ผ่าน
- [ ] เอกสาร 3 ไฟล์อัปเดต (FC CLAUDE.md tab-leader section, cursor rule, PROJECT.md FC tab-sync note) + session note
- [ ] Plan ถูกบันทึกเป็น `.feat/plan1_1.md`

## Critical files

- `floating-chat/src/services/tab-leader.ts` (เส้นทาง Web Locks ~บรรทัด 83-111 — เขียนใหม่ตามโครง BO)
- `floating-chat/src/config.ts` (ค่า watchdog/ping timeout)
- `floating-chat/src/services/tab-leader.test.ts` (ใหม่)
- อ้างอิงต้นแบบ: `backoffice-frontend/src/services/chat/tab/tab-leader.js:156-333` (`probeThenSteal`, `queueLeadership`, control channel)
- เอกสาร: `floating-chat/CLAUDE.md`, `.cursor/rules/floating-chat-tab-sync.mdc`, `PROJECT.md`
