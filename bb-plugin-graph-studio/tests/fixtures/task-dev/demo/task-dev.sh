#!/usr/bin/env bash
# A stand-in for the monorepo's .bb/workflows/lib/task-dev.sh, for trying a
# compiled task-dev graph on a throwaway repository.
#
# Same subcommands and the same one-line JSON answers, so the graph cannot
# tell the difference. The git work is real (worktrees, squash, cherry-pick,
# autosquash); what is faked is everything that needs the monorepo:
#   gate        runs ./check.sh in the worktree instead of Turbo
#   gate-layer  the same, at a layer branch
#   submit      prints the stack instead of opening PRs
# There is no origin: preflight bases the stack on the local main branch.
set -uo pipefail

die() { jq -cn --arg error "$1" '{ok:false, error:$error}'; exit "${2:-2}"; }
json_lines() { jq -R . | jq -cs 'map(select(length > 0))'; }
conflicted_files() { git -C "$1" diff --name-only --diff-filter=U | json_lines; }

repo_root() { git rev-parse --show-toplevel; }
ticket_dir() { echo "$(repo_root)/.worktrees/$(echo "$1" | tr '[:upper:]' '[:lower:]')"; }

# Slow enough to watch on the canvas; FAKE_DELAY=0 makes it instant.
pause() { sleep "${FAKE_DELAY:-2}"; }

cmd_preflight() {
  local ticket="$1" dir stack branch reused=false
  pause
  dir="$(ticket_dir "$ticket")"
  stack="$dir/_stack"
  branch="task-dev/$(basename "$dir")/stack"
  mkdir -p "$dir/logs"
  if [ -d "$stack" ]; then
    reused=true
  else
    git worktree add --no-track -B "$branch" "$stack" main >/dev/null 2>&1 || die "could not create the stack worktree at $stack" 1
  fi
  jq -cn --arg stack "$stack" --arg branch "$branch" --arg base "$(git rev-parse main)" --argjson reused "$reused" \
    '{ok:true, stack:$stack, stackBranch:$branch, base:$base, reused:$reused, problems:[], warnings:[]}'
}

cmd_worktree() {
  local ticket="$1" key="$2" base="$3" dir path branch reused=false
  pause
  dir="$(ticket_dir "$ticket")"
  path="$dir/$(echo "$key" | tr '[:upper:]' '[:lower:]')"
  branch="task-dev/$(basename "$dir")/$(basename "$path")"
  if [ -d "$path" ]; then
    reused=true
  else
    git worktree add --no-track -B "$branch" "$path" "$base" >/dev/null 2>&1 || die "could not create worktree $path at $base" 1
  fi
  jq -cn --arg path "$path" --arg branch "$branch" --arg base "$base" \
    --arg head "$(git -C "$path" rev-parse HEAD)" --argjson reused "$reused" \
    '{ok:true, path:$path, branch:$branch, base:$base, head:$head, reused:$reused}'
}

cmd_gate() {
  local path="$1" app="$2" level="$3" log code start=$SECONDS
  pause
  log="$(mktemp -t "gate-$(basename "$path")-$level")"
  (cd "$path" && ./check.sh) >"$log" 2>&1
  code=$?
  jq -cn --argjson ok "$([ "$code" -eq 0 ] && echo true || echo false)" --arg app "$app" --arg level "$level" \
    --arg path "$path" --arg log "$log" --argjson exit "$code" --argjson seconds $((SECONDS - start)) \
    --arg tail "$([ "$code" -ne 0 ] && tail -n 40 "$log")" \
    '{ok:$ok, app:$app, level:$level, path:$path, steps:[{cmd:"./check.sh", exit:$exit, seconds:$seconds, log:$log, tail:$tail}]}'
  [ "$code" -eq 0 ]
}

cmd_squash() {
  local path="$1" base="$2" message="$3" count
  [ -z "$(git -C "$path" status --porcelain)" ] || die "uncommitted changes in $path: commit or discard them first"
  count="$(git -C "$path" rev-list --count "$base..HEAD")"
  [ "$count" -gt 0 ] || die "no commits since $base in $path" 1
  if [ "$count" -gt 1 ] || [ "$(git -C "$path" log -1 --format=%B)" != "$message" ]; then
    git -C "$path" reset --soft "$base" && git -C "$path" commit -q -m "$message" || die "squash failed in $path" 1
  fi
  jq -cn --arg sha "$(git -C "$path" rev-parse HEAD)" --argjson squashed "$count" '{ok:true, sha:$sha, squashed:$squashed}'
}

cmd_pick() {
  local stack="$1"; shift
  local picked="[]" item sha layer
  pause
  for item in "$@"; do
    sha="${item%%:*}"
    layer=""; [[ "$item" == *:* ]] && layer="${item#*:}"
    git -C "$stack" cat-file -e "$sha^{commit}" 2>/dev/null || die "unknown commit: $sha"
    if git -C "$stack" merge-base --is-ancestor "$sha" HEAD 2>/dev/null; then
      :
    elif ! git -C "$stack" cherry-pick "$sha" >/dev/null 2>&1; then
      jq -cn --arg sha "$sha" --arg layer "$layer" --argjson picked "$picked" \
        --argjson files "$(conflicted_files "$stack")" \
        '{ok:false, conflict:{sha:$sha, layer:$layer, files:$files}, picked:$picked}'
      exit 3
    fi
    [ -n "$layer" ] && git -C "$stack" branch -f "$layer" HEAD >/dev/null
    picked="$(jq -c --arg sha "$sha" --arg layer "$layer" '. + [{sha:$sha, layer:$layer}]' <<<"$picked")"
  done
  jq -cn --arg head "$(git -C "$stack" rev-parse HEAD)" --argjson picked "$picked" '{ok:true, head:$head, picked:$picked}'
}

cmd_autosquash() {
  local stack="$1" base="$2"
  GIT_SEQUENCE_EDITOR=: git -C "$stack" rebase -q -i --autosquash --update-refs "$base" >/dev/null 2>&1 || {
    jq -cn --argjson files "$(conflicted_files "$stack")" \
      '{ok:false, error:"autosquash rebase stopped on a conflict; resolve, then git rebase --continue", files:$files}'
    exit 3
  }
  jq -cn --arg head "$(git -C "$stack" rev-parse HEAD)" '{ok:true, head:$head}'
}

cmd_gate_layer() {
  local stack="$1" app="$2" layer="$3" back code
  back="$(git -C "$stack" symbolic-ref --short HEAD)" || die "stack worktree is not on a branch"
  git -C "$stack" checkout -q --detach "$layer" || die "cannot check out $layer"
  cmd_gate "$stack" "$app" layer
  code=$?
  git -C "$stack" checkout -q "$back"
  exit "$code"
}

cmd_submit() {
  local stack="$1"; shift
  pause
  jq -cn --arg log "$(git -C "$stack" log --oneline main..HEAD)" --argjson layers "$(printf '%s\n' "$@" | json_lines)" \
    '{ok:true, stack:{fake:true, layers:$layers, log:$log}}'
}

sub="${1:-}"; shift || true
case "$sub" in
  preflight) cmd_preflight "$@" ;;
  worktree) cmd_worktree "$@" ;;
  gate) cmd_gate "$@" ;;
  squash) cmd_squash "$@" ;;
  pick) cmd_pick "$@" ;;
  autosquash) cmd_autosquash "$@" ;;
  gate-layer) cmd_gate_layer "$@" ;;
  submit) cmd_submit "$@" ;;
  *) die "unknown subcommand '$sub'" ;;
esac
