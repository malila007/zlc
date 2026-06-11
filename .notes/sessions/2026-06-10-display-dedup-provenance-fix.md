# Display dedup provenance fix

## Goal
Fix display deduplication so intentionally repeated messages with different server ids are shown in both backoffice and floating-chat, while preserving duplicate protection for repeated ids and legacy client-fallback ids.

## What changed
- Added `hasServerId` provenance to backoffice mapped messages and floating-chat `ChatMessage` / internal display messages.
- Changed BO and FC display dedup to use id matches first, and content+time+direction fallback only when one side lacks a server id.
- Preserved legacy protection where a live message rendered with a fallback id is later replayed by history with a real server id.
- Updated floating-chat and shared project docs to describe the provenance-scoped fallback instead of the stale "live has no id" rule.
- Added focused BO and FC regression tests for repeated real-id text and guard cases.

## Decisions
- Missing `hasServerId` defaults to false, keeping fallback behavior conservative for any unmapped path.
- System messages are ignored by FC content fallback so they cannot suppress normal user/agent messages with the same text.

## Open / next steps
- Manual two-tab verification was not run in this session because the local stack was not started.
- Full pre-release E2E remains required before production release.

## Notes for next session
- Verified:
  - `floating-chat`: `npx vitest run` => 5 files, 19 tests passed.
  - `floating-chat`: `npm run build` passed.
  - `backoffice-frontend`: `node --test src/services/chat/test/*.mjs` => 23 tests passed.
  - `backoffice-frontend`: `NODE_OPTIONS=--max-old-space-size=4096 npm run build` passed.
- Backoffice Node tests still print the existing module type warning for ESM parsing.
