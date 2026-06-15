# Release checklist — slipVerify (ฝากแนบสลิป)

สิ่งที่ต้องทำ/ตรวจก่อนขึ้น prod เท่านั้น (สถานะงาน dev อยู่ใน `plan.md`)

## ก่อน release

- [ ] **ยิง API จริงด้วย access_token ของ member จริง** — ตอนนี้ผ่านแค่ unit test ที่ stub `fetch` ต้องลองจริงทั้ง 2 เส้น:
  - `POST https://player-api-12.zixma.co/api/v1/bank/get-deposit` (เช็คว่าได้ member_bank/web_bank + IMAGE)
  - `POST https://backoffice-api.zixma.co/api/v1/transfer/deposit-by-slip-th` (เช็ค status/message + card เข้า chat)
- [ ] **E2E gate**: รัน `e2e-chat-test.js` ต้องได้ **0 FAIL** (ครั้งล่าสุด 2026-06-12: 68 PASS / 0 FAIL)
- [ ] ตรวจ `floating-chat/.env` ฝั่ง build prod: `SERVER_URL=wss://chat.zixma.co/ws`, `PLAYER_API_URL`, `BACK_OFFICE_API_URL` ครบ (โค้ด normalize trailing `/` และ `/api` ให้เอง)
- [ ] ฝั่ง player-frontend ต้องอัปเดต `FloatingChat.init` เพิ่ม: `features: ['slipVerify']`, `accessToken`, `lang` (ตาม `floating-chat/README.md` → *slipVerify (deposit by slip)*)

## ลำดับ deploy (release เดียวกัน)

1. `chat-service` — allowlist `messageType` ใหม่ (`deposit_slip`)
2. `backoffice-frontend` — render deposit card (deploy ก่อน widget ไม่งั้น agent เห็น JSON ดิบ)
3. `floating-chat` — widget bundle ใหม่

## หลัง deploy widget

- [ ] Purge Cloudflare cache `/cdn/floating-chat.iife.js`
- [ ] Smoke test บน prod: เปิดฟอร์ม → เห็นบัญชี + โลโก้ → แจ้งฝาก (เคสจริง) → card ขึ้นทั้ง widget และ backoffice (`vmb` inbox)

## หลัง prod นิ่ง

- ตาม workflow `.feat/README.md`: promote ความรู้ถาวรเข้า `PROJECT.md` (ทำแล้วบางส่วน: WS contract `deposit_slip`) แล้วลบโฟลเดอร์ `.feat/slip-verify/`
- PO ตั้งใจ refactor โค้ด slipVerify รอบถัดไป ("เน้นให้ทำงานได้ก่อน")
