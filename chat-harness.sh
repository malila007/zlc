#!/usr/bin/env bash
# Deterministic harness for /chat-task. Judgment stages (plan, review) live in the
# .claude/skills/chat-task skill; this script is the mechanical "Harness" actor:
# worktree management + build/test gate + full E2E + cleanup. Single-machine dev tool.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat >&2 <<'EOF'
chat-harness.sh <command>
  worktree <repo> <topic>   create detached worktree of an app repo + symlink node_modules; prints the path
  verify   <worktree>       run build + test (test skipped where absent); nonzero exit on failure
  e2e                       run the full E2E gate (0 FAIL required)
  cleanup  <repo> <worktree> remove the worktree (run after you have merged)
  repo = chat-service | floating-chat | backoffice-frontend
EOF
  exit 2
}

cmd="${1:-}"; shift || true
case "$cmd" in
  worktree)
    [ $# -eq 2 ] || usage
    repo="$1"; topic="$2"; wt="/tmp/chat-task-$topic-$repo"
    git -C "$ROOT/$repo" worktree add --detach "$wt" HEAD >&2
    [ -d "$ROOT/$repo/node_modules" ] && ln -sfn "$ROOT/$repo/node_modules" "$wt/node_modules"
    echo "$wt"
    ;;
  verify)
    [ $# -eq 1 ] || usage
    cd "$1"
    npm run build
    npm run test --if-present
    ;;
  e2e)
    NODE_PATH="$ROOT/node_modules" \
      node "$ROOT/e2e-chat-test.js"
    ;;
  cleanup)
    [ $# -eq 2 ] || usage
    repo="$1"; wt="$2"
    rm -f "$wt/node_modules"
    git -C "$ROOT/$repo" worktree remove --force "$wt"
    ;;
  *) usage ;;
esac
