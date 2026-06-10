# vmb / mali168 shared inbox E2E verification

## Goal
Verify the production-style shared inbox testcase where `vmb` and sub operator `mali168` must see and operate on the same floating-chat conversation, including multiple tabs and connection stability.

## What changed
- Updated `PROJECT.md` pre-release E2E gate with the `vmb` test credential and a durable P0 testcase: `E2E-CHAT-SHARED-INBOX-VMB-MALI`.

## Decisions
- The testcase belongs in `PROJECT.md` because it protects durable production behavior and the pre-release E2E gate.
- `vmb` is a non-sub account whose login username is `vmb`, while `MEMBER_USERNAME_LOGIN` from `me()` is `agentdemo`; routing must still use `MEMBER_USERNAME = "vmb"`.

## Open / next steps
- Add this testcase to the committed automated E2E harness when editing `e2e-chat-test.js` next.
- Existing backoffice dashboard/noti console noise remains outside the chat flow: dashboard chart/Vue warnings and `notification.zixma.co` 522.

## Notes for next session
- Verified 2026-06-10 with production chat origin via Playwright temp harness: `34 PASS / 0 FAIL / 0 WARN`.
- Evidence JSON: `/tmp/verify-vmb-mali-ui-floating-1781060718924.json`.
- Screenshots:
  - `/tmp/verify-vmb-ui-tab0-1781060718924.png`
  - `/tmp/verify-vmb-ui-tab1-1781060718924.png`
  - `/tmp/verify-mali-ui-tab0-1781060718924.png`
  - `/tmp/verify-mali-ui-tab1-1781060718924.png`
  - `/tmp/verify-fc-ui-tab0-1781060718924.png`
  - `/tmp/verify-fc-ui-tab1-1781060718924.png`
