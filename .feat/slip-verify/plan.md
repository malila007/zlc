# slip-verify — ฝากแนบสลิปใน floating-chat

API spec ต้นทาง: [`api-bank-get-deposit.md`](api-bank-get-deposit.md)

## Scope (ตกลงกับ PO 2026-06-12)

- ทำเฉพาะฝั่ง repo นี้: `floating-chat` + `chat-service` + `backoffice-frontend` (เฉพาะ chat module)
- player-frontend ไม่อยู่ใน scope — ส่งมอบ init contract ผ่าน `floating-chat/README.md`
- API ภายนอกที่ widget ยิงใหม่ 2 เส้น:
  1. `POST {PLAYER_API}/api/v1/bank/get-deposit` — ดึงบัญชี member + agent
  2. `POST {BACK_OFFICE_API}/api/v1/transfer/deposit-by-slip-th` — แจ้งฝากแนบสลิป
- ทดสอบด้วย unit test ที่ stub `fetch`; ยิง API จริงด้วยมือภายหลังเมื่อมี token

## Design (approved)

### Config / init contract

- `floating-chat/.env`: เพิ่ม `PLAYER_API_URL`, `BACK_OFFICE_API_URL` (bake ตอน build เหมือน `SERVER_URL`)
- `init()` เพิ่ม `accessToken?: string`, `lang?: string` (default `'th'`)
- ปุ่ม "แจ้งฝากแนบสลิป" render เมื่อ `features` มี `slipVerify` **และ** มี `accessToken` **และ** env URLs ครบ — ไม่ครบ = ซ่อนปุ่ม

### ฟอร์ม deposit (ตาม API doc เป๊ะ)

- ตัดช่อง วันที่/เวลาโอน และ หมายเหตุ ออกจาก scaffold เดิม
- State machine: `LOADING → NO_MEMBER_BANK | NO_WEB_BANK | FORM → SUCCESS` (เปิด view ทีไร fetch banks ใหม่)
- FORM: การ์ดบัญชีของคุณ (`member_bank[0]`), การ์ดบัญชีรับฝาก (`web_bank[0]` + ปุ่ม copy ACCNO), จำนวนเงิน, แนบสลิป (`accept` png/jpg/jpeg/webp/svg)
- Validation + error message ตามตารางใน API doc; `amount` strip comma ก่อนส่ง
- ห้าม log `accessToken` / เลขบัญชี / URL

### Deposit card ใน chat (ส่งทั้งสำเร็จและล้มเหลว)

- หลังได้ผล deposit-by-slip-th: upload สลิปผ่าน `/api/upload-image` (reuse `image-handler.ts`) → ส่ง WS `message` ปกติด้วย:
  - `messageType: 'deposit_slip'`
  - `content` = JSON string `{ imageUrl?, amount, bank, accountTail, status: 'success'|'failed', resultMessage }`
  - `accountTail` = เลขบัญชี member 4 ตัวท้ายเท่านั้น (ไม่ใส่เลขเต็มในประวัติ chat)
- upload รูปล้มเหลว → ส่ง card โดยไม่มี `imageUrl` (ไม่ block)
- ใช้ send pipeline เดิมทั้งหมด (tab leader/follower, dedup ด้วย server id) — ห้ามแตะ tab-sync logic
- render การ์ดพิเศษทั้ง widget (live + history) และ backoffice (parse JSON ปลอดภัย, parse ไม่ได้ → fallback text; customer-list preview = "แจ้งฝากแนบสลิป")

### chat-service

- ขยาย `messageType` union เป็น `'text' | 'image' | 'deposit_slip'` + allowlist validation ใน `message-service.ts`

### Deploy order

chat-service → backoffice → widget ใน release เดียวกัน (backoffice เก่าจะเห็น JSON ดิบจน deploy ครบ)

## แผนงาน 2 phase

### Phase 1 — UI ทั้งหมด (รอ PO approve ก่อนไป Phase 2)

ทำ UI ครบทุก state; ส่ง card ผ่าน chat-service local จริง

- [x] ฟอร์ม deposit ใหม่ใน widget: states + validation + copy ACCNO
- [x] Deposit card render ใน widget (live + history) — สำเร็จ และ ล้มเหลว
- [x] Deposit card render ใน backoffice chat + customer-list preview
- [x] Demo + screenshots (`screenshots/`): ฟอร์ม upload, SUCCESS, card สำเร็จ/ล้มเหลว ทั้งสองฝั่ง → **PO approve gate (รออยู่)**

หมายเหตุ Phase 1: chat-service ยังไม่ถูกแก้ — runtime ปัจจุบัน pass-through `messageType` อยู่แล้ว การ formalize union + allowlist อยู่ใน Phase 2

### Phase 2 — Wire API จริง + ship

- [x] `deposit-service.ts`: `createDepositApi()` ยิง API จริง (get-deposit / deposit-by-slip-th / upload สลิปเข้า chat)
- [x] `init()` รับ `accessToken` / `lang` (+ override `playerApiUrl` / `backofficeUrl`); `.env` เพิ่ม `PLAYER_API_URL` / `BACK_OFFICE_API_URL`; config ไม่ครบ → ซ่อนปุ่ม slipVerify
- [x] chat-service: ขยาย union + allowlist (`text`/`image`/`deposit_slip` เท่านั้น) + tests (372 ผ่าน)
- [x] Unit tests widget: validation, card parser, `createDepositApi` with stubbed fetch (44 ผ่าน)
- [x] Multi-tab test: ส่ง card จาก follower tab → leader/follower เห็นใบเดียวกัน 1 ใบ ไม่ duplicate
- [x] Docs: `floating-chat/README.md` (init contract + slipVerify section), `PROJECT.md` (WS contract `deposit_slip`)
- [x] เติมค่า `BACK_OFFICE_API_URL` ใน `floating-chat/.env` (`https://backoffice-api.zixma.co/api/` — โค้ด normalize trailing `/api` ให้เองก่อนต่อ path)

งานก่อนขึ้น prod ทั้งหมด → **[`release_slip.md`](release_slip.md)**

## Status

- 2026-06-12: grooming + design approved; Phase 1 UI approved (form + bank logos + deposit card ทั้งสองฝั่ง)
- 2026-06-12: Phase 2 code เสร็จ + self-review/cleanup แล้ว — เหลือเฉพาะรายการใน `release_slip.md`
