#!/usr/bin/env bash
set -euo pipefail

fetch=1
verbose=0
for arg in "$@"; do
  case "$arg" in
    --no-fetch) fetch=0 ;;
    -v|--verbose) verbose=1 ;;
    -h|--help)
      printf '%s\n' "Usage: scripts/worktree-preflight.sh [--no-fetch] [--verbose]"
      exit 0
      ;;
    *) printf 'preflight: unknown argument: %s\n' "$arg" >&2; exit 64 ;;
  esac
done

worktree_top=$(git rev-parse --show-toplevel 2>/dev/null) || { printf 'preflight: not inside a git repository\n' >&2; exit 20; }
common_dir=$(git rev-parse --git-common-dir)
case "$common_dir" in
  /*) ;;
  *) common_dir="$worktree_top/$common_dir" ;;
esac
primary_top=$(cd "$(dirname "$common_dir")" && pwd)
script_dir=$(cd "$(dirname "$0")" && pwd)

if [ "$fetch" = 1 ]; then
  git fetch origin --prune --quiet || { printf 'preflight: git fetch origin failed\n' >&2; exit 20; }
fi
[ "$verbose" = 0 ] || git worktree list >&2

set +e
(cd "$primary_top" && bash "$script_dir/check-primary-fresh.sh" --quiet)
code=$?
set -e
case "$code" in
  0) printf 'preflight: PASS — primary main == origin/main\n' ;;
  30) printf "preflight: STOP — primary behind origin/main; run 'npm run sync:primary' in %s\n" "$primary_top" >&2 ;;
  31) printf 'preflight: STOP — primary diverged from origin/main; reconcile manually\n' >&2 ;;
  32) printf 'preflight: NOTE — primary ahead of origin/main; push or reconcile before parallel work\n' >&2 ;;
  33) printf 'preflight: STOP — missing local main or origin/main\n' >&2 ;;
  *) printf 'preflight: STOP — freshness check failed (%s)\n' "$code" >&2 ;;
esac
[ "$code" = 0 ] && exit 0
exit "$code"
