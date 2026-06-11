# Plan 6: chat-service — `authenticate` ซ้อนกัน race ได้ → connection counter รั่วถาวร + heartbeat interval leak

## Context

จากผลสแกนความเสถียร (ข้อ 6): handler `socket.on("message")` ใน `chat-service/src/routes/websocket.ts:79-223` เป็น async — ระหว่างที่เฟรม `authenticate` แรก `await handleAuthentication()` (DB upsert) เฟรม `authenticate` ที่สองที่มาติด ๆ กันจะเห็น `authenticated === false` อยู่ และวิ่งเข้า auth path ซ้ำ ทำให้ commit block (บรรทัด ~96-178) ทำงาน**สองรอบบน socket เดียว**:

- `connectionPool.incrementConnections(userId)` ถูกเรียก 2 ครั้ง แต่ flag `connectionPoolCounted` เป็น boolean ตัวเดียว → ตอน close ลดแค่ 1 → **`currentTotalConnections` รั่ว +1 ถาวรต่อครั้ง** (เพดาน 10,000 → สะสมพอจะทำให้ทั้งระบบโดน `SERVICE_CAPACITY_REACHED`) และ `userConnections` ของ user นั้นรั่วด้วย (customer เพดาน 5 → ลูกค้ารายนั้นโดน `CONNECTION_LIMIT_REACHED` ค้าง)
- `heartbeatManager.start(socket)` ถูกเรียก 2 ครั้ง → `heartbeats.set(socket, info)` ทับตัวแรก → **`pingInterval` ตัวแรก leak ตลอดกาล** (stop/stopAll เคลียร์ได้เฉพาะตัวที่อยู่ใน map)
- ผลข้างเคียงอื่น: client ได้ `authenticated` ตอบกลับ 2 ครั้ง (frontend ปัจจุบันทนได้แต่ไม่ควรเกิด)

Client ปกติ (BO/FC) ส่ง authenticate เฟรมเดียว — เคสนี้เกิดจาก client บั๊ก/ประสงค์ร้าย แต่ผลสะสมกระทบ capacity ของทั้ง service จึงต้องอุดฝั่ง server

## Requirement summary

- เฟรม `authenticate` ที่มาซ้ำระหว่าง auth แรกยังไม่จบ ต้องไม่ทำให้ commit ทำงานซ้ำ (นับ pool ครั้งเดียว, heartbeat ครั้งเดียว, ตอบ `authenticated` ครั้งเดียว)
- `heartbeatManager.start` ต้อง idempotent ต่อ socket เดิม (defense-in-depth)
- พฤติกรรมต่อ client ปกติทุกตัวต้องไม่เปลี่ยน

## Scope

- `chat-service/src/routes/websocket.ts` — กัน re-entrancy ของ auth path
- `chat-service/src/services/heartbeat-manager.ts` — `start()` idempotent
- เทสต์: integration (double-auth ไม่รั่ว counter) + unit (heartbeat start ซ้ำไม่ leak interval)

## Out of scope

- ไม่แตะ frontend ใด ๆ (ไม่มี protocol change)
- ไม่ redesign การนับของ `ConnectionPool`
- เฟรมชนิดอื่นที่มาก่อน auth สำเร็จ → ยังคงพฤติกรรมเดิม (`AUTH_REQUIRED` + close) — ไม่ขยาย scope ไปทำ message queueing ระหว่าง auth

## Technical approach

### 1. Re-entrancy guard ใน `websocket.ts`

เพิ่มตัวแปร closure ข้าง `authenticated` / `connectionPoolCounted` (ไม่เพิ่ม field ใน `ExtendedSocket`):

```ts
let authInProgress = false;
...
if (!authenticated) {
    if (msg?.type === "authenticate" || msg?.auth) {
        if (authInProgress) {
            logger.warn("auth.invalid", "Duplicate authenticate while authentication in progress", {
                socketId, clientIp, code: "AUTH_IN_PROGRESS",
            });
            return;            // drop เงียบ ๆ — ไม่ close (กันลงโทษ client ที่เผลอส่งซ้ำตอน reconnect)
        }
        authInProgress = true;
        try {
            const authResult = await handleAuthentication(...);
            ... commit เดิมทั้งหมด ...
        } finally {
            authInProgress = false;   // auth ล้มเหลว → client retry บน socket เดิมได้เหมือนเดิม
        }
    } else { ... เดิม ... }
}
```

- drop แบบไม่ close: เฟรมซ้ำหายไปเฉย ๆ ฝั่ง client ที่ถูกต้องรอ `authenticated` จากเฟรมแรกอยู่แล้ว
- `finally` รีเซ็ต flag เสมอ — เคส auth fail (`sendErrorAndClose` หน่วงปิด 100ms ใน `ws-utils.ts:32`) เฟรม retry ในช่องว่างนั้นยังถูกประมวลผลตามเดิม

### 2. `heartbeat-manager.ts` — `start()` idempotent

บรรทัดแรกของ `start(socket)`: `this.stop(socket);` — เคลียร์ interval/timer เดิมของ socket นั้นก่อนตั้งใหม่ (`stop` ของ socket ที่ไม่มีใน map เป็น no-op อยู่แล้ว) — ฆ่า bug class นี้ทั้งตระกูลแม้ guard ข้อ 1 พลาดเคสที่คาดไม่ถึง

## API / data impact

- ไม่มี protocol/DB change — log code ใหม่ `AUTH_IN_PROGRESS` ใน server log เท่านั้น (ไม่ส่งให้ client)

## Integration points

- BO/FC ไม่ต้องแก้ — ส่ง authenticate เฟรมเดียวเสมอ; follower tabs ไม่คุยกับ server ตรง

## จุดที่ต้องระวังผลกระทบ

| # | จุดเสี่ยง | เหตุผล / วิธีกัน |
|---|---|---|
| 1 | **Auth timeout เดิมต้องไม่เพี้ยน** — `authTimeout` ถูก clear ใน `handleAuthentication` (สำเร็จ) / ใน close handler (fail) | guard ไม่แตะ timer; เทสต์ auth ปกติ + invalid เดิมต้องเขียว |
| 2 | **เคส auth fail แล้ว client retry บน socket เดิม** (ช่องว่าง 100ms ก่อน close) | `finally` รีเซ็ต flag → retry ประมวลผลได้เหมือนพฤติกรรมปัจจุบัน |
| 3 | **เฟรม non-auth ระหว่าง auth in-flight** เดิมโดน `AUTH_REQUIRED` + close | ไม่แตะ branch นั้น — พฤติกรรมเดิมเป๊ะ (อยู่นอก scope) |
| 4 | **`stop()` ใน `start()` ต้องไม่เปลี่ยน semantics ของ pong** | start ใหม่ reset `lastPong = now` เหมือนเดิม; ต่างแค่ interval เก่าถูก clear แทนที่จะ leak |
| 5 | **`connectionPoolCounted` ยังเป็น boolean เดี่ยว** | ถูกต้องแล้วเมื่อ commit วิ่งครั้งเดียว — ห้าม "เผื่อ" เป็น counter (over-engineering) |
| 6 | **Integration test แชร์ `connectionPool` singleton กับเทสต์อื่น** | assert แบบ delta (ค่าก่อน/หลัง) ไม่ assert ค่า absolute; ปิด socket + `waitForClose` ก่อนวัด |
| 7 | **ตอบ `authenticated` ครั้งเดียว** — เทสต์เดิมบางตัว drain ping/ข้อความแรก | เพิ่ม assertion ว่าไม่มี `authenticated` ตัวที่สองภายในช่วงสั้น ๆ ใน testcase ใหม่เท่านั้น ไม่แก้เทสต์เดิม |
| 8 | **graceful shutdown / stopAll** | interval ที่เคย leak ไม่อยู่ใน map อยู่แล้ว — หลังแก้ ทุก interval อยู่ใน map ครบ → stopAll ครอบหมดจริง |

## Test strategy (TDD — RED ก่อนเสมอ)

1. **Integration** `tests/integration/websocket.test.ts` (ใช้ helper `connectWs`/`waitForMessage`/`waitForClose` เดิม):
   - **RED**: "double authenticate frames count the connection once" — อ่าน `connectionPool.getStats().totalConnections` เป็น baseline → เปิด socket ส่ง `authenticate` สองเฟรมติดกันใน tick เดียว → รอ `authenticated` → ปิด socket + `waitForClose` + delay สั้น → stats ต้องกลับมาเท่า baseline (ปัจจุบัน fail: baseline+1)
   - ใน testcase เดียวกัน: ระหว่างรอ ตรวจว่าได้ `authenticated` แค่ครั้งเดียว (เฟรมซ้ำถูก drop)
2. **Unit** `tests/unit/services/heartbeat-manager.test.ts` (มีไฟล์อยู่แล้ว — เพิ่มเคส):
   - **RED**: "start twice on the same socket does not leak the first ping interval" — fake timers, `start(socket)` สองครั้ง → `stop(socket)` → เดินเวลาไปหลาย interval → `socket.send` ต้องไม่ถูกเรียกอีก (ปัจจุบัน fail: interval แรกยังยิง ping)
3. รวบยอด: `npm test` (vitest ทั้งชุด) + `npm run build` (tsc)
4. Pre-release: `e2e-chat-test.js` เต็มชุด 0 FAIL (รวมของ fix #3-#5 ที่ค้างรันอยู่)

## Definition of Done

- [x] เฟรม authenticate ซ้ำระหว่าง auth in-flight ถูก drop (log `AUTH_IN_PROGRESS`) — commit วิ่งครั้งเดียว, ตอบ `authenticated` ครั้งเดียว
- [x] Connection counter กลับสู่ baseline หลังปิด socket ที่เคย double-auth (integration test RED→GREEN)
- [x] `heartbeatManager.start` idempotent (unit test RED→GREEN)
- [x] เทสต์เดิมทั้งชุดผ่าน + tsc build ผ่าน
- [x] `PROJECT.md`: เพิ่มบรรทัดใน WebSocket Contract behavior ว่า authenticate ซ้ำระหว่าง auth in-flight ถูกเพิกเฉย
- [x] Session note `.notes/sessions/`

## Critical files

- `chat-service/src/routes/websocket.ts` (message handler ~79-223 — guard + try/finally)
- `chat-service/src/services/heartbeat-manager.ts` (`start` ~23)
- `chat-service/tests/integration/websocket.test.ts` (testcase ใหม่)
- `chat-service/tests/unit/services/heartbeat-manager.test.ts` (testcase ใหม่)
- `PROJECT.md`
