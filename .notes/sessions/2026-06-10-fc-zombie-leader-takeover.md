# Goal

Fix `.feat/plan1_1.md`: floating-chat Web Locks followers must recover when the current leader tab is frozen or stuck while still holding the lock.

# What changed

- Added Web Locks acquire watchdog and leader probe in `floating-chat/src/services/tab-leader.ts`.
- Added per-scope control channel messages: `LEADER_PING`, `LEADER_PONG`, `LEADER_TAKEOVER`.
- A waiting follower steals only after the current leader does not answer the probe.
- A stale old leader demotes itself through `onFollow()` when it receives takeover from another tab.
- Web Locks `AbortError` from a stolen request is treated as an expected cancellation and never re-claims leadership.
- Added `FC_LEADER_ACQUIRE_WATCHDOG_MS` and `FC_LEADER_PING_TIMEOUT_MS`.
- Added Vitest coverage for zombie takeover, live-leader no-steal, old-leader demotion, normal two-tab behavior, and AbortError after steal.
- Updated `floating-chat/CLAUDE.md`, `.cursor/rules/floating-chat-tab-sync.mdc`, and `PROJECT.md`.

# Decisions

- Kept `initTabLeadership(scope, { onLead, onFollow })` unchanged.
- Left localStorage fallback unchanged because its heartbeat staleness path already handles dead leaders.
- Kept the control channel separate from the existing leader sync channel used for WebSocket event relay.
- Matched BO behavior for Web Locks steal cancellation: `AbortError` is ignored in both initial and queued lock request catch paths.

# Open / next steps

- Manual browser verification is still needed for real tab freeze/discard behavior before release.
- Full pre-release E2E gate is still required only when preparing a production release.

# Notes for next session

- Watch for the residual overlap window if a live but CPU-starved leader misses the 1s pong timeout. `LEADER_TAKEOVER` demotes it when its event loop resumes, and message dedup remains the final defense for duplicate inbound render paths.
