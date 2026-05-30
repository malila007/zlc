# shared-w — Backoffice chat SharedWorker (PAUSED)

Release round for migrating backoffice chat tab-sync from **tab-leader election** to a **SharedWorker** that owns one WebSocket across all tabs.

## Status: DISABLED on prod — reverted to tab-leader

`config.js → USE_SHARED_WORKER = false`. Prod runs the original **BcTransport** path (tab-leader + `ConnectionManager` + `BroadcastChannel`). All SharedWorker code is present but dormant behind the flag. **Issues below must be fixed before re-enabling and re-testing.**

Scope: `backoffice-frontend/src/services/chat` only. (A parallel floating-chat SharedWorker exists but is out of scope for this round.)

## Why it was built

Tab-leader election (Web Locks / `BroadcastChannel`) has a race: refreshing the **leader** tab makes every tab elect as follower permanently → the WebSocket is never re-owned → chat goes silent after ~3 min. Agents hit this daily. A SharedWorker owns the WS independently of any tab, so a tab refresh never drops the connection.

## Current behavior (flag = false)

- Every tab uses `BcTransport`; one tab wins leadership and owns the WS, others are followers over `BroadcastChannel`.
- The leader-refresh race **still exists** in this path — that is the open problem the SharedWorker was meant to solve.

## How to re-enable (after issues are fixed)

1. `config.js` → `USE_SHARED_WORKER = true`.
2. Build with `NODE_OPTIONS="--max-old-space-size=4096"` (large project).
3. Run the pre-release E2E gate (0 FAIL) — see `PROJECT.md`.
4. Run the manual test checklist below.
5. The factory still auto-falls back to `BcTransport` at runtime if the worker can't start or its reconnect exhausts, so a bad deploy degrades rather than breaks.

Design and message protocol: see `architecture.md`.

## Issues to fix before re-test

Tracked in Jira under Epic **ZLC-5** (`nutcom3.atlassian.net`) — not duplicated here:

- `ZLC-4` — reproduce the prod-only failure that forced the rollback (E2E passes locally)
- `ZLC-6` — fallback to BcTransport re-introduces the leader-election race
- `ZLC-7` — single `SEND_NACK` treated as a full disconnect (UI flapping)
- `ZLC-8` — verify reconnect-cap → BcTransport hand-off does not double-connect
- `ZLC-9` — auth recovery timing window is fragile
- `ZLC-10` — passive port pruning leaves a phantom port up to 15 s on tab crash

## Manual test checklist

- [ ] Backoffice: refresh the leader tab → chat resumes < 2 s, no reconnect banner.
- [ ] 2+ agent tabs in Chrome → `chrome://inspect/#workers` shows **one** SharedWorker.
- [ ] Close all tabs → worker disappears from inspector; reopen → fresh auth.
- [ ] Two admins / devices sharing the same `agent_username` are not blocked by per-user caps.
- [ ] Repeated identical outbound text is not dropped while reconnecting.
- [ ] Live messages, `message_sent`, and history stay timestamp-sorted across tabs.
