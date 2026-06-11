# FC heartbeat timeout fix

## Goal
Fix floating-chat heartbeat so a silent WebSocket can reach pong timeout recovery and force reconnect after 3 consecutive missed pongs.

## What changed
- Added floating-chat heartbeat regression coverage for overlapping interval pings, pong clearing, timeout re-arming, and SocketService force-close recovery.
- Updated `HeartbeatManager.sendPingAndWaitPong()` so interval pings do not clear and replace an already pending pong timeout.
- The pong timeout callback now clears its own timer reference before calling `onPongTimeout`, allowing later pings to arm a fresh deadline.
- Updated `floating-chat/CLAUDE.md` to document the reachable heartbeat timeout invariant.

## Decisions
- Kept existing heartbeat config values and the 3-timeout force-close policy.
- Kept the fix scoped to floating-chat; backoffice and chat-service heartbeat code were not changed.

## Open / next steps
- Before production release, run the project pre-release E2E gate with BO, FC, and chat-service pointed at local chat.

## Notes for next session
- Focused regression command: `cd floating-chat && npm test -- src/services/heartbeat-manager.test.ts`.
- Full FC verification used for this fix: `cd floating-chat && npm test` and `cd floating-chat && npm run build`.
