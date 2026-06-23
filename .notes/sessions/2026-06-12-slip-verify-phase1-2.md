# 2026-06-12 — slipVerify (ฝากแนบสลิป) Phase 1 + 2

## Goal

Implement ฝากแนบสลิปใน floating-chat ตาม `.feat/api-bank-get-deposit.md`: ฟอร์ม + ยิง player-api/backoffice API + ส่ง deposit card เข้า chat (สำเร็จและล้มเหลว) render ทั้ง widget และ backoffice

## What changed

- `floating-chat`: ฟอร์ม deposit ใหม่ (state machine LOADING/EMPTY/FORM/SUCCESS, validation ตาม doc, bank cards + โลโก้จาก `IMAGE`, copy ACCNO), `deposit-service.ts` (`createDepositApi` จริง), init เพิ่ม `accessToken`/`lang`/`playerApiUrl`/`backofficeUrl`, `.env` เพิ่ม `PLAYER_API_URL`/`BACK_OFFICE_API_URL`, deposit card render (style ตรงกับ BO ของ PO), config ไม่ครบ → ซ่อนปุ่ม
- `chat-service`: `messageType` union + allowlist `text|image|deposit_slip` ใน `message-service.ts`
- `backoffice-frontend`: deposit card ใน `conversation.vue` (PO ปรับ style เอง), preview "แจ้งฝากแนบสลิป" ใน `Main.vue`
- Docs: `floating-chat/README.md` (init contract + slipVerify section), `PROJECT.md` (WS contract `deposit_slip`), `.feat/slip-verify/plan.md`

## Decisions

- Card = `messageType: 'deposit_slip'` + JSON content `{ imageUrl?, amount, bank, accountTail, status, resultMessage }`; ส่งทั้งสำเร็จ/ล้มเหลว ผ่าน send pipeline เดิม (ไม่แตะ tab-sync)
- `DepositBankAccount` ใช้ raw field ของ API (`BANK_NAME`/`BANK`/`ACCNO`/`ACCNAME`/`IMAGE`) ไม่ map ชื่อ
- API URLs จาก build-time env (override ผ่าน init ได้); upload สลิปเข้า chat reuse `/api/upload-image`
- Deploy order: chat-service → backoffice → widget

## Open / next steps

- เติม `BACK_OFFICE_API_URL` ใน `floating-chat/.env` (ค่า `VITE_BACK_OFFICE_API` ของ player-frontend) — ว่างอยู่ ปุ่มจะซ่อนใน build จริง
- ทดสอบยิง API จริงด้วย access_token ของ member จริง
- PO บอกจะ refactor ภายหลัง ("เน้นให้ทำงานได้ก่อน")

## Notes for next session

- Verification ผ่านแล้ว: widget tests 44, chat-service tests 372, builds ทั้งคู่, multi-tab follower-send (card เพิ่ม 1 ใบทั้งสอง tab ไม่ duplicate), E2E 68 PASS / 0 FAIL
- Demo dev ต้องใช้ API จริงหรือ init override URL/accessToken; screenshots ใน `.feat/slip-verify/screenshots/`
