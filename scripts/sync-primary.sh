#!/usr/bin/env bash
set -euo pipefail

repo_top=$(git rev-parse --show-toplevel 2>/dev/null) || { printf 'sync-primary: not inside a git repository\n' >&2; exit 20; }
[ -d "$repo_top/.git" ] || { printf 'sync-primary: run from the primary checkout\n' >&2; exit 12; }
[ -z "$(git -C "$repo_top" status --porcelain=v1)" ] || { printf 'sync-primary: dirty working tree; refusing\n' >&2; exit 10; }
git -C "$repo_top" show-ref --verify --quiet refs/heads/main || { printf 'sync-primary: missing local main\n' >&2; exit 13; }

git -C "$repo_top" fetch origin --prune --quiet || { printf 'sync-primary: fetch failed\n' >&2; exit 20; }
local_sha=$(git -C "$repo_top" rev-parse refs/heads/main)
remote_sha=$(git -C "$repo_top" rev-parse refs/remotes/origin/main)
[ "$local_sha" != "$remote_sha" ] || { printf 'sync-primary: already current\n'; exit 0; }

behind=$(git -C "$repo_top" rev-list --count refs/heads/main..refs/remotes/origin/main)
ahead=$(git -C "$repo_top" rev-list --count refs/remotes/origin/main..refs/heads/main)
if [ "$ahead" -gt 0 ] && [ "$behind" -gt 0 ]; then
  printf 'sync-primary: main diverged; reconcile manually\n' >&2
  exit 11
fi
if [ "$ahead" -gt 0 ]; then
  printf 'sync-primary: main is ahead of origin/main; nothing to fast-forward\n'
  exit 0
fi

git -C "$repo_top" update-ref refs/heads/main "$remote_sha" "$local_sha"
printf 'sync-primary: fast-forwarded main by %s commit(s)\n' "$behind"
