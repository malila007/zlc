# ZLC-14 follow-up — Leader hand-off on disconnect (backoffice tab-sync)

## Goal
Review a proposed fix for "stale leader silences follower tabs", find it incomplete + a regression, then implement the correct fix: a leader tab that disconnects must hand leadership to a waiting tab, and a reconnecting tab must restore its leader channel — all without ever opening two sockets.

## What changed (backoffice-frontend, own repo)
- **Reverted** the prior attempt in `connection-manager.js` `disconnect()` (nulled `_leaderChannel` + cleared `-hb`/`-id`). It broke relay on reconnect (channel never recreated — `connect()` does not re-run election) and did not release the Web Lock on real browsers (those keys are localStorage-fallback only).
- `tab/tab-leader.js`: `initTabLeadership()` (and the localStorage fallback) now return a `{ release, reacquire }` handle.
  - Held Web Lock changed from `holdForever` (never resolves) to a resolvable `holdLock()`; `release()` resolves it so a queued tab is granted leadership.
  - `release()` also aborts a still-pending acquisition (`AbortController` signal on non-steal requests; `AbortError` ignored in `.catch`), sets `wantsLeadership=false`, and steps down via `onFollow()`.
  - `wantsLeadership` gates every acquisition path (initial `.then`, `queueLeadership`, steal callback, fallback `claimLeadership`) so a released tab never grabs the lock back until `reacquire()`.
- `connection/transport/bc-transport.js`: store the handle in `initLeadership()`; `disconnect()` → `release()` then WS teardown; `connect()` → `reacquire()` then WS connect; `forceClaimLeadership()` now stores the refreshed handle.
- Docs: added the leadership-lifecycle invariant to `.cursor/rules/backoffice-chat-tab-sync.mdc`.

## Decisions
- `release()` steps down to **follower** (not idle) so a later `connect()` can't open a rogue second socket before re-acquisition — this is what guarantees the single-socket invariant.
- Steal path untouched (PING/PONG liveness guard stays); the `wantsLeadership` check in the granted callback makes a stolen-then-released grant a clean no-op + immediate release.
- Verified with a new in-memory harness (Option 1, user-chosen): faithful `navigator.locks` (exclusive + FIFO queue + release-grants-next + steal + abort), `BroadcastChannel`, `WebSocket`, `localStorage` fakes; a loader redirects `config.js` (Vite `import.meta.env`) and `http-json.js` (imports a `.ts`) so the **real** tab-leader/bc-transport/connection-manager run under node:test.

## Verification done
- During development a throwaway node:test harness (faithful in-memory `navigator.locks`/`BroadcastChannel`/`WebSocket` + config/http-json loader redirect) drove the fix RED→GREEN on 3 cases: (1) follower takes over with exactly one socket on leader disconnect; (2) same-tab reconnect restores the leader socket + relays to a new follower; (3) reconnecting tab opens no 2nd socket while another tab leads. **Harness removed afterward per user (keep code lean); re-verify via manual ≥2-tab + E2E.**
- Existing `backoff.test.mjs` still 6/6. `node --check` clean on all edited files. `NODE_OPTIONS=--max-old-space-size=6144 npm run build` passes.

## Open / next steps
- **Before prod (still required):** manual ≥2-tab checks — leader disconnect (close chat / navigate) → another tab takes over, exactly one socket; reconnect → relay resumes; re-login multi-tab. Then the project E2E gate (`e2e-chat-test.js`, 0 FAIL).
- `forceClaimLeadership()` still re-inits a fresh machine (old controlChannel/lock linger) — pre-existing; not worsened, but worth a future cleanup ticket to route it through the handle (`reacquire`/steal) instead of re-init.
- Not committed/pushed — awaiting user. Branch `fix/zlc-14-connection-autorecovery` (root) / backoffice own repo working tree.

## Notes for next session
- No automated test committed (removed per user). If re-adding: faithful fakes for `navigator.locks` (queue + release-grants-next + steal + abort), `BroadcastChannel`, `WebSocket`; redirect `config.js` (Vite `import.meta.env`) and `http-json.js` (`.ts` import) via a node loader; needs `--test-force-exit` (5s acquire watchdog timer lingers).
- Floating-chat (ZLC-15) twin has a different/simpler disconnect (`connection-manager.ts`); this hand-off issue is backoffice-specific (Web Lock held for page lifetime). Revisit if the twin grows the same page-lifetime leadership model.
