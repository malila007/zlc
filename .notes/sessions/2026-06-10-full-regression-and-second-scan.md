# Full regression run + stability scan round 2

## Goal
After fixes #2-#6 (+ FC heartbeat), re-run every suite, confirm no side effects, and scan areas the first pass did not cover.

## What changed
- No code changes. Verification + scan only.

## Decisions
- Scan #7 (stale `user.agentId` presence) closed as **won't fix** — PO confirmed a site token can never change in this deployment, so the precondition cannot occur. This also voids the `tokenCustomerMap` stale-entry half of #8 (same precondition).

## Verification results (all green)
- chat-service: vitest 370/370, `tsc` pass
- floating-chat: vitest 19/19, vite build pass
- backoffice: node --test 23/23, vite build pass (heap override)

## Round-2 scan coverage
chat-api.ts, chat-session model aggregations, rate-limiter, image-rate-limiter, data-cleanup-service, index.ts (shutdown/worker restart), BO domain (participant/member/read-marker/tab-sync-handler/http-json), BO transports (bc/worker/manager), FC auth-manager, FC message-handler, FC tab-sync, FC reconnect-manager + reconnect button wiring. All clean except:

## New findings (not yet fixed/ticketed)
1. **FC: no zombie-leader takeover (Medium)** — `floating-chat/src/services/tab-leader.ts` has no LEADER_PING probe / `steal` watchdog like BO's `tab-leader.js` (added during ZLC-14/19 work). A frozen leader tab that still holds the Web Lock leaves every FC tab without a socket indefinitely; followers queue on the lock forever.
2. **FC: follower "retry" button is a no-op on Web-Locks browsers (Low-Med)** — `reconnect-manager.handleManualReconnect()` → `forceClaimLeadership()` early-returns when `_leadershipRunning` (always true after init), and `manualReconnectNow()` no-ops for followers (`connect()` returns immediately). FC lacks BO's `FORCE_RECONNECT` relay, so a follower cannot kick a stuck leader.
3. **FC localStorage-fallback only (Minor)** — `forceClaimLeadership` clears the heartbeat keys, which can trigger an election while the current leader is alive → brief dual-leader window on non-Web-Locks browsers.

## Open / next steps
- PO to decide whether to fix the FC leadership findings (1 covers 2's root need; a FORCE_RECONNECT relay would fix 2 cheaply).
- Pre-release E2E gate (0 FAIL) still pending for the accumulated fixes #2-#6.

## Notes for next session
- Won't-fix register so far: scan #1 (BO no reconnect on server 1001), #7 (stale agentId), #8a (tokenCustomerMap) — all precondition-voided or accepted by PO; #8b (FC follower NACK flush only on next authenticated) accepted as minor.
