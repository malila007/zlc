# chat-task Dev Workflow Harness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one project skill `/chat-task` that drives a fixed dev pipeline (plan → one approval gate → Codex implements in a detached worktree → build/test → Claude read-only review → QA) for any chat task.

**Architecture:** Single instruction file `.claude/skills/chat-task/SKILL.md`. No runner code, no new infra. The skill tells Claude how to orchestrate existing tools: planning (Claude), `codex exec` for implementation/fix loops (Codex), Bash for build/test gates (Harness), Playwright MCP + `e2e-chat-test.js` for QA. Reports are markdown files under `.notes/sessions/`.

**Tech Stack:** Markdown skill file; `git worktree add --detach`; `codex exec -C <dir> -s workspace-write`; `npm run build` / `npm test` per package; Playwright MCP.

Spec: `docs/superpowers/specs/2026-06-23-chat-task-harness-design.md`

---

## File Structure

- Create: `.claude/skills/chat-task/SKILL.md` — the entire harness. One responsibility: orchestrate the pipeline.

No other files. Auto-detect logic and report writing are inline bash/instructions in the skill, not separate modules.

Version control: the harness never commits, pushes, or creates a branch. The user names the branch and merges. Tasks below contain **no** `git commit` steps by design (global rule + spec).

---

### Task 1: Write the complete `/chat-task` skill

**Files:**
- Create: `.claude/skills/chat-task/SKILL.md`

- [ ] **Step 1: Create the skill file with full content**

Write `.claude/skills/chat-task/SKILL.md` with exactly this content:

````markdown
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

## Stage 3 — Implement (Codex, detached worktree)

```bash
TOPIC="<topic>"                 # same slug as the report folder
WT="/tmp/chat-task-$TOPIC"
git worktree add --detach "$WT" HEAD
```

Write the approved execution plan to `$WT/.codex-plan.md` (goal, ordered steps, files to
touch, acceptance checks). Then run Codex in the worktree:

```bash
codex exec -C "$WT" -s workspace-write --skip-git-repo-check \
  "Read .codex-plan.md in this repository and implement it exactly. Do not deviate from the plan or add unrequested changes."
```

## Stage 4 — Verify (Harness: build + test)

Detect touched packages and run their gates:

```bash
CHANGED=$(git -C "$WT" diff --name-only HEAD)
echo "$CHANGED" | grep -q '^chat-service/'        && (cd "$WT/chat-service" && npm run build && npm test)
echo "$CHANGED" | grep -q '^floating-chat/'       && (cd "$WT/floating-chat" && npm run build && npm test)
echo "$CHANGED" | grep -q '^backoffice-frontend/' && (cd "$WT/backoffice-frontend" && npm run build)
```

(backoffice-frontend has no test script — build only.) Any non-zero exit = fail → Stage 5.

## Stage 5 — Fix verification failures (Codex)

Append the failure output to `$WT/.codex-plan.md` and re-run the Stage 3 `codex exec`
command. Repeat Stage 4 → Stage 5 until build and test are green. If it does not converge
after 3 rounds, stop and report to the user.

## Stage 6 — Review diff (Claude, read-only)

Read `git -C "$WT" diff HEAD`. Do **not** edit. Write
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
needs it to merge). Mention `git worktree remove "$WT"` as the cleanup command for later.

## Full E2E gate (only when the user asks or signals merge / prod)

Per PROJECT.md pre-release gate — requires the full local stack and 0 FAIL:

```bash
NODE_PATH=/home/togethel2/.npm/_npx/e41f203b7505f1fb/node_modules \
  node /home/togethel2/workspace/zigma/chat/e2e-chat-test.js
```

Gate = 0 FAIL (WARN does not block). Must include E2E-CHAT-SHARED-INBOX-VMB-MALI passing.
Needs both frontends pointing at local chat and `CHAT_ENABLED=true` (restore after). See
PROJECT.md "Pre-release E2E gate".
````

- [ ] **Step 2: Confirm the file is valid skill frontmatter**

Run: `head -4 .claude/skills/chat-task/SKILL.md`
Expected: shows `---`, `name: chat-task`, a `description:` line, `---`.

---

### Task 2: Dry-run the mechanical wiring

Verifies the worktree + Codex + build gate commands actually fire end to end, on a
throwaway no-op change. This is the real test for a non-code artifact.

**Files:** none created (uses a temp worktree, removed at the end).

- [ ] **Step 1: Create a detached worktree**

Run:
```bash
git worktree add --detach /tmp/chat-task-dryrun HEAD && git worktree list
```
Expected: worktree list shows `/tmp/chat-task-dryrun` with `(detached HEAD)` — **no new branch**.

- [ ] **Step 2: Write a trivial codex plan and run Codex in the worktree**

Run:
```bash
printf 'Goal: smoke test.\nStep 1: append the line "harness dry-run ok" to README.md (create it if absent).\nAcceptance: README.md contains that line.\n' > /tmp/chat-task-dryrun/.codex-plan.md
codex exec -C /tmp/chat-task-dryrun -s workspace-write --skip-git-repo-check \
  "Read .codex-plan.md in this repository and implement it exactly. Do not deviate from the plan or add unrequested changes."
```
Expected: Codex runs and edits `README.md` inside the worktree only.

- [ ] **Step 3: Confirm the change landed in the worktree, not the main workspace**

Run:
```bash
git -C /tmp/chat-task-dryrun diff --name-only HEAD
git -C /home/togethel2/workspace/zigma/chat status --porcelain | grep -c README || true
```
Expected: first command lists `README.md`; the main workspace shows the README change is **not** present there (worktree isolation holds).

- [ ] **Step 4: Confirm the package-detect + build gate works**

Run (uses chat-service since it has both build and test):
```bash
cd /tmp/chat-task-dryrun/chat-service && npm run build
```
Expected: `tsc` exits 0 (clean tree builds).

- [ ] **Step 5: Tear down the dry-run worktree**

Run:
```bash
git worktree remove --force /tmp/chat-task-dryrun && git worktree list
```
Expected: only the main worktree remains; no leftover branch.

---

## Self-Review

**Spec coverage:**
- Roles → tools (spec §"Roles → real tools") → Stages 1/3/4/6/8 in Task 1. ✅
- 9-stage flow + per-stage `.md` reports (spec §Flow) → Task 1 Stages 1–9. ✅
- Single approval gate (spec §Flow step 2) → Stage 2. ✅
- Detached worktree, no new branch (spec §Version control + user edit) → Stage 3 `--detach`, dry-run Step 1 asserts detached. ✅
- Per-task gate = build+test only; no lint (spec §Gates, §Non-goals) → Stage 4, no lint step anywhere. ✅
- Full E2E user-triggered only (spec §Gates) → separate section, explicitly not in the auto loop. ✅
- Shared-inbox iron rule (spec §Gates) → Stage 6 review checklist + skill iron rules. ✅
- No commit/push/branch by harness (spec §Version control) → stated in skill iron rules; no commit steps in plan. ✅
- Deliverable = one file (spec §Deliverable) → File Structure + Task 1. ✅

**Placeholder scan:** No TBD/TODO; full skill content embedded; all commands concrete. ✅

**Type consistency:** `$WT` / `$TOPIC` / `<topic>` / `<DATE>` used consistently across stages; report folder slug matches `TOPIC`. ✅
