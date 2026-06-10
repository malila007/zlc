# vmb vs mali168 เห็นแชทคนละห้อง — inbox id resolution regression

## Goal
หาสาเหตุที่ user ใหญ่ `vmb` กับ sub admin `mali168` เห็นแชทไม่เหมือนกัน แล้วแก้

## Root cause
`backoffice-frontend/src/services/chat/identity/inbox-id.js` → `resolveChatInboxId()` แยกเป็น 2 กิ่งที่ดึงคนละ field:
- sub → `MEMBER_UPLINE_ID` = `vmb` (username namespace)
- non-sub → `MEMBER_TOKEN` = `#10_fvo@$10C+` (token namespace)

→ vmb กับ mali168 ได้ inbox id คนละค่า → connect chat-service เป็นคนละ agent → เห็นแชทคนละชุด

ค่านี้ถูกใช้เป็นทั้ง `userId` และ `token` ตอน `chatService.connect(inboxId)` (`Main.vue:381`).

Regress มาจาก commit `3149c356 "solve reconnect issue"` (7 มิ.ย.) ที่เปลี่ยนกิ่ง non-sub ให้ใช้ `MEMBER_TOKEN` ขณะที่กิ่ง sub ยังเป็น `MEMBER_UPLINE_ID`. เวอร์ชันก่อนหน้า `21cea99e` ใช้ `agent_username` ทั้งคู่ (มี comment ว่า vmb + subs resolve เป็นค่าเดียวกัน). ทั้งระบบ (noti socket / `user-auth.js:329`) ก็ใช้ username namespace อยู่แล้ว.

## Decision
User ยืนยัน canonical inbox = `vmb` (username namespace). → revert กิ่ง non-sub กลับไปใช้ `agent_username` (เหมือน `21cea99e`). กิ่ง sub ถูกอยู่แล้ว.

## Real `me()` contract (GET /api/v1/me) — ยืนยันแล้ว
ตัวอย่าง response ของ vmb เอง: `MEMBER_USERNAME="vmb"`, `MEMBER_TYPE="super_senior"` (ไม่ใช่ sub), `MEMBER_UPLINE_ID="vm"` (= upline ของ vmb เอง ไม่ใช่ "vmb"), `MEMBER_TOKEN="OwAnwE"` (random), `MEMBER_USERNAME_LOGIN="agentdemo"` (คนละค่ากับ MEMBER_USERNAME).
- ยืนยัน root cause: `MEMBER_TOKEN="OwAnwE"` เป็น string สุ่ม ≠ "vmb" → ใช้เป็น routing id ทำให้ห้องแยก
- ยืนยันว่า**ห้ามใช้ MEMBER_UPLINE_ID กับ non-sub** ด้วย: ของ vmb = "vm" → จะหลุดไปห้อง "vm"
- sub: user force `MEMBER_UPLINE_ID="vmb"` เสมอ → sub branch ถูก

## What changed
- `src/services/chat/identity/inbox-id.js`: ลบ block `MEMBER_TOKEN` ออกจากกิ่ง non-sub → `configuredInboxId()` (env) → `agent_username` → **`MEMBER_USERNAME`** (เพิ่มใหม่ ให้ resilient ตอน authStore ยังไม่ hydrate) → `username`.
- `src/services/chat/identity/inbox-id.test.mjs` (ใหม่, node:test): 4 tests ใช้ shape จริงจาก me() — parent→`vmb` (ไม่เอา upline "vm"/token "OwAnwE"), sub→`vmb`, เท่ากัน, + booting parent (เฉพาะ raw user object). RED ก่อนแก้ → GREEN 4/4.
- `PROJECT.md`: เพิ่ม **hard rule** "Chat inbox identity must stay in the username namespace (never MEMBER_TOKEN)" ใน Constraints พร้อม field contract table; ตัด section Backoffice chat identity เดิมให้ชี้มาที่ hard rule (ไม่ duplicate).

## Verification
- `node --test src/services/chat/identity/inbox-id.test.mjs` → 4 pass / 0 fail.
- `node --check inbox-id.js` clean.

## Open / next steps
- ยังไม่ commit/push — รอ user.
- ควร verify ในเบราว์เซอร์: login `vmb` กับ `mali168` แล้วเห็น customer list/แชทห้องเดียวกัน.
- E2E gate (`e2e-chat-test.js` 0 FAIL) ก่อน prod.
- พิจารณาเปิด Jira ZLC ticket ว่า `3149c356` ทำ regression (ถ้ายังไม่มี).

## Notes for next session
- ถ้า production embed floating-chat ด้วย token อื่นที่ไม่ใช่ `vmb` ลูกค้าจะไม่เข้าห้องนี้ — ยืนยันแล้วว่า embed init ด้วย `vmb`.
- `MEMBER_UPLINE_ID` == parent `MEMBER_USERNAME` (username namespace), คนละอันกับ `MEMBER_TOKEN`.
