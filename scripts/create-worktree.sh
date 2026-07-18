#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  printf 'Usage: scripts/create-worktree.sh <issue> <slug> [feat|fix|docs|chore]\n' >&2
  exit 64
fi

issue=$1
slug=$2
kind=${3:-feat}
case "$issue" in *[!0-9]*) printf 'worktree-create: issue must be numeric\n' >&2; exit 64 ;; esac
case "$kind" in feat|fix|docs|chore) ;; *) printf 'worktree-create: invalid kind: %s\n' "$kind" >&2; exit 64 ;; esac
case "$slug" in *[!a-z0-9-]*|'') printf 'worktree-create: slug must use lowercase letters, digits, and hyphens\n' >&2; exit 64 ;; esac

script_dir=$(cd "$(dirname "$0")" && pwd)
bash "$script_dir/worktree-preflight.sh"

repo_top=$(git rev-parse --show-toplevel)
common_dir=$(git rev-parse --git-common-dir)
case "$common_dir" in /*) ;; *) common_dir="$repo_top/$common_dir" ;; esac
primary_top=$(cd "$(dirname "$common_dir")" && pwd)
parent=$(dirname "$primary_top")
repo_name=$(basename "$primary_top")
branch="$kind/$issue-$slug"
path="$parent/$repo_name-$issue"

[ ! -e "$path" ] || { printf 'worktree-create: path already exists: %s\n' "$path" >&2; exit 12; }
! git show-ref --verify --quiet "refs/heads/$branch" || { printf 'worktree-create: branch already exists: %s\n' "$branch" >&2; exit 13; }

git worktree add "$path" -b "$branch" origin/main
printf 'worktree-create: PASS — %s on %s\n' "$path" "$branch"
printf 'Next: cd %s && npm ci\n' "$path"
