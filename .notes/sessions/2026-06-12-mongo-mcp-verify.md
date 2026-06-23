# 2026-06-12 — Mongo MCP + verify local DB (slipVerify)

## Goal

ต่อ MongoDB MCP และ verify ความถูกต้องของข้อมูล slipVerify ใน local MongoDB

## What changed

- ลงทะเบียน MCP server `mongodb` (local scope, `~/.claude.json`): `npx -y mongodb-mcp-server --connectionString mongodb://localhost:27017 --readOnly` — ใช้ได้หลัง restart Claude Code session
- ไม่มีการแก้โค้ด

## Decisions

- MCP ตั้ง `--readOnly` กัน accidental write; ถ้าต้องการ share ทีม ค่อยย้ายเข้า `.mcp.json` ของโปรเจกต์
- ข้อความใน DB เก็บ type ไว้ที่ field `messages[].type` (wire protocol ใช้ `messageType` → save แปลงเป็น `type` ใน `message-service.ts`)

## Verification results (all pass)

- MCP server v1.12.0 ต่อ mongo ได้ + `list-databases` ตอบ `chat_db` (smoke test ผ่าน stdio JSON-RPC)
- `chat_db`: users 4, chat_sessions 2, indexes ครบ (`agentId_1_customerId_1`, `expireAt_1` TTL ฯลฯ)
- Message distribution: text 280, image 2, deposit_slip 6
- deposit_slip ทุกใบเป็น JSON valid ตรง contract `{imageUrl, amount, bank, accountTail, status, resultMessage}` มีทั้ง success/failed
- Live WS round-trip (chat-service local port **3333**, ไม่ใช่ 3000 — 3000 คือ Vite backoffice): ส่ง deposit_slip ใหม่ → `message_sent` → ลง DB ด้วย `type: deposit_slip`; ส่ง `messageType: bogus_type` → ถูก reject "Invalid message type" และไม่ลง DB
- Test message marker `MCP-VERIFY-1781238571257` ค้างอยู่ใน session vmb↔cust_repro (local dev data ปะปนกับ E2E data เดิม — ไม่เป็นไร)

## Re-verify ผ่าน MCP tools จริง (หลัง restart — pass)

- `mcp__mongodb__*` ใช้งานได้ใน session แล้ว: list-databases / list-collections / count / aggregate ให้ผลตรงกับรอบ mongosh ทุกค่า (users 4, sessions 2, text 280 / image 2 / deposit_slip 6, indexes ครบ, deposit_slip ทั้ง 6 ใบ JSON ตรง contract)
- ข้อจำกัด: `collection-indexes` ใช้กับ local mongo ไม่ได้ (tool ยิง `$listSearchIndexes` ซึ่ง Atlas-only) → ใช้ `aggregate` + `$indexStats` แทน

## Open / next steps

- ค้างจาก slipVerify เดิม: เติม `BACK_OFFICE_API_URL` ใน `floating-chat/.env` + ทดสอบยิง API จริงด้วย token member จริง

## Notes for next session

- chat-service dev รันที่ port 3333 (`.env PORT=3333`); port 3000 เป็น Vite ของ backoffice-frontend — `/health` บน 3000 ตอบ 200 แต่เป็น SPA fallback อย่าหลงเชื่อ
- customer auth ผ่าน WS: token = agentId (inbox id) เช่น `cust_repro` ใช้ token `vmb`
