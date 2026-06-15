# API Doc: Deposit by Slip (Floating-Chat)

เอกสารนี้ครอบคลุมทั้ง 2 API ที่ใช้ใน flow แจ้งฝากแนบสลิป
และ spec สำหรับ implement ใน floating-chat widget โดยตรง

---

## APIs ที่ใช้

### 1. GET DEPOSIT BANKS

```http
POST https://player-api-12.zixma.co/api/v1/bank/get-deposit
Authorization: Bearer {access_token}
```

ดึงบัญชีธนาคารของ member และ agent เพื่อแสดงในฟอร์ม

#### Get-Deposit Request (FormData)

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `deposit_bank_type` | string | yes | `"BANK"` หรือ `"TMN"` |

#### Get-Deposit Response

```json
{
  "status": true,
  "data": {
    "member_bank": [
      {
        "MEMBER_BANK_ID": 18463175,
        "BANK_NAME": "ธนาคารกรุงเทพ (BBL)",
           "IMAGE": "https://imagedelivery.net/g1yWpHq5ZqQxQIXvcCDaOA/b0a710a6-6b06-423f-c670-e2786faa3e00/public",
        "BANK": "BBL",
        "ACCNO": "1307350452",
        "ACCNAME": "วิลาวัลย์ ประเสริญศรี"
      }
    ],
    "web_bank": [
      {
        "ID": 29136,
        "BANK_NAME": "ธนาคารออมสิน (GSB)",
        "IMAGE": "https://imagedelivery.net/g1yWpHq5ZqQxQIXvcCDaOA/9a13000f-f2dc-4fb2-a968-203b55363d00/public",
        "BANK": "GSB",
        "ACCNO": "020475195176",
        "ACCNAME": "นายศุภมิตร ไชยเพชร"
      }
    ]
  },
  "message": ""
}
```

---

### 2. DEPOSIT BY SLIP

```http
POST {backofficeAPI}/api/v1/transfer/deposit-by-slip-th
Authorization: Bearer {access_token}
Content-Type: multipart/form-data
```

> ใช้ `backofficeAPI` (VITE_BACK_OFFICE_API) ไม่ใช่ player-api

#### Deposit-Slip Request (FormData)

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `amount` | number | yes | จำนวนเงิน (ตัวเลขล้วน ไม่มี comma) |
| `bankCode` | string | yes | bank code ของ member เช่น `"BBL"` |
| `accountNumber` | string | yes | เลขบัญชีของ member |
| `file` | File | yes | ไฟล์สลิป (png/jpg/jpeg/webp/svg) |
| `lang` | string | yes | ภาษา เช่น `"th"` |
| `slipType` | string | yes | ประเภทสลิป: `"BANK"` (ธนาคาร) หรือ `"TMN"` (ทรูมันนี่วอลเล็ท) |
| `webAccountNumber` | string | no | เลขบัญชีของ agent (web_bank ACCNO) |

#### Deposit-Slip Response

```json
{ "status": true, "message": "แจ้งสลิปสำเร็จ" }
{ "status": false, "message": "ข้อความ error จาก API" }
```

---

## Floating-Chat Init

ฝั่ง player-frontend ต้องส่ง token และ URL ให้ widget ตอน init:

```js
window.FloatingChat.init({
  // ... options เดิม
  accessToken: localStorage.getItem('access_token'),
  apiUrl: import.meta.env.VITE_AGENT_API_URL_V2,       // สำหรับ get-deposit
  backofficeUrl: import.meta.env.VITE_BACK_OFFICE_API, // สำหรับ deposit-by-slip-th
  lang: localStorage.getItem('language') || 'th',
});
```

---

## Helper Functions (วาง widget-side ได้เลย)

### getDepositBanks

```js
async function getDepositBanks({ apiUrl, accessToken, depositBankType = "BANK" }) {
  const body = new FormData()
  body.append("deposit_bank_type", depositBankType)

  const res = await fetch(`${apiUrl}/api/v1/bank/get-deposit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body,
  })

  const result = await res.json()
  return {
    ok: result.status === true,
    message: result.message || "",
    memberBanks: Array.isArray(result.data?.member_bank) ? result.data.member_bank : [],
    webBanks: Array.isArray(result.data?.web_bank) ? result.data.web_bank : [],
  }
}
```

### sendDepositSlip

```js
async function sendDepositSlip({
  backofficeUrl,
  accessToken,
  bankCode,         // member_bank.BANK
  accountNumber,    // member_bank.ACCNO
  webAccountNumber, // web_bank.ACCNO
  slipType,         // "BANK" | "TMN"
  amount,           // ตัวเลขล้วน ไม่มี comma
  file,             // File object
  lang = "th",
}) {
  const body = new FormData()
  body.append("amount", amount)
  body.append("bankCode", bankCode)
  body.append("accountNumber", accountNumber)
  body.append("webAccountNumber", webAccountNumber)
  body.append("slipType", slipType)
  body.append("file", file)
  body.append("lang", lang)

  const res = await fetch(`${backofficeUrl}/api/v1/transfer/deposit-by-slip-th`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body,
  })

  return await res.json()
}
```

---

## Screen Flow (State Machine)

```text
LOADING
  down getDepositBanks()
  member_bank empty  -> STATE: NO_MEMBER_BANK  (แจ้งให้ติดต่อ support)
  web_bank empty     -> STATE: NO_WEB_BANK     (ไม่มีบัญชีรับฝาก)
  ทั้งสองมีข้อมูล    -> STATE: FORM

FORM
  แสดง member_bank[0]  (บัญชีของคุณ)
  แสดง web_bank[0]     (บัญชีสำหรับโอนเข้า + ปุ่ม copy ACCNO)
  input จำนวนเงิน
  ปุ่มเลือกไฟล์สลิป   (accept: image/png,image/jpg,image/jpeg,image/webp,image/svg)
  ปุ่ม "แจ้งฝาก"
    down validate -> sendDepositSlip()
    status true  -> STATE: SUCCESS
    status false -> แสดง message error, ยังอยู่ที่ FORM

SUCCESS
  แสดงข้อความสำเร็จ, ปิด / กลับ
```

---

## Validation Rules (ก่อน submit)

| Rule | Error message |
| --- | --- |
| ไม่มีไฟล์สลิป | "โปรดแนบรูปภาพสลิปหลักฐานการโอนเงิน" |
| ไฟล์ไม่ใช่ png/jpg/jpeg/webp/svg | "อนุญาตเฉพาะไฟล์ประเภท png jpg jpeg webp และ svg เท่านั้น" |
| amount เป็น NaN | "จำนวนเงินไม่ถูกต้อง โปรดตรวจสอบ" |
| amount === 0 | "กรุณาระบุจำนวนเงินตั้งแต่ 1 บาท ขึ้นไป" |

---

## Empty / Error States

| Case | UI |
| --- | --- |
| `member_bank.length === 0` | "ไม่พบบัญชีของคุณ โปรดติดต่อ support" |
| `web_bank.length === 0` | "ขณะนี้ไม่มีบัญชีรับฝาก โปรดติดต่อ support" |
| API error (fetch fail) | "เกิดข้อผิดพลาด โปรดลองใหม่" |

---

## Security Notes

- ห้าม log `accessToken`, `bankCode`, `accountNumber`
- ห้าม log `backofficeUrl` หรือ `apiUrl` ใน production
- `amount` ต้อง strip comma ออกก่อนส่ง: `amount.toString().replace(/,/g, "")`

---

## Project References

- Store method `getDeposit`: [src/stores/models/user-deposit.js:245](../src/stores/models/user-deposit.js#L245)
- Store method `sendDepositWithSlip`: [src/stores/models/user-deposit.js:530](../src/stores/models/user-deposit.js#L530)
- Component ต้นแบบ: [src/components/deposit/DepositBySlip.vue](../src/components/deposit/DepositBySlip.vue)
- App.vue (FloatingChat.init): [src/App.vue:75](../src/App.vue#L75)
