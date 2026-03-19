#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

WORK_BRANCH="codex/temp-assignees-and-ai-bulk"
MAIN_BRANCH="main"

info() { echo "[INFO] $1"; }
pass() { echo "[PASS] $1"; }
fail() { echo "[FAIL] $1" >&2; exit 1; }

require_git_repo() {
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "Not a git repository"
}

ensure_clean_or_warn() {
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "[WARN] Working tree is not clean. Commands that switch branches may fail."
    git status --short
  fi
}

fetch_prune() {
  info "Fetching and pruning origin"
  git fetch --prune origin
  pass "origin refs updated"
}

show_status() {
  info "Current branch"
  git branch --show-current

  info "Tracked local branches"
  git branch -vv

  info "Ahead/behind overview"
  git for-each-ref --format='%(refname:short) %(upstream:short) %(upstream:trackshort)' refs/heads

  info "Short status"
  git status --short --branch
}

sync_branch_ff_only() {
  local branch="$1"
  ensure_clean_or_warn
  fetch_prune

  info "Switching to $branch"
  git switch "$branch"

  info "Fast-forward pull for $branch"
  git pull --ff-only origin "$branch"
  pass "$branch synced"
}

usage() {
  cat <<USAGE
Usage: scripts/git-branch-lanes.sh <command>

Commands:
  status       Show branch roles and ahead/behind summary
  fetch        git fetch --prune origin
  sync-main    Switch to main and pull --ff-only
  sync-work    Switch to ${WORK_BRANCH} and pull --ff-only
  back-work    Shortcut: switch to ${WORK_BRANCH}
USAGE
}

main() {
  require_git_repo

  case "${1:-}" in
    status)
      show_status
      ;;
    fetch)
      fetch_prune
      ;;
    sync-main)
      sync_branch_ff_only "$MAIN_BRANCH"
      ;;
    sync-work)
      sync_branch_ff_only "$WORK_BRANCH"
      ;;
    back-work)
      git switch "$WORK_BRANCH"
      pass "Switched to $WORK_BRANCH"
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
