# shared-w — Architecture (backoffice chat)

Code-level design of the SharedWorker path, from the current source. All paths under `backoffice-frontend/src/services/chat/`.

## Components

| File | Role |
|------|------|
| `connection/shared-worker/chat-worker.js` | The SharedWorker. Owns the **single** WebSocket shared by all tabs. |
| `connection/shared-worker/worker-loader.js` | `import chatWorkerUrl from './chat-worker.js?url'` → one static asset URL for every tab. |
| `connection/transport/worker-transport.js` | `WorkerTransport` — page-side bridge to the worker port. Same surface as `ConnectionManager`. |
| `connection/transport/bc-transport.js` | `BcTransport` — fallback. Wraps the unchanged `ConnectionManager` + `initTabLeadership` (the tab-leader path). |
| `chat-service.js` | `_buildTransport()` factory + runtime fallback (`_switchToBcTransport`). |
| `config.js` | `USE_SHARED_WORKER` flag + worker constants. |

`chat-service.js` is transport-agnostic: both transports expose the same method surface (`connect`, `disconnect`, `send`, `onMessage`, `onConnected`, …), so the rest of the service does not know which path is live.

## Transport selection (`_buildTransport`)

```
USE_SHARED_WORKER && !_workerTransportBlocked && typeof SharedWorker !== "undefined"
  → WorkerTransport   (sets _usingWorkerTransport = true)
else
  → BcTransport       (tab-leader path; current prod default)
```

Runtime fallback: `_switchToBcTransport(reason)` swaps to `BcTransport` and sets `_workerTransportBlocked = true` when the worker can't start or its reconnect exhausts (`onReconnectFailed`). `_usingWorkerTransport` also gates the auth path and `VISIBILITY_RESTORED` handling.

## The worker (`chat-worker.js`)

One WebSocket, owned independently of any tab. State machine phase is broadcast to all ports as `STATE_SNAPSHOT`:

`idle → connecting → authenticating → connected` ; on drop `→ reconnecting → …` ; after cap `→ failed`.

Owns:
- **Auth**: on WS open, waits `AUTH_DELAY_AFTER_OPEN_MS` (100 ms — CF may drop the first frame), then sends `{ type: "authenticate", userId, role: "agent", token, clientSource: "backoffice" }`. If token/userId missing → broadcasts `AUTH_REQUIRED`.
- **Heartbeat**: ping every 30 s, close WS if no pong within 55 s.
- **Reconnect**: exponential backoff base 800 ms, max 10 s, +500 ms jitter, **max 6 attempts**. Clean (1000) / manual (1001) closes do not reconnect.
- **Message queue**: `SEND`s received before auth are queued and flushed on `authenticated`.
- **Ports**: `Set` of ports + `portLastSeen` map. Prunes a port after `PORT_PRUNE_AFTER_MS` (15 s) with no `PORT_PING` (no port-close event exists in the spec).
- **Idle hold**: when the last port leaves, keep the WS open `IDLE_HOLD_MS` (3 s) so a single-tab refresh does not drop the connection; close only if no port returns.

Critical: on `authenticated`, the worker sets phase `connected` and **does not** relay the raw `authenticated` frame — `STATE_SNAPSHOT: connected` is the single auth signal. Relaying it too would double-fire `_handleAuthenticated()` on the page.

## Port protocol

**Page → worker:** `PORT_INIT`, `PORT_PING`, `CONNECT`, `DISCONNECT`, `MANUAL_RECONNECT`, `BLOCK_RECONNECT`, `SEND` (`{clientSendId, msg}`), `AUTH_REFRESH`, `LOGOUT`, `VISIBILITY_RESTORED`.

**Worker → page:** `WORKER_READY`, `STATE_SNAPSHOT` (`{phase, reconnectAttempt}`), `WS_MESSAGE` (`{data}`), `SEND_ACK` (`{clientSendId}`), `SEND_NACK` (`{clientSendId, reason}`), `AUTH_REQUIRED`, `LOGOUT_ACK`.

`WorkerTransport` maps `STATE_SNAPSHOT` phase → reactive `state` flags (`isConnecting`/`isAuthenticating`/`isReconnecting`/`isConnected`) and fires `onConnected` / `onReconnected` (distinguished by previous phase) / `onReconnecting` / `onDisconnected` / `onReconnectFailed`.

## Key design decisions

- **Worker name scoped per agent**: `new SharedWorker(url, { name: "chat-" + agentId })` — prevents cross-user state sharing on a shared machine. Identity change in `CONNECT` tears down and reconnects.
- **Static `?url` asset, never a Blob URL.** Each document creates a unique Blob URL at runtime; `SharedWorker` only shares one instance when the URL string is identical across tabs. A Blob URL → one worker (and one WS) per tab — the exact bug this round originally shipped and then fixed.
- **`isFollower = false` always** on the worker path — every tab is equal; there is no leader/follower roles, so no leader-refresh race.
- **History stays page-side** (`HistoryManager` unchanged); the worker only owns transport + queue.
- **`leaderHttpJson` does a direct `fetch`** on the worker path (no leader forwarding needed).

## What stays unchanged either way

`tab-leader.js`, `tab-sync.js`, `connection-manager.js`, `message-handler.js`, `state.js` are shared by both transports. `BcTransport` is a thin wrapper over the original tab-leader stack, so disabling the flag is a clean revert to prior behavior.
