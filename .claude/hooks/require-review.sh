#!/usr/bin/env bash
#
# Stop-hook PRE-FILTER for the policy-driven review gate.
#
# This runs IN PARALLEL with the Haiku agent hook (Claude Code runs all hooks in a
# matcher array concurrently). It does the cheap, deterministic work so the Haiku
# judge barely runs on the obvious cases:
#
#   - Computes the supported production-source change set (tracked diff vs HEAD + untracked bodies).
#   - Runs the deterministic module-growth classifier and routes every candidate to judgment.
#   - Writes .claude/.review-context.md (VERDICT + diff + policy) for the Haiku hook to read.
#   - Resolves SKIP cases (no code / trivial / already-reviewed / loop-guard) so the
#     agent can short-circuit to ok:true after a single read.
#
# It never calls a model and (intentionally) never blocks: the Haiku agent hook is the
# sole blocker. If you want a free deterministic floor instead, see the git history of
# this file for the exit-2 variant.
#
# Policy lives in .claude/review-policy.md (the single tunable surface).
# State files (.claude/.review-context.md, .claude/.last-review-hash) are git-ignored.

set -uo pipefail

# 1. Read the hook input JSON so we can honour the loop-prevention flag.
input="$(cat)"

# 2. Resolve repo root from the harness-provided dir, falling back to git.
repo="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$repo" 2>/dev/null || exit 0

policy="$repo/.claude/review-policy.md"
marker="$repo/.claude/.last-review-hash"
context="$repo/.claude/.review-context.md"

# Helper: write the context file the agent hook reads, then exit 0.
# $1 = verdict (SKIP|JUDGE); remaining args ignored — body assembled from globals.
_write_context_and_exit() {
  local verdict="$1"
  {
    echo "VERDICT=$verdict"
    echo "CHANGED_LINES=${total_lines:-0}"
    echo "---"
    echo "CHANGED_FILES:"
    printf '%s\n' "${changed_files:-}"
    echo "---"
    echo "DIFF:"
    printf '%s\n' "${code_diff:-}"
    if [ -n "${untracked_body:-}" ]; then
      echo "---"
      echo "UNTRACKED_SOURCE_BODIES:"
      printf '%s\n' "$untracked_body"
    fi
    echo "---"
    echo "MODULE_GROWTH:"
    printf '%s\n' "${growth_output:-}"
  } > "$context" 2>/dev/null || true
  exit 0
}

# 3. Loop guard: if we are here because a prior block already fired this stop sequence,
#    record the current state as reviewed and let the stop proceed. Prevents loops.
stop_active="$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null || echo false)"

# 4. Build the language-neutral source change set from the same committed extension policy used by
#    scripts/module-growth-check.mjs. Tests/generated paths are filtered by review policy below.
source_paths=()
while IFS= read -r pattern; do
  [ -n "$pattern" ] && source_paths+=("$pattern")
done < <(node -e 'const p=require("./docs/agents/module-growth-policy.json"); for (const e of p.sourceExtensions) console.log(`:(icase)*${e}`)' 2>/dev/null)
if [ ${#source_paths[@]} -eq 0 ]; then
  # Fail open to the broad Git diff but closed to the model judge: a broken policy must never make
  # production changes disappear from review.
  source_paths=('*')
fi
code_diff="$(git diff HEAD -- "${source_paths[@]}" 2>/dev/null || true)"
changed_files="$(git diff HEAD --name-only -- "${source_paths[@]}" 2>/dev/null || true)"
untracked_files="$(git ls-files --others --exclude-standard -- "${source_paths[@]}" 2>/dev/null || true)"
untracked_body=""
if [ -n "$untracked_files" ]; then
  changed_files="$(printf '%s\n%s' "$changed_files" "$untracked_files" | sed '/^$/d')"
  # shellcheck disable=SC2086
  untracked_body="$(printf '%s\n' "$untracked_files" | xargs cat 2>/dev/null || true)"
fi

# 5. Measure size and hash the change set (used for the trivial check and the marker).
tracked_lines="$(git diff HEAD --numstat -- "${source_paths[@]}" 2>/dev/null | awk '{a+=$1; r+=$2} END {print a+r+0}')"
untracked_lines="0"
if [ -n "$untracked_body" ]; then
  untracked_lines="$(printf '%s\n' "$untracked_body" | wc -l | tr -d ' ')"
fi
total_lines=$(( ${tracked_lines:-0} + ${untracked_lines:-0} ))
growth_output="$(node scripts/module-growth-check.mjs 2>&1)"
growth_status=$?
current_hash="$(printf '%s\n%s\n%s\n%s' "$changed_files" "$code_diff" "$untracked_body" "$growth_output" | shasum -a 256 | awk '{print $1}')"

# 6. Loop guard resolved here (needs current_hash): record reviewed state, allow stop.
if [ "$stop_active" = "true" ]; then
  printf '%s\n' "$current_hash" > "$marker" 2>/dev/null || true
  _write_context_and_exit "SKIP"
fi

# 7. No supported source changes at all -> nothing to judge.
if [ -z "$code_diff" ] && [ -z "$untracked_files" ]; then
  _write_context_and_exit "SKIP"
fi

# 8. Already reviewed this exact change set (marker matches) -> skip.
if [ -f "$marker" ] && [ "$(cat "$marker" 2>/dev/null)" = "$current_hash" ]; then
  _write_context_and_exit "SKIP"
fi

# 9. Load policy config. Extract the machine-config block, then the individual keys.
cfg=""
if [ -f "$policy" ]; then
  cfg="$(awk '/GATE-CONFIG-START/{f=1;next} /GATE-CONFIG-END/{f=0} f' "$policy" 2>/dev/null || true)"
fi
threshold="$(printf '%s\n' "$cfg" | sed -n 's/^threshold=//p' | head -1)"
threshold="${threshold:-10}"
always="$(printf '%s\n' "$cfg" | sed -n 's/^always-review=//p' | head -1)"
never="$(printf '%s\n' "$cfg" | sed -n 's/^never-review-paths=//p' | head -1)"

# 10. Critical-keyword check: does any always-review keyword appear in the paths or diff?
critical="no"
haystack="$(printf '%s\n%s\n%s' "$changed_files" "$code_diff" "$untracked_body" | tr '[:upper:]' '[:lower:]')"
for kw in $always; do
  if printf '%s' "$haystack" | grep -qF "$(printf '%s' "$kw" | tr '[:upper:]' '[:lower:]')"; then
    critical="yes"
    break
  fi
done
if [ "$growth_status" -ne 0 ] \
  || printf '%s\n' "$growth_output" | grep -qE '[[:space:]](ERROR|WARN)[[:space:]]+MODULE-GROWTH-'; then
  critical="yes"
fi

# 11. All-excluded check: does EVERY changed file match a never-review path substring?
all_excluded="yes"
while IFS= read -r f; do
  [ -z "$f" ] && continue
  matched="no"
  for pat in $never; do
    case "$f" in *"$pat"*) matched="yes"; break;; esac
  done
  if [ "$matched" = "no" ]; then
    all_excluded="no"
    break
  fi
done <<EOF
$changed_files
EOF

# 12. Cheap SKIP: not critical, and either fully excluded or under the line threshold.
if [ "$critical" = "no" ] && { [ "$all_excluded" = "yes" ] || [ "$total_lines" -le "$threshold" ]; }; then
  _write_context_and_exit "SKIP"
fi

# 13. Otherwise the Haiku judge must decide — hand it the full context.
_write_context_and_exit "JUDGE"
