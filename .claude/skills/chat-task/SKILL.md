---
name: chat-task
description: Dev workflow harness for this chat repo. Use when the user assigns a chat dev task (bug fix or feature in chat-service, floating-chat, or backoffice-frontend chat) and wants the full pipeline — plan, single approval gate, Codex implementation in an isolated worktree, build/test gates, read-only review, and QA. Not a product feature.
---

# chat-task — dev workflow harness

Run a chat dev task through a fixed pipeline. Everything after the single approval
gate (Stage 2) is automatic. Each stage writes a report to
`.notes/sessions/<DATE>-<topic>-chat-task/` (`DATE` = today, `topic` = short kebab slug).

Iron rules, never violated:
- **One human gate only** — after planning (Stage 2). No other stage waits for the user.
- **Never** commit, push, or create a branch. The worktree is detached. The user names the branch and merges.
- **Shared-inbox invariant**: one agent + all its sub operators see the same backoffice
  inbox; players see separate chats. Any change near `resolveChatInboxId` / identity
  routing / `inbox-id.test.mjs` is a review red flag (see PROJECT.md).
- **Full E2E is user-triggered only** — run it when the user explicitly asks or signals
  merge / prod, never automatically per task.

## Stage 1 — Plan (Claude)

1. Read `PROJECT.md` and the most recent `.notes/sessions/` file first.
2. Analyze the requirement. Ask the user questions until you fully understand scope,
   behavior, data, permissions, UI states, errors, and acceptance criteria. Re-ask if
   anything is unclear — do not guess.
3. Create `.notes/sessions/<DATE>-<topic>-chat-task/plan-report.md` containing, in order:
   - **Understanding** — everything you understood from grooming, restated.
   - **Solution** — the approach.
   - **Execution plan** — ordered, concrete steps and which package(s)/files are touched.
   - **Test cases** — scenarios QA will run (from acceptance criteria).
   - **Expected output** — what "done" looks like.
4. Present the plan and ask: **"ถูกต้องไหม?"**

## Stage 2 — 🛑 Approval gate (user)

Wait for the user. If not approved, revise the plan and repeat Stage 1 until approved.
**Do not proceed past this point without explicit approval.**

## Stage 3 — Implement (Codex, detached worktree of the app repo)

This is a meta repo: `chat-service/`, `floating-chat/`, `backoffice-frontend/` are each
their **own** git repo (gitignored by the outer repo). The harness worktrees the app repo
the task touches — never the outer repo. For a multi-repo task, repeat per repo.

The mechanical worktree/build/test/e2e/cleanup work is the `chat-harness.sh` script (the
"Harness" actor). Create the worktree:

```bash
REPO="chat-service"             # app repo touched: chat-service | floating-chat | backoffice-frontend
TOPIC="<topic>"                 # same slug as the report folder
WT=$(/home/togethel2/workspace/zigma/chat/chat-harness.sh worktree "$REPO" "$TOPIC")
```

Write the approved execution plan to `$WT/.codex-plan.md` (goal, ordered steps, files to
touch, acceptance checks). Then run Codex in the worktree:

```bash
codex exec -C "$WT" -s workspace-write --skip-git-repo-check \
  "Read .codex-plan.md in this repository and implement it exactly. Do not deviate from the plan or add unrequested changes."
```

## Stage 4 — Verify (Harness: build + test)

Run the build + test gate via the harness (test auto-skipped where absent):

```bash
/home/togethel2/workspace/zigma/chat/chat-harness.sh verify "$WT"
```

Any non-zero exit = fail → Stage 5.

## Stage 5 — Fix verification failures (Codex)

Append the failure output to `$WT/.codex-plan.md` and re-run the Stage 3 `codex exec`
command. Repeat Stage 4 → Stage 5 until build and test are green. If it does not converge
after 3 rounds, stop and report to the user.

## Stage 6 — Review diff (Claude, read-only)

Read the full change set — `git -C "$WT" status --porcelain` (catches new files) and
`git -C "$WT" diff HEAD`. Do **not** edit. Write
`.notes/sessions/<DATE>-<topic>-chat-task/review-report.md` answering:
- Does the diff match the approved plan?
- Impact on the core paths: shared-inbox identity, tab-sync / leadership, presence,
  unread counts, message delivery, WebSocket contract?
- Regression / edge-case / security concerns?
Classify findings: **Must fix / Should fix / Nice to have**.

## Stage 7 — Fix review findings (Codex)

If any **Must fix** / **Should fix** finding exists, append them to `$WT/.codex-plan.md`,
re-run the Stage 3 `codex exec`, then go back to Stage 4 (build/test) and Stage 6 (review).
Repeat until review is clean.

## Stage 8 — QA (Playwright)

Run the test cases from `plan-report.md` against the worktree using Playwright MCP. For
chat-core scenarios, prefer the existing `e2e-chat-test.js` harness if applicable. Write
`.notes/sessions/<DATE>-<topic>-chat-task/qa-report.md` with each test case, steps, and
PASS/FAIL.

## Stage 9 — Final report

Write `.notes/sessions/<DATE>-<topic>-chat-task/final-report.md`:
- build ✅ / test ✅ / review clean ✅ / QA ✅
- worktree path (diff left there for the user to branch & merge)
- anything the user must do manually

Tell the user the diff is in `$WT`, unmerged. Do **not** remove the worktree (the user
needs it to merge). Cleanup command for later: `chat-harness.sh cleanup "$REPO" "$WT"`.

## Full E2E gate (only when the user asks or signals merge / prod)

Per PROJECT.md pre-release gate — requires the full local stack and 0 FAIL:

```bash
/home/togethel2/workspace/zigma/chat/chat-harness.sh e2e
```

Gate = 0 FAIL (WARN does not block). Must include E2E-CHAT-SHARED-INBOX-VMB-MALI passing.
Needs both frontends pointing at local chat and `CHAT_ENABLED=true` (restore after). See
PROJECT.md "Pre-release E2E gate".
