# Project Knowledge

This file is our running knowledge base for the chat system in this repo.
Every new chat session must read this file before project work.
It should be updated whenever we learn something important from code, docs, bugs, or behavior in production/staging.

## Entry Points & Reading Order

`PROJECT.md` is the canonical knowledge base for Claude, Codex, and Cursor. Tool entrypoints stay thin and only point here: `AGENTS.md` (Codex), `CLAUDE.md` (Claude), `.cursor/rules/shared-chat-knowledge.mdc` (Cursor).

Read in order:

1. `PROJECT.md` (this file)
2. The assigned `.feat/<release>/` folder or plan — **only if the user assigned one** (current: `bc-log/`). Release workflow: `.feat/README.md`.
3. `.cursor/rules/floating-chat-tab-sync.mdc` when editing `floating-chat/src`; `.cursor/rules/backoffice-chat-tab-sync.mdc` for backoffice chat.

**Docs on change** (single source — do not restate this table elsewhere):

| Change | Update |
|--------|--------|
| Business / protocol / prod behavior | `PROJECT.md` |
| Active release only | `.feat/<release>/` (delete after prod; promote durable facts here first) |

## Constraints and Working Rules

These rules exist because of past incidents or explicit user decisions. Follow them without exception.

### Highest-priority areas

Connection, chat messaging, and chat-room behavior are the most important parts of this system. Never ship a change that risks regressing them. Verify with the E2E suite and the `vmb` agent inbox (operator `mali168`) before any release. Treat tab sync, presence, unread counts, and message delivery as the core paths to protect.

### Chat inbox identity must stay in the username namespace (never `MEMBER_TOKEN`)

The backoffice chat inbox id is resolved in `backoffice-frontend/src/services/chat/identity/inbox-id.js` (`resolveChatInboxId`) from the `GET /api/v1/me` (`backoffice-api.zixma.co/api/v1/me`) user object. The shared inbox routing id is the **parent agent username** in the username namespace (e.g. `vmb`, `mvp4`, … — whatever that agent's `MEMBER_USERNAME` is). A parent plus all its sub operators MUST resolve to that one value so they see the same room.

Field contract from real `GET /api/v1/me` (`backoffice-api.zixma.co/api/v1/me`), with the **only** correct resolution:

| Field | Example (`vmb`, non-sub) | Example (`mali168`, sub of `vmb`) | Role in routing |
|-------|--------------------------|-----------------------------------|-----------------|
| `MEMBER_USERNAME` | `vmb` | `mali168` | Inbox id for a **non-sub** account only. A sub's own username is **not** the inbox id. |
| `MEMBER_TYPE` | `super_senior` | `sub` | `"sub"` ⇒ sub branch; anything else ⇒ non-sub branch. |
| `MEMBER_UPLINE_ID` | `vm` | **`vmb`** | **Sub:** shared inbox id = the **parent agent's username** (`MEMBER_USERNAME` of the owning agent). The API returns this in the username namespace — enforced server-side, not a frontend guess. Value depends on which agent owns the sub (e.g. `vmb` here because `mali168` belongs to `vmb`; another sub might get `mvp4`). **Non-sub:** that account's upline — **not** its own inbox; never use for non-sub routing. |
| `MEMBER_TOKEN` | `OwAnwE` | `""` | Random token or empty. **Never** a routing id. |
| `MEMBER_USERNAME_LOGIN` | `agentdemo` | `mali168` | Login credential only; not the inbox id. |

Sub `me()` example (verified for `mali168` under agent `vmb`): `MEMBER_TYPE: "sub"`, `MEMBER_USERNAME: "mali168"`, `MEMBER_UPLINE_ID: "vmb"`, `MEMBER_TOKEN: ""`. Another sub under agent `mvp4` would have `MEMBER_UPLINE_ID: "mvp4"`.

Hard rules:

- **Sub** (`MEMBER_TYPE === "sub"`) → `MEMBER_UPLINE_ID` (parent agent username from API). Do **not** hardcode a specific agent name, and do **not** substitute `MEMBER_TOKEN`, `MEMBER_USERNAME`, or any other field.
- **Non-sub** → env override → `agent_username` → `MEMBER_USERNAME` → `username`. Never `MEMBER_TOKEN`, never the non-sub's own `MEMBER_UPLINE_ID` (e.g. `vmb` non-sub has `MEMBER_UPLINE_ID: "vm"` — using it would route to the wrong inbox).
- Do **not** reintroduce `MEMBER_TOKEN` (or any non–username-namespace value) into `resolveChatInboxId`. Doing so splits a parent from its subs into different inboxes — the "vmb vs mali168 see different chats" bug (regressed in `3149c356`, fixed 2026-06-09). Covered by `inbox-id.test.mjs`; keep it green.

### Self-review before handoff

Before sending final work, review your own code/docs and final answer against the user's request. Check requirement match, readability, duplication, regression risk, and verification evidence.

### Backoffice config is off-limits

Only work inside `chat-service`, `floating-chat`, and `backoffice-frontend/src/services/chat` + `backoffice-frontend/src/components/chat`. Do **not** touch:

- `backoffice-frontend` env files (`.env`, `.env.*`)
- `backoffice-frontend` build config (`vite.config.*`, `package.json` scripts, CI/CD)
- Any backoffice feature outside the chat module

If a task genuinely requires changing backoffice config or a non-chat backoffice file, **stop and ask the user first**.

### Pre-release E2E gate

Before any production release (when the user says ready for prod), run the full E2E suite. The gate is **0 FAIL** — the run prints a `PASS / FAIL / WARN / TOTAL` summary; WARN does not block. Do not hardcode a test count; it grows as tests are added.

```bash
NODE_PATH=/home/togethel2/.npm/_npx/e41f203b7505f1fb/node_modules \
  node /home/togethel2/workspace/zigma/chat/e2e-chat-test.js
```

Requires: `backoffice-frontend` on `:3000`, `floating-chat` on `:5173`, `chat-service` on `:3333` with `CHAT_ENABLED=true`. Login: `mali168` / `123456`.
**Both frontends must point at local chat** — `backoffice-frontend/.env` `VITE_WS_CHAT_URL` and `floating-chat/.env` `SERVER_URL` = `ws://localhost:3333/ws`. If BO points at prod while FC points local, every cross-system check fails (12 bogus FAILs, and BO test messages land on prod). Changing the backoffice value still requires asking the user first (env file is off-limits); restore it afterwards.
Local `.env` has `CHAT_ENABLED=false` — temporarily flip + `touch chat-service/src/index.ts` to reload before running, then restore. Deploy checklist: `.feat/bc-log/deploy-2026-05-16.md`.

### Local dev defaults that differ from production

| Setting | Local | Production |
|---------|-------|------------|
| `CHAT_ENABLED` | `false` (UI hidden) | `true` |
| `BROADCAST_RATE_LIMIT_WINDOW_MS` | `0` (disabled) | `3600000` (1 hour) |
| `CHAT_LOG_LEVEL` | `info` | `error` |

### chat-service build and tests

- `npm run build` (`tsc`) compiles only `src/**/*` per `tsconfig.json`; it does not typecheck `tests/`.
- `npm test` uses `vitest.config.mts` (not `.ts`) because Vitest 4 + Vite 8 load ESM-only deps; a CJS `vitest.config.ts` fails with `ERR_REQUIRE_ESM` on Node 20+.
- Heartbeat timeout closes the socket with WebSocket close code `4000` (custom), not `1000`.

## Scope

This repo contains three relevant parts of the same chat domain:

1. `chat-service`
   The backend source of truth for chat transport, storage, unread logic, presence, image upload, and cleanup.
2. `floating-chat`
   The customer-facing embeddable chat widget.
3. `backoffice-frontend`
   Only the native WebSocket chat module is in scope for this knowledge note.

Out of scope:

- `backoffice-frontend/src/views/line/LineChat.vue`
- old or unrelated backoffice features that happen to contain the word "chat"

## High-Level Model

This is a token-routed support chat platform, not a general peer-to-peer chat system.

Core rule:

- A customer is routed to an agent context by `token`.
- For the embeddable widget, `recipientId`, `token`, and the backoffice `agent-id` are the same chat inbox routing identity.
- A widget user may be an authenticated customer ID or `guest`, depending on the host system.
- The backend stores each conversation as one `(agentId, customerId)` session.
- The agent UI only sees customers inside that token scope.
- The customer only talks to the agent associated with that token.

In practice:

- `chat-service` is the chat engine.
- `floating-chat` is the customer client.
  - Optional **action bar / sub-views** (e.g. deposit slip, withdraw) are toggled at embed time via `init({ features: ChatFeature[] })`. Types live in `floating-chat/src/types/api.ts`; how to add a new feature is documented in **`floating-chat/README.md`** (section *Optional features (action bar)*).
- `backoffice-frontend` chat is the agent client.

Backoffice chat identity:

- The backoffice chat module authenticates to `chat-service` with the shared inbox identity in the **username namespace**, e.g. `vmb` — see the hard rule *Chat inbox identity must stay in the username namespace* under Constraints for the full field contract and resolution order.
- Operator username is only metadata such as `requestedBy`, not the WebSocket `userId` / `token` for the shared inbox.

## Backend Summary

Main backend entry:

- `chat-service/src/index.ts`

Main backend responsibilities:

- Fastify app bootstrap
- MongoDB connection
- WebSocket route registration
- REST chat routes
- multipart image upload
- heartbeat, cleanup, graceful shutdown

Main routes:

- `chat-service/src/routes/websocket.ts`
- `chat-service/src/routes/chat-api.ts`
- `chat-service/src/routes/image-upload.ts`
- `chat-service/src/routes/health.ts`
- `chat-service/src/routes/metrics.ts`

Important services:

- `auth-service.ts`
  Handles WebSocket authentication and initial status broadcast.
- `message-service.ts`
  Routes WebSocket message types and enforces message-level rules.
- `chat-service.ts`
  Core business logic for recipient validation, persistence, history, customer lists, active users, unread counts, and read receipts.
- `connect-service.ts`
  Maintains in-memory active users and token-to-customer grouping.
- `disconnect-service.ts`
  Handles disconnect cleanup and offline status propagation.
- `connection-pool.ts`
  Connection limits and connection-attempt rate limiting.
- `heartbeat-manager.ts`
  Ping/pong lifecycle and dead connection cleanup.
- `image-upload-service.ts`
  Image validation plus S3-compatible upload to DigitalOcean Spaces.
- `data-cleanup-service.ts`
  Retention-based cleanup of sessions, images, and orphaned users.

Important in-memory state:

- `websocketMap: Map<userId, Set<WebSocket>>`
  Real source of truth for active sockets per user.
- `activeUsers: Map<userId, ActiveUserData>`
  Active authenticated users and metadata.
- `tokenCustomerMap: Map<token, Set<customerId>>`
  Which customers belong to which token/agent scope.

## Core Business Rules

Validated from code and previous documentation notes. Re-check `chat-service/DOCUMENT.md` if it is restored:

- Authentication is required before normal messaging.
- Clients must send `authenticate` quickly after connection.
- `role` must be `agent` or `customer`.
- `token` is required and acts as the routing/group key.
- Customers are scoped to an agent/token context.
- Agents see only customers in their token scope.
- Messages are persisted even when recipients are offline.
- Real-time delivery has no later push retry; offline recipients recover via history fetch.
- Unread counts are timestamp-based using `lastReadByAgent` and `lastReadByCustomer`.
- Images are sent as normal chat messages whose content is an uploaded image URL.
- Sessions are retained temporarily and cleaned up by retention policy.

## WebSocket Contract

Primary message types used by the shared system:

- `authenticate`
- `authenticated`
- `message`
- `message_sent`
- `history`
- `get_customers`
- `customers`
- `get_active_users`
- `active_users`
- `user_status_update`
- `mark_read`
- `read_confirmed`
- `ping`
- `pong`
- `error`

Important behavior:

- `message_sent` is broadcast to the sender's own connections.
- `message` is broadcast to the recipient's active connections if online.
- `broadcastToUser` supports multi-tab/multi-device by sending to all sockets for a user.
- `error.code` differentiates pre-auth protection reasons: `IP_RATE_LIMITED` (attempt throttling) vs `SERVICE_CAPACITY_REACHED` (global capacity), and keeps `CONNECTION_LIMIT_REACHED` for per-customer post-auth limits.
- Agent and customer history payloads are not identical.

History response difference:

- Agent history is returned as a plain message array.
- Customer history is wrapped and also includes `unreadByCustomer`.

## Monitoring / Metrics

The chat-service exposes runtime metrics at `GET /health/metrics` (requires `x-chat-api-secret` header).

Deployment rule:

- `/metrics` and `/health/metrics` are **blocked at Traefik** (404) on `chat.zixma.co` — accessible only from loopback inside the server.
- Do not add user IDs, customer IDs, raw tokens, IPs, emails, phone numbers, or raw URLs as metric labels.
- Business metrics that read MongoDB must be cached and must soft-fail with last-known-good values so metrics scraping cannot take down chat.

**No on-host Prometheus/Grafana stack.** Heimdall was removed 2026-05-27 to free ~200 MB RAM.

**Uptime monitoring:** use an external uptime service (e.g. UptimeRobot, Better Stack) pinging `https://chat.zixma.co/health`.

| Check | How |
|-------|-----|
| Public liveness | `GET https://chat.zixma.co/health` → 200 |
| DB | `GET https://chat.zixma.co/health/db` |
| Detailed JSON | `GET /health/metrics` with `x-chat-api-secret` (loopback/SSH only) |
| Traefik dashboard | `http://127.0.0.1:8080/dashboard/` (loopback) |

Local Docker development publishes `chat-service` on host port `3333` so it does not conflict with local `backoffice-frontend` on `3000`. The app container still listens on port `3000`.

## Persistence Model

Main collections:

- `users`
- `chat_sessions`

Chat session shape, conceptually:

- one row/document per `(agentId, customerId)`
- embedded `messages[]`
- `lastUpdated`
- retention field `expireAt`
- `lastReadByAgent`
- `lastReadByCustomer`

This means:

- conversation history is session-centric
- unread logic is computed from timestamps, not a per-message read flag
- data retention is a first-class business behavior

## Customer Widget Summary

Relevant area:

- `floating-chat/src`

Main facade:

- `floating-chat/src/service.ts`

What the widget does:

- opens a customer WebSocket session
- authenticates as `customer`
- loads history
- sends text and image messages
- marks messages read
- queues messages when disconnected
- handles reconnect and heartbeat
- maintains unread badge/UI behavior

Important contract:

- For the widget, the customer `token` must map to the target agent context.
- In current integration usage, `recipientId` and `token` should both be the target backoffice chat `agent-id`.
- `userId` may be a larger system login identity or `guest`.

Important architecture detail:

- The widget uses browser tab leadership with `BroadcastChannel`.
- Only one tab should own the real WebSocket.
- Follower tabs proxy through the leader and receive events through `BroadcastChannel`.
- This is a high-priority operational safeguard, not just a UX pattern.
- The reason is to prevent duplicate socket connections from many tabs and reduce server load.
- Preserve this invariant to stop socket fan-out and protect the backend.

Tab sync risk note from `.cursor/rules/floating-chat-tab-sync.mdc`:

- tab sync is considered fragile and high risk
- any change in `floating-chat/src/` that affects leadership, socket role switching, or shared event flow must be treated carefully
- changes should be tested with 2 or more tabs open
- do not casually add new `loadHistory()` call sites
- do not break content-based message dedup fallback
- broken dedup or broken tab sync creates duplicate messages and unnecessary socket pressure

Critical floating-chat files for tab sync safety:

- `floating-chat/src/services/tab-leader.ts`
- `floating-chat/src/services/connection-manager.ts`
- `floating-chat/src/services/tab-sync.ts` (`publishTabEvent()` / `onTabEvent()` for UI cross-tab events)
- `floating-chat/src/service.ts`
- `floating-chat/src/main.ts`

## Backoffice Chat Summary

Relevant area:

- `backoffice-frontend/src/services/chat`
- `backoffice-frontend/src/components/chat/main/Main.vue`

Ignore for this shared system:

- `backoffice-frontend/src/views/line/LineChat.vue`

Main backoffice chat service:

- `backoffice-frontend/src/services/chat/chat-service.js`

What the agent chat does:

- opens/authenticates an agent WebSocket connection
- polls `get_customers`
- loads history per selected customer
- sends text and image messages
- marks conversations read
- tracks reconnect state and connection limits
- merges server chat customers with backoffice member search/list data
- publishes `BACKOFFICE_MEMBERS_SYNC` on UI `tab-sync.js` when a tab merges backoffice member pages so follower tabs keep offline/no-session targets without repeating every HTTP page fetch
- follower tabs call `ensureBackofficeMembersLoaded()` after `CUSTOMERS_REFRESHED` and on `visibilitychange` when no `source: "backoffice"` rows exist yet

Key state:

- connection status
- customers list
- messages by conversation
- unread counts
- active chat
- member search and pagination state

Important UI behavior:

- customers are sorted primarily by latest message activity
- unread counts are maintained locally and refreshed from server payloads
- backoffice members without sessions can still be surfaced as potential chat targets

Important architecture detail:

- Backoffice chat also uses single-tab leadership with `BroadcastChannel`
- only one tab should own the real WebSocket connection
- `agent_username` is the shared inbox routing identity, not necessarily one physical admin.
- Multiple admins/devices may connect to the same backoffice chat scope and must not be blocked by a low per-user backend cap on `role: "agent"`.
- Backend per-user connection limits should protect customer/widget fan-out, while agent/backoffice connections remain governed by global/IP limits plus frontend tab sync.
- Backoffice follower sends must use ACK/NACK or timeout retry handling so messages are not silently lost during leader reconnect.
- Pending outbound message deduplication must use a per-message retry/client id, not only `to + content + messageType`, because operators can intentionally send identical text twice.
- Internal retry/client ids are frontend-only unless the backend WebSocket contract explicitly supports them.

Critical backoffice tab-sync files:

- `backoffice-frontend/src/services/chat/tab/tab-leader.js`
- `backoffice-frontend/src/services/chat/connection/websocket/connection-manager.js`
- `backoffice-frontend/src/services/chat/domain/message-service.js`
- `backoffice-frontend/src/services/chat/protocol/message-handler.js`
- `backoffice-frontend/src/services/chat/chat-service.js` (`publishTabEvent()` / `onTabEvent()` for UI cross-tab events)
- `backoffice-frontend/src/components/chat/main/Main.vue`

Mandatory backoffice tab-sync validation mindset:

- single tab should still connect, authenticate, load customers/history, and send messages
- two tabs in one browser/profile should have one real WebSocket owner
- follower tab send should be forwarded by the leader and displayed once
- leader reconnect/tab close should not lose queued follower messages
- repeated identical outbound text should not be dropped while offline/reconnecting
- live messages, `message_sent`, and history refresh should remain timestamp-sorted
- multiple admins/devices sharing the same `agent_username` should not be blocked by per-user backend caps
- follower tabs must mirror history when the leader tab receives it: leader publishes `HISTORY_RECEIVED` on UI `tab-sync.js` with `{ customerId, messages }` (including empty threads); leader tracks `conversationWith` on outbound `history` WS sends (`takePendingHistoryKey`) so follower-originated requests still resolve; treat `state.messages[customerId]` as loaded when the key exists even if the array is empty

## Image Flow

Shared image flow:

1. Client uploads image via `POST /api/upload-image`
2. Backend validates the active chat session, file type, and limits
3. Backend stores file in DigitalOcean Spaces
4. Backend returns `imageUrl`
5. Client sends a normal WebSocket `message` with `messageType: "image"` and `content = imageUrl`

Business implications:

- chat transport does not send raw image binary over WebSocket
- uploaded image URLs are part of stored conversation history
- image upload is authorized by the active chat session context, not by exposing `x-chat-api-secret` to browser clients

## Presence and Unread Logic

Presence:

- online/offline is determined from in-memory connection state
- not from a durable boolean field in MongoDB

Unread:

- agent unread count = customer messages after `lastReadByAgent`
- customer unread count = agent messages after `lastReadByCustomer`

Read marking:

- agents must specify which conversation they are marking
- customers mark their own conversation context

## Production Server (`chat.zixma.co`)

Host: DigitalOcean droplet `chat-services` (`178.128.61.53`), Ubuntu 22.04, **3.9 GiB RAM** + 2 GiB swap. Server ops reference: `/opt/apps/SERVER.md` on the droplet.

- Edge: Cloudflare (CDN + WAF, proxied) → **Traefik v3** (Docker, binds host `:80`/`:443`) → `chat-app:3000` + `chat-mongodb`.
- Widget static files: Traefik → `chat-cdn` container → `/opt/apps/floating-chat/dist/` (no copy step needed).
- System **nginx is disabled** (`systemctl disable nginx`); do not re-enable while Traefik runs (port conflict).
- **Heimdall (Prometheus/Grafana) removed 2026-05-27** (~200 MB freed). No on-host monitoring stack. Use external uptime on `https://chat.zixma.co/health`.
- Deploy: Bitbucket Pipelines on `main` → SSH `git reset --hard` + `docker compose build/up` (chat-service, floating-chat).
- Deploy guide: **`.feat/bc-log/deploy-2026-05-16.md`**.

**2026-05-26/27 production state:**

- MongoDB TTL index `expireAt_1` was dropped before retention-code deploy (cleanup is app-driven at 06:00).
- Heimdall removed to free RAM; swap was heavily used (~1.7 GiB / 2 GiB). Monitor with `free -m` and `docker stats`.
- Consider resizing droplet to **8 GB RAM** before heavy traffic; do not rely on swap alone.

Production `PORT`: container listens on **3000** (docker-compose overrides local `.env` `3333`). Purge Cloudflare cache for `/cdn/floating-chat.iife.js` after widget rebuild.

## Operational Behaviors

Observed/Documented operational patterns:

- message rate limiting exists
- connection-attempt rate limiting exists
- heartbeat keeps connections alive and closes dead sockets
- graceful shutdown closes sockets before process exit
- daily cleanup removes expired sessions and related storage artifacts
- emergency disablement of the floating-chat widget for all embedding sites: see `floating-chat/maintenance/README.md`

### Dev Chat Toggle (`CHAT_ENABLED`)

Set `CHAT_ENABLED=false` in `chat-service/.env` and restart the service to hide the chat UI on both frontends.

When disabled:
- `GET /api/chat-status` returns `{ enabled: false }` (always available, no auth needed, `Cache-Control: no-store`).
- All other routes (`/ws`, `/api/*`) remain fully functional — **no 503 blocking**.
- `floating-chat` widget fetches `/api/chat-status` at startup; if disabled it hides itself and skips tab leadership and socket init. Network failures are fail-open (chat proceeds normally).
- `backoffice-frontend` fetches `/api/chat-status` on mount; if disabled the entire chat panel is hidden via `v-if` and `chatService.connect()` is never called.

Default is `true` — existing deployments without the variable are unaffected.

## Broadcast Feature

Implemented in `chat-service`. The broadcast feature lets an agent send one message to many online customers simultaneously.

### REST Endpoints (all behind `x-chat-api-secret`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/broadcast` | Submit a new broadcast job |
| `GET`  | `/api/broadcast/:jobId` | Poll job status |
| `POST` | `/api/broadcast/:jobId/retry-failed` | Re-enqueue failed recipients (no new rate-limit slot) |

#### `POST /api/broadcast`

Request body:
```json
{
  "agentToken": "string",
  "requestedBy": "string",
  "content": "string (max 500 chars)",
  "imageUrl": "string (optional)",
  "recipientIds": ["string", "..."] // max 100; see "Broadcast recipient scope" below
}
```

Responses:
- `202 Accepted`: `{ "jobId": "string", "total": number, "acceptedAt": "ISO-8601" }`
- `400 Bad Request`: `{ "error": "string" }` — validation failure
- `429 Too Many Requests`: `{ "error": "string", "retryAfterMs": number }` — rate limit hit

#### `GET /api/broadcast/:jobId`

Required query param: `agentToken` (must match the token that created the job; returns 403 if mismatched, 400 if missing).

Response: `{ "jobId": "string", "phase": "queued|running|completed|partial|failed", "total": number, "sent": number, "failed": number, "startedAt": "ISO-8601?", "finishedAt": "ISO-8601?" }`

#### `POST /api/broadcast/:jobId/retry-failed`

Request body: `{ "agentToken": "string" }` — required; returns 403 if the token does not match the job owner.

Response: `{ "jobId": "string", "retriedCount": number }`

### Job Lifecycle

`queued → running → completed | partial | failed`

A broadcast is **done** only when every `broadcast_recipients` row is in a terminal state (`sent` or `failed`). HTTP 202 means accepted and queued, NOT delivered.

Recipient state: `pending → sent | failed`

### Rate Limit

- **Scope**: per `agentToken` (shared inbox — all operators sharing the same token share one hourly budget).
- **Rule**: max **`BROADCAST_RATE_LIMIT_MAX_PER_WINDOW`** broadcasts per rolling window (default **3**). Broadcasts can be sent back-to-back; the limit is count-based, not spacing-based.
- **Window**: sliding window of **`BROADCAST_RATE_LIMIT_WINDOW_MS`** milliseconds (default 3,600,000 = 1 hour).
- **`retryAfterMs`**: time until the oldest job in the current window falls out, freeing a slot.
- Set `BROADCAST_RATE_LIMIT_WINDOW_MS=0` in local `.env` to **disable** rate limiting entirely.
- **429 response**: includes `retryAfterMs` (server-authoritative countdown for the UI).

### Broadcast recipient scope

A recipient is accepted by `POST /api/broadcast` when **either** of these holds:

1. The customer is currently online (`activeUsers[id].role === 'customer'`) **and** their session token equals the submitting `agentToken`, **or**
2. The customer id appears in this agent's `tokenCustomerMap[agentToken]` set, even if they are not in `activeUsers` right now (e.g. mid-reconnect, briefly offline).

This is intentional — strict online-only would drop customers who blink offline during the request. The worker still persists each message to the `(agentId, customerId)` session, so an offline-at-submit customer receives it on next fetch/reconnect. The 400 response only fires when **neither** condition holds (true out-of-scope id).

### Security

- **Per-agent job ownership**: `GET /api/broadcast/:jobId` and `POST /api/broadcast/:jobId/retry-failed` both require the caller's `agentToken` (query param / body field). The service verifies `job.agentToken === providedAgentToken` and returns `403 Forbidden` on mismatch. This prevents one agent from polling or retrying another agent's broadcast jobs.

### Architecture Decisions

1. **Rate limit scope**: per `agentToken`. Two admins on the same inbox share the budget.
2. **Worker / queue**: `worker_threads` (one worker in the same Node process). No BullMQ / Redis / external queue.
3. **Completion semantics**: A broadcast is fully done when all `broadcast_recipients` rows are terminal. HTTP 202 = accepted only.
4. **Auth**: `x-chat-api-secret` header on all three broadcast endpoints (same as other admin routes).
5. **TOCTOU rate-limit protection**: `broadcast-service.ts` uses a per-agentToken async mutex (`withSubmitLock`) to serialize the rate-limit check + job insert. This is single-node only; a distributed lock is needed if the service scales horizontally.
6. **Broadcast idempotency**: Before `saveMessage`, the worker checks `chat_sessions` for existing messages with the same `broadcastJobId` for that `customerId`. If found, the message is not saved again — the existing message ID is reused and the recipient is marked sent. This prevents duplicates on worker crash + restart.
7. **Partial-phase cleanup**: The data cleanup job treats `partial` as a terminal phase (same as `completed` and `failed`). Partial broadcast jobs older than the retention window are deleted to prevent unbounded collection growth.

### Backoffice frontend (`backoffice-frontend`)

- The Broadcast tab calls the three REST endpoints on the **chat-service HTTP origin** derived from `VITE_WS_CHAT_URL` (same base as `/api/upload-image`).
- Requests send `x-chat-api-secret` from **`VITE_CHAT_API_SECRET`** (must match `CHAT_API_SECRET` in chat-service). This value is embedded in the built backoffice bundle — acceptable when operators are trusted and no separate backoffice API proxy is available.
- Optional hardening (requires infra owner): add a Traefik middleware that injects the secret server-side, so `VITE_CHAT_API_SECRET` does not need to be embedded in the browser bundle.
- **Tab sync**: non-leader tabs forward broadcast HTTP via `BroadcastChannel` (`FOLLOWER_HTTP`); only the leader tab performs `fetch`, matching the WebSocket follower-send pattern.
- **Banner sync**: the submitting tab publishes `BROADCAST_STATUS` on the UI `BroadcastChannel` (`tab-sync.js`) whenever `bannerPhase` changes; other tabs apply the payload through an `applyingRemoteStatus` flag to avoid echo loops. State synced: `phase`, `sent`, `total`, `failed`, `errorText`, `rateLimitEndsAt`. Per-tab state (draft text/selection, `isSending`, `currentJobId`) stays local.

### MongoDB Collections

- `broadcast_jobs`: `{ _id, agentToken, requestedBy, content, imageUrl?, total, sent, failed, phase, createdAt, startedAt?, finishedAt?, lastError? }`
- `broadcast_recipients`: `{ _id, jobId, customerId, state, messageId?, error?, sentAt?, attempts }`
- Index: `broadcast_jobs(agentToken, createdAt -1)` for rate-limit query
- Index: `broadcast_recipients(jobId, state)` for worker drain query

### Worker Behavior

- Spawned from `index.ts` after DB connects; terminated before DB closes on shutdown.
- Maintains its own MongoDB connection (does NOT share the main thread's DB singleton).
- On startup, resumes any `queued` or `running` jobs (restart-safe; in-flight recipients stay `pending`).
- Delivers in batches of 20, with concurrency ≤ 5 per batch.
- Posts `{ type: 'broadcastToUser' }` to main thread for live WS delivery to online recipients.
- Persists the message in `chat_sessions` regardless of online status (matches normal chat behavior).

### Metrics (no PII in labels)

- `broadcast_jobs_total{result}` — result = `accepted`, `rate_limited`
- `broadcast_recipients_total{state}` — state = `sent`, `failed`
- `broadcast_rate_limited_total` — simple counter for 429 responses

### Delivery Note

Each broadcast delivers a **normal** `message` event to each customer's WebSocket. Customers see it as a regular agent message in their `(agentId, customerId)` session history. The stored message carries a `broadcastJobId` field for analytics; existing readers ignore unknown fields.

If `imageUrl` is provided, the delivery type is `image` and the content is the image URL (matches the existing chat image pattern). If only `content` (text), type is `text`.

## Known Issues and Accepted Risks

Tracked in **Jira**, not in this file: project/space `ZLC` named **Chat** on `nutcom3.atlassian.net`, via the Atlassian MCP. This repo uses only the Chat Jira space; do not search, create, or update issues in other Jira spaces for chat work. Found an unfixed issue or a risk? Log it as a ticket — do not fix silently.

### Jira Ticket Rules

When Claude, Codex, or Cursor finds an issue/risk during work and does not fix it in the same session, create or update a Jira ticket in project `ZLC` / Chat.

Title format:

```text
[Codex|Claude|Cursor][reviewer|qa|leader] - Short ticket title
```

- First tag: AI/tool that created the ticket.
- Second tag: role that found the issue (`reviewer`, `qa`, or `leader`).

Description format:

```text
Description:
Explain the issue and the intended fix or investigation path.

Test Plan:
Explain how to verify the fix or investigation result.
```

Labels:

- Include the affected surface: `backoffice`, `floating-chat`, or `chat-service`.
- Include the environment: `prod` or `local`.
- Include specific topic labels when useful, for example `sharedworker`.

Paused work: backoffice chat SharedWorker rollout is blocked — see Epic `ZLC-5` (backlog) and `.feat/shared-w/`.

## Files Worth Re-Reading First

When starting future chat work, begin with these:

- `chat-service/src/routes/websocket.ts`
- `chat-service/src/services/message-service.ts`
- `chat-service/src/services/chat-service.ts`
- `chat-service/src/services/connect-service.ts`
- `chat-service/src/utils/ws-utils.ts`
- `chat-service/DOCUMENT.md` when present
- `.cursor/rules/floating-chat-tab-sync.mdc`
- `floating-chat/src/service.ts`
- `floating-chat/src/services/connection-manager.ts`
- `backoffice-frontend/src/services/chat/chat-service.js`
- `backoffice-frontend/src/services/chat/protocol/message-handler.js`
- `backoffice-frontend/src/components/chat/main/Main.vue`

## Update Rule for This File

Update this file whenever we learn:

- a new business rule
- a protocol detail
- a code path that changes the mental model
- a doc-vs-code mismatch
- a production/staging behavior that changes implementation assumptions

Keep additions short, concrete, and reality-based.
