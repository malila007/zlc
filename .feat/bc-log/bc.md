# Broadcast Feature

**Status: Done** (backend + frontend, 2026-05-16). Rate limit refactored to count-based (2026-05-17).

## What it does

Agent selects up to 100 online customers, types text and/or attaches an image, and sends a broadcast. Each recipient gets it as a normal 1-on-1 chat message in their existing `(agentId, customerId)` session — no new WebSocket message type.

Delivery runs on a `worker_threads` worker so the main event loop is not blocked. Jobs persist in MongoDB; a restart resumes from `pending` rows.

## Locked decisions

| Decision | Choice |
|----------|--------|
| Rate limit scope | Per `agentToken` (shared inbox operators share one budget) |
| Rate limit rule | Max 3 per rolling 1-hour window (`BROADCAST_RATE_LIMIT_MAX_PER_WINDOW=3`, `BROADCAST_RATE_LIMIT_WINDOW_MS=3600000`) |
| Worker | `worker_threads` in the same Node process — no BullMQ / Redis |
| Job done = | Every `broadcast_recipients` row at terminal state (`sent`/`failed`), not the HTTP 202 |
| Auth | `x-chat-api-secret` on all broadcast REST routes |
| Image | two-message delivery when both imageUrl + text: **image first, text below** |
| `retryFailed` | Does NOT consume a new rate-limit slot |

## Key files

| File | Role |
|------|------|
| `chat-service/src/routes/broadcast.ts` | REST endpoints |
| `chat-service/src/services/broadcast-service.ts` | Validation, rate limit, job creation |
| `chat-service/src/services/broadcast-worker.ts` | Worker thread — fan-out delivery |
| `chat-service/src/repos/broadcast-repo.ts` | MongoDB CRUD |
| `chat-service/src/types/broadcast.ts` | Types |
| `backoffice-frontend/src/components/chat/broadcast/Main.vue` | UI |
| `backoffice-frontend/src/services/chat/chat-service.js` | `broadcast.submit/getStatus/retryFailed` |

## REST API

- `POST /api/broadcast` — body: `{ agentToken, requestedBy, content, imageUrl?, recipientIds[] }` → 202 `{ jobId, total, acceptedAt }` | 400 | 429 `{ error, retryAfterMs }`
- `GET /api/broadcast/:jobId` → `{ jobId, phase, total, sent, failed, startedAt, finishedAt? }`
- `POST /api/broadcast/:jobId/retry-failed` → `{ jobId, retriedCount }`

Job phases: `queued → running → completed | partial | failed`

## Env vars

```dotenv
BROADCAST_RATE_LIMIT_WINDOW_MS=3600000   # 0 = disabled (local dev only)
BROADCAST_RATE_LIMIT_MAX_PER_WINDOW=3    # max broadcasts per window
```

## Important notes

- Worker detects dev vs prod: if `__filename.endsWith('.ts')` → passes `execArgv: ['--require', 'tsx/cjs']`; prod = no execArgv.
- Worker posts `{ type: 'broadcastToUser' }` to main thread for live WS push (fire-and-forget; message already persisted).
- `VITE_CHAT_API_SECRET` in browser bundle — accepted risk. Same as nginx proxy header. Keep rotatable.
- MongoDB indexes: `broadcast_jobs(agentToken, createdAt -1)`, `broadcast_jobs(agentToken, createdAt 1)`, `broadcast_recipients(jobId, state)`.

## Open / next steps

- QA: happy path (3 recipients), partial + retry, 429 with rate limit on, restart mid-job, two-tab submit = one HTTP call.
- Minor (deferred from reviewer): `validateEnv` guard for negative `broadcastRateLimitMaxPerWindow`; fix hardcoded "per hour" in 429 error message; add `Retry-After` HTTP header.
