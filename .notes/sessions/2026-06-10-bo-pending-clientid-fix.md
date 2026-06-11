# BO pending-message clientId fix (scan #4)

## Goal
Stop `message_sent` from deleting the wrong pending message: shared-inbox broadcasts another operator's `message_sent` to every tab, and content-based matching silently dropped a different operator's queued identical text.

## What changed
- `chat-service`: `message` request accepts optional `clientId` (string ≤64 chars, invalid silently ignored); echoed back in `message_sent` only — never in the recipient `message` payload, never persisted.
- `backoffice` `domain/message-service.js`: transport messages carry `clientId = _clientSendId`; `removePendingMessage` matches by `clientId` when present (no content fallback in that branch — cross-operator echoes remove nothing), legacy `to + content` match only when the server did not echo.
- `_clientSendId` now includes a random segment (`bo-msg-<ts>-<rand>-<seq>`) so ids cannot collide across tabs in the same millisecond.
- Removed dead code: the `isPending` bubble-removal loop in `removePendingMessage` — nothing in the module ever creates `isPending` messages.
- New tests `src/services/chat/test/message-service.pending.test.mjs` (6) + 3 backend tests for echo/omission/invalid values.
- `PROJECT.md`: WS contract documents `clientId`; the two pending-dedup rules now state the implemented mechanism.

## Decisions
- No deploy-order constraint: additive both directions (old BO ignores the new field; new BO falls back on old servers; FC never sends `clientId`).
- When `message_sent` carries a `clientId` that matches nothing, nothing is removed — that is the cross-operator case, not an error.
- FC's own content-based queue dequeue (`message-queue.ts`) left as-is — single-conversation widget, tracked separately (scan #8).

## Open / next steps
- Run the full E2E gate (0 FAIL) before any prod release.
- Remaining scan items: #5 (id-first display dedup + outdated FC CLAUDE.md claim), #6 (double-authenticate race), #7 (stale `user.agentId`), #8 (minor).

## Notes for next session
- Verification: `cd chat-service && npm test && npm run build`; `cd backoffice-frontend && node --test src/services/chat/test/*.mjs && NODE_OPTIONS=--max-old-space-size=4096 npm run build`.
