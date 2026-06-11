# Chat service double-auth race fix

## Goal
Fix Plan 6: duplicate `authenticate` frames on one WebSocket could race while auth was in flight, double-counting connection pool state and leaking a heartbeat interval.

## What changed
- Added an auth in-progress guard in `chat-service/src/routes/websocket.ts`.
- Made `heartbeatManager.start(socket)` idempotent by stopping any existing heartbeat for that socket before starting a new one.
- Added regression coverage for duplicate auth frames and repeated heartbeat start.
- Updated `PROJECT.md` WebSocket behavior notes.

## Decisions
- Duplicate auth during in-flight auth is dropped without closing the socket and logged as `AUTH_IN_PROGRESS`.
- Non-auth frames before auth completion still follow the existing `AUTH_REQUIRED` close path.
- `connectionPoolCounted` stays a boolean because the auth commit now runs once per socket.

## Open / next steps
- No open Plan 6 implementation items.
- Pre-release E2E remains required before production release.

## Notes for next session
- Verification passed: targeted RED tests failed before implementation, targeted tests passed after implementation, `npm test` passed, and `npm run build` passed in `chat-service`.
- Existing Vitest warnings remain in `tests/unit/services/broadcast-worker.test.ts` about nested `vi.mock`; unrelated to this fix.
