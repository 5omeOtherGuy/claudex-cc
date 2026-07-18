#!/usr/bin/env bash
set -euo pipefail

quiet=0
for arg in "$@"; do
  case "$arg" in
    -q|--quiet) quiet=1 ;;
    -h|--help)
      printf '%s\n' "Usage: scripts/check-primary-fresh.sh [--quiet]"
      exit 0
      ;;
    *) printf 'check-primary-fresh: unknown argument: %s\n' "$arg" >&2; exit 64 ;;
  esac
done

emit() { [ "$quiet" = 1 ] || printf 'check-primary-fresh: %s\n' "$*" >&2; }

repo_top=$(git rev-parse --show-toplevel 2>/dev/null) || { emit "not inside a git repository"; exit 34; }
[ -d "$repo_top/.git" ] || exit 0

git -C "$repo_top" show-ref --verify --quiet refs/heads/main || { emit "missing local main"; exit 33; }
git -C "$repo_top" show-ref --verify --quiet refs/remotes/origin/main || { emit "missing origin/main; fetch first"; exit 33; }

local_sha=$(git -C "$repo_top" rev-parse refs/heads/main)
remote_sha=$(git -C "$repo_top" rev-parse refs/remotes/origin/main)
[ "$local_sha" = "$remote_sha" ] && exit 0

behind=$(git -C "$repo_top" rev-list --count refs/heads/main..refs/remotes/origin/main)
ahead=$(git -C "$repo_top" rev-list --count refs/remotes/origin/main..refs/heads/main)

if [ "$ahead" -gt 0 ] && [ "$behind" -gt 0 ]; then
  emit "main diverged from origin/main (ahead $ahead, behind $behind)"
  exit 31
fi
if [ "$behind" -gt 0 ]; then
  emit "main is behind origin/main by $behind commit(s)"
  exit 30
fi
if [ "$ahead" -gt 0 ]; then
  emit "main is ahead of origin/main by $ahead commit(s)"
  exit 32
fi
