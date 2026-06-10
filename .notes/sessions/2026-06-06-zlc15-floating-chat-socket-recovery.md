# ZLC-15 — Floating-chat widget: socket ช้า/ค้าง ไม่ auto-recover

## Goal
มี report (จาก web agent อ่าน minified bundle) ว่า floating-chat widget ต่อ socket ช้า/ค้าง. ตรวจสอบกับ source จริง, สร้าง Jira ticket + groom, และ implement fix โดยไม่กระทบการทำงาน.

## What changed

**floating-chat/src/service.ts** (3 auth-timeout callback fixes + 1 backoff-reset fix):
- `reAuthenticate()` auth timeout: เปลี่ยนจาก `console.warn` → `authManager.reset() + forceCloseSocket()` (A3)
- `connect()` auth timeout: เพิ่ม `forceCloseSocket()` หลัง `reset()` (A1)
- `manualReconnect()` auth timeout: เพิ่ม `forceCloseSocket()` หลัง `reset()` (A2)
- `authenticated` handler: เพิ่ม `transport.resetReconnectCounter?.()` (B — reset backoff on auth success)

**floating-chat/src/services/connection-manager.ts**:
- `handleConnectionOpen`: ลบ `this.reconnectAttempt = 0` ออก (B — counter ไม่ reset ที่ TCP open)

**floating-chat/src/config.ts**:
- `RECONNECT_MAX_ATTEMPTS`: 8 → `Number.MAX_SAFE_INTEGER` (C — unbounded)

**floating-chat/CLAUDE.md**: เพิ่ม section "Reconnect & Auth Recovery Model" อธิบาย invariants ใหม่

**Test files added** (vitest, `npm test`):
- `src/service.test.ts`: 4 tests (A1/A2/A3 + sanity)
- `src/services/connection-manager.test.ts`: 3 tests (B×2 + C)
- 7/7 pass, build clean (102.38 kB IIFE)

## Decisions
- แก้ root cause ตรงจุด: 3 auth-timeout callbacks + counter reset point + cap — ไม่ refactor อะไรเพิ่ม
- report บอก "wasConnectedBefore=false" แต่ wrong; root cause จริง = "auth-timeout ไม่ปิด socket" (handleConnectionOpen set wasConnectedBefore=true ตอน onopen)
- B fix (no reset on TCP open) จำเป็น เพื่อกัน auth-timeout loop ที่ retry ด้วย constant 2s delay; backoff ต้องโตผ่าน forceCloseSocket → reconnect cycles; reset เฉพาะตอน authenticated สำเร็จ
- vitest เพิ่มเป็น dev dep ที่จำเป็นสำหรับ TypeScript TDD — package.json มี `"test": "vitest run"`

## Open / next steps
- **Manual testing ก่อน prod** (ตาม ZLC-15 test plan):
  - Auth-timeout recovery: throttle/delay server auth response → widget ต้อง retry ด้วย backoff ไม่ refresh
  - Unbounded reconnect: kill chat-service > 240s (8×30s เดิม) → widget ยัง retry หลัง restore
  - No herd: ดู interval ระหว่าง attempt โตขึ้น ไม่คงที่
  - Tab-sync (≥2 tabs): leader+follower ไม่ duplicate socket หลัง recover
- **หลัง deploy**: purge Cloudflare cache `/cdn/floating-chat.iife.js` (per PROJECT.md)
- E2E gate (`e2e-chat-test.js` 0 FAIL) ต้องรันก่อน prod

## Notes for next session
- commit: `6db3462` บน `floating-chat` `main` branch (own repo, ไม่ใช่ root repo)
- ZLC-15 = customer-widget ฝาแฝดของ ZLC-14 (backoffice). แนวทาง fix เหมือนกัน
- ไม่มีเวลา run E2E gate รอบนี้ — ต้องรันก่อน deploy
