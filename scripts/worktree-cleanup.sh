#!/usr/bin/env bash
set -euo pipefail

path=""
branch=""
force=0
for arg in "$@"; do
  case "$arg" in
    --force) force=1 ;;
    -h|--help)
      printf '%s\n' "Usage: scripts/worktree-cleanup.sh <path> [branch] [--force]"
      exit 0
      ;;
    -*) printf 'cleanup: unknown option: %s\n' "$arg" >&2; exit 64 ;;
    *)
      if [ -z "$path" ]; then path=$arg
      elif [ -z "$branch" ]; then branch=$arg
      else printf 'cleanup: unexpected argument: %s\n' "$arg" >&2; exit 64
      fi
      ;;
  esac
done
[ -n "$path" ] || { printf 'cleanup: missing worktree path\n' >&2; exit 64; }
[ -e "$path" ] || { printf 'cleanup: path does not exist: %s\n' "$path" >&2; exit 64; }

path_abs=$(cd "$path" && pwd)
[ ! -d "$path_abs/.git" ] || { printf 'cleanup: refusing to remove primary checkout\n' >&2; exit 12; }
[ -n "$branch" ] || branch=$(git -C "$path_abs" symbolic-ref --quiet --short HEAD 2>/dev/null || true)
tip=""
[ -z "$branch" ] || tip=$(git rev-parse --short "$branch" 2>/dev/null || true)

if [ "$force" = 0 ] && [ -n "$branch" ] && [ "$branch" != main ]; then
  command -v gh >/dev/null 2>&1 || { printf 'cleanup: gh required to verify merged PR; use --force to bypass\n' >&2; exit 11; }
  merged=$(gh pr list --head "$branch" --state merged --json number --jq 'length' 2>/dev/null || printf '')
  case "$merged" in ''|*[!0-9]*) printf 'cleanup: could not verify merged PR; refusing\n' >&2; exit 11 ;; esac
  [ "$merged" != 0 ] || { printf 'cleanup: no merged PR for %s; refusing\n' "$branch" >&2; exit 11; }
fi

git worktree remove "$path_abs"
if [ -n "$branch" ] && [ "$branch" != main ]; then git branch -D "$branch" >/dev/null; fi
git fetch origin --prune --quiet || true
git worktree prune
printf 'cleanup: PASS — removed %s%s\n' "$path" "${tip:+ (recover: git branch $branch $tip)}"
