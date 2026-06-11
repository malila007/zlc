# Chat stability full scan (websocket / wrong-room / lost messages)

## Goal
Scan all three chat surfaces (chat-service, floating-chat, backoffice chat) for stability risks: connection recovery, message routing to wrong agent/room, and silent message loss. Report findings; no code changes.

## What changed
- No code changes. New session note only.

## Decisions
- Findings reported to PO before creating ZLC tickets (cross-checked against ZLC-4..19 to avoid duplicates; ZLC-18/19 already cover backoff jitter and forceClaimLeadership).

## Findings (not yet ticketed)
1. **BO no auto-reconnect after server deploy/restart** — server shutdown closes sockets with code 1001 (`chat-service/src/index.ts:190`); BO treats incoming 1001 as intentional and skips reconnect (`connection-manager.js:322-330`). BO's own teardown nulls listeners before closing with 1001, so the only 1001 the handler ever sees is server-initiated. Background tabs stay dead until focus/refresh. FC reconnects on any close code.
2. **BO heartbeat orphaned pong timer** — `connection/heartbeat-manager.js:40-44` `sendPingAndWaitPong()` overwrites `pongTimeout` without clearing the previous one (FC version clears first). visibilitychange/online pings while one timeout is pending orphan a timer that later force-closes a healthy socket (PONG_TIMEOUT 55s).
3. **BO history response has no correlation → wrong-room merge** — agent `history` response is a plain array (no conversationWith echo, `message-service.ts:238`); BO resolves the key from single-slot `historyLoadingFor`/`_pendingHistoryKey` (`message-handler.js:150-162`, `history-loader.js`). Fast customer-A→customer-B switching files A's history under B.
4. **Shared-inbox pending-message deletion by content** — `message-handler.js:257-262` `handleMessageSent` → `removePendingMessage(to, content)` matches by to+content; `message_sent` broadcasts to all sockets of the shared userId, so operator A's send can delete operator B's pending identical text (PROJECT.md rule says client-id-based matching).
5. **Content-window dedup drops legitimate repeats** — BO `_isDuplicate` (5s window) + history bucket dedup (`message-handler.js:108-119,186-202`), FC `isDuplicateMessage` fallback. Server now sends real `id` on live `message`/`message_sent`, so id-first dedup could be tightened; FC CLAUDE.md claim "live events carry no DB _id" is outdated.
6. **Server double-authenticate race** — two authenticate frames processed concurrently (`websocket.ts:85-179`): both commit, `incrementConnections` runs twice but single `connectionPoolCounted` flag decrements once → permanent total-connection counter leak; `heartbeatManager.start` twice leaks an interval.
7. **Stale `user.agentId` mis-routes presence** — `agentId` is `$setOnInsert`-only (`connect-service.ts:56-70`); a customer reconnecting under a new token keeps the old agentId → `user_status_update` online/offline goes to the old inbox; customer history fallback without conversationWith reads the old agent thread.
8. Minor: stale `tokenCustomerMap` entry when a customer's token changes (memory only); FC follower NACK'd queued message flushes only on the next authenticated event (queue processor stopped on followers).

## Open / next steps
- PO to decide which findings become ZLC tickets (suggested: #1–#4 as Bugs, #5–#7 as Tasks).
- #3 likely needs a backend protocol addition (echo conversationWith in history response).

## Notes for next session
- ZLC-14/15/16 (in review) cover connect/auth autorecovery; this scan found the *post-deploy 1001* gap is NOT covered by them.
- Jira cross-check done against ZLC-4..19 on 2026-06-10.
