# BO heartbeat orphan timer fix

## Goal
Fix the backoffice heartbeat bug where a replacement ping could orphan the previous pong timeout and later close a healthy WebSocket.

## What changed
- Added a standalone Node regression test for the backoffice heartbeat manager.
- Updated `sendPingAndWaitPong()` to arm the pong timeout only when no timeout is already pending.
- The timeout callback now clears its own reference before calling `onTimeout`, so later pings can arm a new deadline.

## Decisions
- Kept the fix scoped to `backoffice-frontend/src/services/chat/connection/heartbeat-manager.js`.
- Did not change `floating-chat` or the backoffice shared-worker heartbeat in this fix; floating-chat needs a separate Jira follow-up because its clear-before-set pattern can make pong timeout unreachable when the interval is shorter than the timeout.
- Did not update `PROJECT.md`; this is an internal stability bugfix with no protocol or business contract change.

## Open / next steps
- Create/check a ZLC ticket for the floating-chat heartbeat timeout-unreachable issue. Atlassian search failed in this session with 403 (`The app is not installed on this instance`), so no Jira ticket was created here.

## Notes for next session
- Regression command: `node --test backoffice-frontend/src/services/chat/test/heartbeat-manager.test.mjs`.
- Backoffice build may need `NODE_OPTIONS=--max-old-space-size=4096 npm run build` on this machine; the default heap hit OOM during Vite build.
