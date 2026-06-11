# BO history correlation fix

## Goal
Prevent backoffice from merging one customer's history into another room when an agent switches rooms before an older history response arrives.

## What changed
- `chat-service` history responses now use `{ messages, conversationWith, unreadByCustomer? }`.
- Customer history keeps `unreadByCustomer` and now also echoes `conversationWith`.
- Agent history changed from a plain array to an object with `messages` and echoed `conversationWith`.
- Backoffice `MessageHandler` now uses echoed `conversationWith` as the primary history merge key, with legacy array fallbacks kept for old servers.
- Added standalone BO regression tests for object payload correlation, legacy array fallback, and empty histories.
- Updated `PROJECT.md` with the new WebSocket history response contract and deploy-order note.

## Decisions
- Did not add request ids; echoed `conversationWith` is enough to route history to the correct room.
- Kept `historyLoadingFor` and `takePendingHistoryKey` fallback behavior for compatibility with older chat-service deployments.
- Did not modify floating-chat because it already accepts object history payloads and ignores unknown fields.

## Open / next steps
- Before production release, run the full local E2E gate with BO, FC, and chat-service pointed at local chat and require 0 FAIL.
- Deploy the compatible backoffice bundle before deploying the new chat-service history shape.

## Notes for next session
- Backend verification: `cd chat-service && npm test && npm run build`.
- BO focused verification: `cd backoffice-frontend && node --test src/services/chat/test/message-handler.history.test.mjs src/services/chat/test/heartbeat-manager.test.mjs src/services/chat/test/backoff.test.mjs`.
- BO build verification: `cd backoffice-frontend && NODE_OPTIONS=--max-old-space-size=4096 npm run build`.
