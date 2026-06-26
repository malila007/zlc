# chat-task — Dev Workflow Harness (design)

Date: 2026-06-23
Status: design, pending user approval

## Goal

One project skill `/chat-task` that runs a fixed dev pipeline for the chat repo:
`requirement → plan (Claude) → 🛑 user approval → implement (Codex, worktree) → verify (build/test) → review (Claude, read-only) → fix loop → QA → report`.
Everything after the single approval gate is automatic. For-development only — not a product feature.

## Roles → real tools

| Role in the pipeline | Implemented by |
|---|---|
| Claude — plan + review | Me (planning-workflow, then read-only diff review) |
| Codex — write/fix code | `codex-bridge:codex-working` (plan to `.codex-plan.md`, Codex executes in worktree, workspace-write) |
| Harness — real verification | Bash running build/test; gate on exit code + summary |
| QA playwright | Playwright MCP + `e2e-chat-test.js` |

## Flow

Each stage writes a `.md` report to `.notes/sessions/YYYY-MM-DD-<topic>-chat-task/`.

1. **Claude — plan**: analyze, ask until fully understood (re-ask if not). `plan-report.md` must contain: full understanding, solution, execution plan, test cases, expected output. Ends asking "ถูกต้องไหม?".
2. **🛑 GATE (only human gate)** — user approves. Not approved → revise plan, repeat until approved.
3. **Codex — implement** in a git worktree (not create a new branch)
4. **Harness — verify**: `build` + `test` for the packages the diff touches (auto-detected). Fail → step 5.
5. **Codex — fix** verification failures → back to step 4 until green.
6. **Claude — review diff** (read-only): matches plan? impact on shared-inbox / tab-sync / presence / unread? → `review-report.md`.
7. **Codex — fix findings** → back to step 6 until clean.
8. **QA playwright**: run scenarios from the plan's test cases → `qa-report.md`.
9. **Final report** `final-report.md`: build ✅, test ✅, review clean ✅, QA ✅. Worktree diff left for the user.

## Gates

- **Per task (auto)**: build passes, test passes for touched packages.
- **Shared-inbox iron rule** (always checked in review + when `inbox-id.test.mjs` is in scope): one agent + all its sub operators see the same backoffice inbox; players see separate chats. Reviewer flags any change to `resolveChatInboxId` or identity routing.
- **Full E2E (0 FAIL)** — **user-triggered only**: runs when the user explicitly asks, or signals merge / prod. Uses the existing pre-release gate in `PROJECT.md` (full stack, `e2e-chat-test.js`, 0 FAIL, includes E2E-CHAT-SHARED-INBOX-VMB-MALI). Not run automatically per task.

## Version control

- **Meta-repo layout** (verified 2026-06-23): the outer repo gitignores `chat-service/`, `floating-chat/`, `backoffice-frontend/` — each is its **own** git repo (on `feat/slip`). The harness worktrees the **app repo** the task touches, not the outer repo. `node_modules` is symlinked from the main checkout so build/test run in the worktree.
- Codex works in a detached git worktree (`git worktree add --detach`) for isolation.
- **No push, no auto-named branch, no commit** by the harness. The user names the branch and merges. Harness leaves the diff in the worktree. (Consistent with global version-control rule.)

## Non-goals (YAGNI)

- No lint (no lint script exists in any package).
- No CI/cron/standalone runner — runs inside a Claude session, matching how tasks are assigned.
- Full E2E is not part of the automatic per-task loop.

## Build/test commands (verified 2026-06-23)

| Package | build | test |
|---|---|---|
| chat-service | `tsc` | `vitest run` |
| floating-chat | `tsc && vite build` | `vitest run` |
| backoffice-frontend | `vite build` | (none) |

## Deliverable

- `.claude/skills/chat-task/SKILL.md` — the pipeline (judgment stages: plan, review, QA orchestration).
- `chat-harness.sh` — the deterministic "Harness" actor: `worktree` / `verify` (build+test) / `e2e` / `cleanup`. The skill calls it for all mechanical work. Proven 2026-06-23 (chat-service build + 372 tests pass).
