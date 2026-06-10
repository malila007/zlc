# ZLC-14 — Connection auto-recovery after login (chat + noti)

## Goal
Fix the intermittent "after login, connection dead-ends permanently until refresh" bug. New prod data showed it is **not chat-only** — the notification ("noti") socket also fails to connect, with re-login as the only workaround. Investigate the whole project, fix, and report on ZLC-14.

## What changed
Root pattern: backoffice client connections bind to login-derived identity and have no robust auto-recovery once stuck. Server is healthy (ZLC-14 DoR data) → fix is purely client-side resilience. Approved scope included off-limits noti/login files.

**Chat module (in-scope):**
- `connection/backoff.js` (new) + `backoff.test.mjs` (node:test): pure `computeBackoffDelay` (capped exp + jitter) and `classifyDisconnect` (transient/soft/fatal). 6/6 tests pass.
- `protocol/message-handler.js`: `AUTH_TIMEOUT`/`AUTH_REQUIRED` are now **transient** (reconnect), not terminal. Capacity/limit = **soft** (long backoff, `state.softDisconnectCode`). Only `AUTH_INVALID_DATA` stays **fatal** (blocks). Fixes the dominant dead-end (AUTH_TIMEOUT = 98% of auth errors was permanently blocking reconnect).
- `connection/reconnect-scheduler.js` + `config.js`: replaced fixed `[3000,10000]` (2 tries, synchronized → herd) with **unbounded capped backoff + jitter**; `reset()` clears backoff growth on success.
- `connection/auth-handler.js`: auth retry exhaustion now `forceReconnect`s instead of leaving the socket OPEN-but-unauthenticated forever.
- `tab/tab-leader.js`: Web-Locks acquire **watchdog** — if leadership isn't granted in ~5s, PING the holder; no PONG ⇒ zombie/bfcache ⇒ `{ steal: true }` to break a stuck lock. Live leader answers PONG ⇒ never stolen (no dual sockets).
- `composables/useMainChatOfflineBanner.ts` + `components/chat/main/Main.vue`: removed the terminal `"done"` ("เชื่อมต่อไม่สำเร็จ") give-up; banner now stays "reconnecting…" while the scheduler keeps retrying.
- `state.js` / `session-lifecycle.js`: added/cleared `softDisconnectCode`; reset scheduler on auth.

**Noti + login wiring (off-limits, user-approved):**
- `composables/useNotifySocket.ts` (new): reactive identity watch (`immediate`) → connects when `agent_username` hydrates from `me()`, recreates on identity change. Fixes one-shot-at-mount + the dead `watch(agentUsername.value, …)` + unwrapped-ref bugs.
- Migrated the 3 socket creators to the composable: `top-bar/MainDesktop_v5.vue`, `top-bar-v2/Main_v2.vue`, `layouts/main-menu/Main_theme_v1.vue`. (5 other files import only `usersOnline` — untouched.)
- `socket.config.js`: `timeout` 3000→10000 (slow mobile), added `reconnectionDelayMax` + `randomizationFactor` (jitter), unbounded attempts.

**Review hardening (same session, Codex):**
- `notify-socket-lifecycle.js` + `notify-socket-lifecycle.test.mjs`: split the notification socket lifecycle into a small testable helper and fixed an async identity race. If `agent_username` / `username` changes while socket creation is still resolving, stale sockets are now disconnected and only the newest identity gets event handlers.
- `useNotifySocket.ts`: now delegates to the lifecycle helper, stops the watcher on teardown, and disconnects pending stale sockets after unmount.

## Decisions
- Severity model: transient → normal backoff; soft (capacity/limit) → long backoff (DoR shows headroom, so not permanent); fatal (`AUTH_INVALID_DATA`) → block. (ZLC-14's open retry-scope decision resolved this way.)
- Steal guarded by a PING/PONG liveness probe to avoid creating two leaders/sockets.
- Skipped the optional `usersOnline`-reset-on-disconnect (flicker risk; cosmetic) — noted on ZLC-14.
- No backoffice build/env config touched. New composable test runs via `node --test` (no test runner added to package.json).

## Verification done
- `npm run build` passes (needs `NODE_OPTIONS=--max-old-space-size=6144` — pre-existing 12 MB bundle / heap need, not from this change).
- `node --test src/services/chat/connection/backoff.test.mjs` → 6 pass / 0 fail.
- `node --test src/composables/notify-socket-lifecycle.test.mjs` → 2 pass / 0 fail.
- All edited JS `node --check` clean.
- Root `node --check e2e-chat-test.js` clean.
- Full local E2E gate run with local `chat-service :3333`, `floating-chat :5173`, and `backoffice-frontend :3000`: **PASS 66 / FAIL 0 / WARN 2 / TOTAL 68**.
  - WARN: `REF-R` could not confirm `isConnected` through dev import after sync, but customer list was stable.
  - WARN: post-sync send returned `sent=true` but test could not prove BO/FC display update; no FAIL.

## Open / next steps
- **Still recommended before prod:** manual browser checks: chat auto-recovers after AUTH_TIMEOUT / server kill without refresh; ≥2-tab leader-steal recovery (exactly one socket); fresh-login noti connects once `me()` hydrates.
- Branch: `fix/zlc-14-connection-autorecovery` (not committed/pushed — awaiting user).
- Highest-priority area (connection/tab-sync) touched — A4 (tab-leader) is the main regression risk; verify with ≥2 tabs before merge.

## Post-review fix (2026-06-06)
- Reviewer verdict: CONDITIONAL GO. Fixed reviewer **M1** only (per user): `auth-handler.js` `_retryOrGiveUp` setTimeout id was unstored → uncancelable. Now stored in `this._retryTimer`, cleared in `reset()` + `authenticate()` + `_giveUpAndReconnect()`, and self-nulled on fire. `node --check` clean.
- **Not done (user decided):** S1 (`socket.config.js` `off()` anon refs no-op), S2 (jitter applied after cap → max delay = cap×1.5). E2E gate **skipped** this round. No deploy — user deploys themselves.
- State: ZLC-14 already merged to `backoffice-frontend` `master` (`71e4d335`), local master 2 ahead of origin; M1 fix is an **uncommitted** working-tree change on master.

## Notes for next session
- ZLC-12 (In Review) already tracks `socket.config.js`; this change supersedes part of that for the noti socket. Reconcile when ZLC-12 lands.
- If E2E flakes on reconnect timing, the backoff base/cap live in `config.js` (`RECONNECT_BACKOFF_*`).
