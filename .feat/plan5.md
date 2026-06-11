 Plan: Fix #5 — Display dedup ด้วย content+เวลา ซ่อนข้อความซ้ำที่ตั้งใจส่งจริง (BO + FC) + แก้ FC
 CLAUDE.md ที่ล้าสมัย

 Context

 จากผลสแกนความเสถียร (ข้อ 5): ทั้งสอง frontend ใช้ "content + ทิศทาง + หน้าต่างเวลา 5 วิ"
 เป็นตัวตัดสินข้อความซ้ำ ทำให้ข้อความซ้ำที่ผู้ใช้ตั้งใจส่ง (เช่น ลูกค้าพิมพ์ "ok" สองครั้งติด) หายจาก UI ทั้งที่ DB
 เก็บครบ:

 - BO protocol/message-handler.js:
   - _isDuplicate (บรรทัด ~108-119) — id check แล้ว fall through ไป content check เสมอ →
 live message ตัวที่สองโดนกิน
   - handleHistory content-bucket map (บรรทัด ~186-202) — ข้อความคนละตัวแต่ text เดียวกันใน
 bucket 5 วิเดียวกัน ตัวที่สองโดนกินตอนโหลด history
 - FC services/message-display.ts isDuplicateMessage (บรรทัด 92-112) — id-in-sets check
 แล้ว fall through ไป content check เสมอ → addMessage (ทั้ง message ขาเข้าและ
 message_sent ของตัวเอง) กินตัวที่สอง

 สาเหตุที่ fallback นี้เคยจำเป็น: เชื่อว่า live event ไม่มี DB _id (id ปลอมจาก Date.now())
 แต่ความจริงปัจจุบัน backend ส่ง id จริง (Mongo ObjectId) มากับทั้ง message และ message_sent แล้ว
 (chat-service/src/services/message-service.ts — sentPayload.id, receivedPayload.id)
 → dedup ควรยึด id เป็นหลัก และเก็บ content fallback ไว้เฉพาะคู่ที่ฝั่งใดฝั่งหนึ่งไม่มี server id
 (server เก่า/edge) — พร้อมแก้ floating-chat/CLAUDE.md +
 .cursor/rules/floating-chat-tab-sync.mdc ที่สอนเรื่องนี้ผิดอยู่ (doc-vs-code mismatch)

 ข้อเท็จจริงจากการสำรวจ (ยืนยันแล้ว):
 - FC ไม่มี optimistic add — ข้อความตัวเองแสดงตอน message_sent กลับมา (main.ts:764-797) ใช้
 sentMessage.id จริง; id ปลอม (msg_… / Date.now()) เกิดเฉพาะเมื่อ server ไม่ส่ง id
 - FC addHistoricalMessages เช็ค dup กับ this.messages เดิมเท่านั้น (unshift หลังจบ loop) →
 repeated text ใน history batch เดียวกันไม่โดนกินอยู่แล้ว — บั๊กฝั่ง FC อยู่ที่ addMessage เท่านั้น
 - BO mapMessage (domain/message-service.js:29) / mapServerSentToUiMessage
 (message-handler.js:25) มี id-fallback Date.now()+Math.random() — ที่เดียวที่รู้ provenance
 ของ id
 - เคสที่ content fallback ยังต้องคุ้มครอง (server เก่า): live message id ปลอมถูกแสดงแล้ว →
 history ส่งตัวเดียวกันมาด้วย id จริง → id ไม่ match ต้องพึ่ง content

 Requirement summary

 - ข้อความซ้ำที่ตั้งใจส่ง (id จริงต่างกัน) ต้องแสดงครบทุกตัว ทั้ง live และตอนโหลด history ทั้งสอง
 frontend
 - การกันซ้ำที่ถูกต้องเดิมต้องไม่หาย: id เดียวกันซ้ำ (history สองรอบ / live แล้ว history), เคส
 server เก่า id ปลอม-vs-id จริง
 - ไม่มีการแก้ backend (id ถูกส่งครบอยู่แล้ว)

 Scope

 - BO: protocol/message-handler.js (_isDuplicate, handleHistory bucket,
 mapServerSentToUiMessage), domain/message-service.js (mapMessage)
 - FC: services/message-display.ts (isDuplicateMessage, addMessage,
 addHistoricalMessages), utils/chat.ts (createChatMessageFromIncoming), จุดสร้าง
 ChatMessage จาก history + main.ts handleMessageSent, type ChatMessage/InternalMessage
 - เอกสาร 3 ไฟล์: floating-chat/CLAUDE.md, .cursor/rules/floating-chat-tab-sync.mdc,
 PROJECT.md
 - เทสต์ใหม่ทั้งสองฝั่ง

 Out of scope

 - ไม่แตะ chat-service
 - ไม่แก้ parseMessageId (เลข numeric ภายใน FC — ไม่ได้ใช้ตัดสิน dup)
 - FC message queue dequeue ด้วย content (ข้อ 8) — แยก
 - ไม่เปลี่ยนค่า MESSAGE_DUPLICATE_WINDOW_MS / DUPLICATE_TIME_WINDOW_MS

 Technical approach — หลักการเดียวใช้ทั้งสองฝั่ง

 Provenance-based dedup: ทุก message ที่ map เข้า UI เก็บ flag hasServerId (จริงเมื่อ payload
 มี id จากserver) แล้วใช้กติกา:

 1. id ตรงกัน → ซ้ำ (เหมือนเดิม)
 2. content fallback ใช้เฉพาะคู่ที่ ฝั่งใดฝั่งหนึ่งไม่มี server id (!candidate.hasServerId ||
 !existing.hasServerId) — สอง message ที่มี id จริงต่างกันจะไม่ถูกตัดสินว่าซ้ำด้วย content อีกเลย

 BO — backoffice-frontend/src/services/chat

 1. domain/message-service.js mapMessage: เพิ่ม hasServerId: m.id != null (id fallback
 คงเดิม)
 2. protocol/message-handler.js:
   - mapServerSentToUiMessage: เพิ่ม hasServerId: payload?.id != null
   - _isDuplicate: content check เดิม เพิ่มเงื่อนไข (!candidate.hasServerId ||
 !m.hasServerId)
   - handleHistory: สร้าง existingContentMap จากเฉพาะ message เดิมที่ !hasServerId; เช็ค
 contentKey เฉพาะเมื่อ history message ตัวนั้น !hasServerId หรือ map มี entry (id ปลอมเดิมรอ
 match) — ผลคือ history ที่มี id จริงไม่กินกันเอง แต่ยังแทน/กันซ้ำกับ live id ปลอมเก่าได้
 3. เทสต์ใหม่ src/services/chat/test/message-handler.dedup.test.mjs (pattern data-URL
 เดิม):
   - RED: live สองตัว id จริงต่างกัน text+isMe เดียวกันภายใน 5 วิ → ต้องแสดงทั้งคู่
   - RED: history สองตัว id ต่างกัน text เดียวกัน bucket เดียวกัน → ต้องอยู่ครบ
   - Guards: id เดียวกัน live→history ไม่ซ้ำ; live id ปลอม (mapMessage จาก payload ไม่มี id)
 แล้ว history text เดียวกันภายใน window → ถูกกัน (เคส server เก่า)

 FC — floating-chat/src

 1. Types: ChatMessage เพิ่ม hasServerId?: boolean; InternalMessage (ใน
 message-display.ts) เพิ่ม hasServerId: boolean
 2. จุดสร้าง ChatMessage ระบุ provenance:
   - utils/chat.ts createChatMessageFromIncoming: hasServerId: message.id != null
   - main.ts handleMessageSent: hasServerId: sentMessage.id != null
   - จุด map history (ตาม call site ของ addHistoricalMessages —
 main.ts/history-manager): history มี id จริงเสมอ → hasServerId: msg._id != null (หา
 helper เดิมที่ map history ก่อน อย่าสร้างซ้ำ)
 3. message-display.ts:
   - addMessage/addHistoricalMessages ส่ง hasServerId เข้า InternalMessage (default
 false เมื่อไม่ระบุ — ปลอดภัยฝั่ง conservative)
   - isDuplicateMessage(internal, originalId): id-in-sets check เดิม; content fallback
 เพิ่มเงื่อนไข (!internal.hasServerId || !m.hasServerId)
 4. เทสต์ใหม่ src/services/message-display.test.ts (vitest มีอยู่แล้ว):
   - RED: addMessage สองครั้ง id จริงต่างกัน text+ทิศทางเดียวกันภายใน 5 วิ → ทั้งคู่ถูก add (return
 true ทั้งคู่, messages.length === 2)
   - Guards: id เดิมซ้ำ → false; live id ปลอม (hasServerId:false) แล้ว
 addHistoricalMessages ตัวเดียวกัน id จริง text เดียวกัน → ถูกกัน; history response ซ้ำสองรอบ
 (id เดิม) → ไม่ duplicate; system message ไม่กระทบ

 เอกสาร (ต้องแก้ใน change เดียวกัน)

 - floating-chat/CLAUDE.md section Message Deduplication: แก้ premise — live event มี id
 จริงแล้ว; id ปลอมเป็น fallback เฉพาะ server เก่า; กติกาใหม่ = id-first + provenance-scoped
 content fallback; อัปเดต code snippet ✅/❌ ให้ตรง implementation ใหม่ (กฎ "ห้าม
 early-return ข้าม content check" เปลี่ยนเป็น "content check ใช้เฉพาะคู่ที่ขาด server id —
 ห้ามเอาไปใช้กับคู่ id จริงทั้งคู่")
 - .cursor/rules/floating-chat-tab-sync.mdc (บรรทัด ~55, 70): ปรับ wording เดียวกัน
 - PROJECT.md bullet "do not break content-based message dedup fallback" (Customer
 Widget Summary → tab sync risk note) → "do not break the provenance-scoped dedup
 fallback (content match applies only when one side lacks a server id)"

 จุดที่ต้องระวังผลกระทบ

 #: 1
 จุดเสี่ยง: เคส server เก่า: live id ปลอม → history id จริง ต้องยังถูกกันซ้ำ
 เหตุผล / วิธีกัน: กติกา "ฝั่งใดฝั่งหนึ่งไม่มี server id → ใช้ content check" ครอบเคสนี้พอดี (existing
   เป็น id ปลอม) — มี guard test ทั้งสองฝั่ง
 ────────────────────────────────────────
 #: 2
 จุดเสี่ยง: FC message_sent ของตัวเอง ไม่มี optimistic add จึงไม่มีคู่ optimistic-vs-echo ให้กังวล
   แต่ multi-tab: follower รับ WS_EVENT message_sent id เดียวกัน → ต้องยังกันด้วย id sets
 เหตุผล / วิธีกัน: id check เดิมไม่แตะ — guard test "id เดิมซ้ำ → false"
 ────────────────────────────────────────
 #: 3
 จุดเสี่ยง: BO follower mirror (HISTORY_RECEIVED) ส่ง mapped message ข้าม tab — มี field
   hasServerId เพิ่ม
 เหตุผล / วิธีกัน: additive; follower ใช้ field นี้ต่อได้เลย ไม่มี consumer ที่ strict-validate
   shape
 ────────────────────────────────────────
 #: 4
 จุดเสี่ยง: handleHistory ของ BO แตะ logic bucket ที่พ่วง trim/sort
 เหตุผล / วิธีกัน: เปลี่ยนเฉพาะเงื่อนไขสร้าง/เช็ค contentMap; sort, trim
   (MAX_MESSAGES_PER_CONVERSATION), onHistoryReceived เดิมทั้งหมด; เทสต์ history เดิม (fix
   #3) ต้องเขียวตลอด
 ────────────────────────────────────────
 #: 5
 จุดเสี่ยง: ภาพ (messageType image): content คือ URL — ส่งรูปเดิมซ้ำสองครั้งจะแสดงสองรูป
   (เดิมโดนกิน)
 เหตุผล / วิธีกัน: พฤติกรรมใหม่นี้คือสิ่งที่ถูกต้อง — ระบุใน session note
 ────────────────────────────────────────
 #: 6
 จุดเสี่ยง: เอกสาร 3 ไฟล์ต้องสอดคล้องกัน ไม่งั้น AI/dev รุ่นถัดไปจะ "แก้กลับ" ตามกฎเก่า
 เหตุผล / วิธีกัน: แก้ทั้ง 3 ไฟล์ใน change เดียว + ใส่เหตุผลตัวเลข (id จริงมีแล้วทั้ง live/history)
   แบบเดียวกับที่ทำตอน FC heartbeat
 ────────────────────────────────────────
 #: 7
 จุดเสี่ยง: default ของ hasServerId เมื่อไม่ระบุ = false (conservative)
 เหตุผล / วิธีกัน: path ที่ลืม set flag จะได้พฤติกรรมเดิม (content fallback) ไม่ใช่พฤติกรรมที่หลวมกว่า
 ────────────────────────────────────────
 #: 8
 จุดเสี่ยง: เทสต์ FC เดิม 14 ตัว + เทสต์ BO 25 ตัว ต้องเขียวหมด
 เหตุผล / วิธีกัน: รันทั้ง suite ทั้งสอง repo หลังแก้

 Test strategy

 1. FC: npx vitest run (เทสต์ใหม่ + 14 เดิม) + npm run build
 2. BO: node --test src/services/chat/test/*.mjs (เทสต์ใหม่ + 19 เดิม) +
 NODE_OPTIONS=--max-old-space-size=4096 npm run build
 3. Manual (ถ้า stack เปิด): FC พิมพ์ "ok" สองครั้งติดใน 5 วิ → เห็นสองข้อความทั้งฝั่ง FC และ BO;
 reload BO → history ยังครบสอง; ทดสอบ 2 แท็บ → ไม่มี duplicate
 4. Pre-release: e2e-chat-test.js เต็มชุด 0 FAIL

 Definition of Done

 - [ ] ข้อความ id จริงต่างกันไม่ถูกกินด้วย content ทั้ง live/history ทั้งสอง frontend (เทสต์
 RED→GREEN)
 - [ ] Guard เคส id ซ้ำ + เคส server เก่า (id ปลอม) เขียวครบ; เทสต์เดิมทุกชุดผ่าน; build
 ผ่านทั้งสอง repo
 - [ ] เอกสาร 3 ไฟล์ (floating-chat/CLAUDE.md,
 .cursor/rules/floating-chat-tab-sync.mdc, PROJECT.md) อัปเดตสอดคล้องกับกติกาใหม่
 - [ ] Session note .notes/sessions/

 Critical files

 - backoffice-frontend/src/services/chat/protocol/message-handler.js (_isDuplicate
 ~108, handleHistory ~186, mapServerSentToUiMessage ~22)
 - backoffice-frontend/src/services/chat/domain/message-service.js (mapMessage ~29)
 - backoffice-frontend/src/services/chat/test/message-handler.dedup.test.mjs (ใหม่)
 - floating-chat/src/services/message-display.ts (isDuplicateMessage 92, addMessage
 114, addHistoricalMessages 159)
 - floating-chat/src/utils/chat.ts (createChatMessageFromIncoming 14),
 floating-chat/src/main.ts (handleMessageSent 764 + จุด map history)
 - floating-chat/src/services/message-display.test.ts (ใหม่)
 - floating-chat/CLAUDE.md, .cursor/rules/floating-chat-tab-sync.mdc, PROJECT.md