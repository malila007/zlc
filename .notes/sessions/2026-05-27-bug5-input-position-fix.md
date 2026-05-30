# Session: BUG #5 — Input Field Wrong Position After Reconnect

**Date:** 2026-05-27
**Branch:** HEAD

---

## Goal

Fix the chat input field rendering at the wrong position (near customer list entry instead of bottom of conversation panel) after a dashboard reconnect event.

---

## What Changed

### Fix 1 — `isReconnecting` state leak
**File:** `backoffice-frontend/src/services/chat/chat-service.js` (line 229)
Added `this.state.isReconnecting = false;` inside `_handleAuthenticated()`, immediately after `this.state.isConnected = true;`.

Previously, `transport.onReconnected()` called `_handleAuthenticated()` but that method never reset `isReconnecting`. It stayed `true` forever after each reconnect, permanently blocking the `startCustomersRefresh` poll (which guards on `!state.isReconnecting`).

### Fix 2 — CSS flex layout instability (3 class changes)
**File:** `backoffice-frontend/src/components/chat/main/conversation.vue` (line 2)
Removed `h-full` from root div. `flex-1 min-h-0` alone is correct — `h-full` conflicted with flex-stretch parent height.

**File:** `backoffice-frontend/src/components/chat/main/Main.vue` (lines 127, 140)
Added `min-h-0 overflow-hidden` to both the left column (customer list) and right column (conversation panel). Prevents height bleed when the offline banner appears/disappears during reconnect, which was causing the flex reflow that mispositioned the input.

---

## Decisions

- Fix 3 (customer list sort lock) explicitly excluded from this scope.
- All changes assigned to `frontend` role — no backend or API impact.
- `h-full` removal on `conversation.vue` is safe: the inner `messagesContainer` div uses `h-full` and relies on the flex-stretch chain, which is now unambiguous.

---

## Open / Next Steps

- E2E gate (`e2e-chat-test.js`, 56 tests) was NOT run — all three servers (`:3000`, `:5173`, `:3333`) were offline at time of implementation. Must run before any prod deployment.
- Manual QA still needed: trigger a reconnect, confirm input stays pinned; check `chatService.state.isReconnecting === false` in console after reconnect.

---

## Notes for Next Session

- The `isReconnecting` flag is set in three places in `chat-service.js`: line 98 (onReconnecting), line 100 (onReconnectFailed), and now line 229 (onReconnected via `_handleAuthenticated`). Keep these in sync if transport logic changes.
- Pre-release E2E gate is mandatory per `CLAUDE.md` — ensure servers are up before shipping.
