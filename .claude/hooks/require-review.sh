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
    echo "---"
    echo "PR_STACK_INTEGRITY:"
    printf '%s\n' "${stack_output:-}"
  } > "$context" 2>/dev/null || true
  exit 0
}

# 3. Loop guard: if we are here because a prior block already fired this stop sequence,
#    record the current state as reviewed and let the stop proceed. Prevents loops.
stop_active="$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null || echo false)"

# 4. Bind the review fingerprint to the live PR topology. A branch without an open PR is a valid
#    pre-publication state; a failed live inspection of an open branch routes to judgment.
current_branch="$(git branch --show-current 2>/dev/null || true)"
stack_output=""
stack_status=0
stack_base_oid=""
if [ -f "$repo/scripts/pr-stack-integrity.mjs" ] && [ -n "$current_branch" ]; then
  stack_output="$(node scripts/pr-stack-integrity.mjs --current-branch "$current_branch" --format json 2>&1)"
  stack_status=$?
  stack_base_oid="$(printf '%s' "$stack_output" | jq -r '.evidence.current.base.sha // empty' 2>/dev/null || true)"
fi

# 5. Build committed, staged, unstaged, and untracked source overlays separately. `git diff HEAD`
#    alone can hide staged/unstaged cancellation and can never show already-committed slice work.
source_paths=()
while IFS= read -r pattern; do
  [ -n "$pattern" ] && source_paths+=("$pattern")
done < <(node -e 'const p=require("./docs/agents/module-growth-policy.json"); for (const e of p.sourceExtensions) console.log(`:(icase)*${e}`)' 2>/dev/null)
if [ ${#source_paths[@]} -eq 0 ]; then
  # Fail open to the broad Git diff but closed to the model judge: a broken policy must never make
  # production changes disappear from review.
  source_paths=('*')
fi
committed_diff=""
committed_files=""
if [ -n "$stack_base_oid" ]; then
  committed_diff="$(git diff --binary "$stack_base_oid"...HEAD -- "${source_paths[@]}" 2>/dev/null || true)"
  committed_files="$(git diff --name-only "$stack_base_oid"...HEAD -- "${source_paths[@]}" 2>/dev/null || true)"
fi
staged_diff="$(git diff --cached --binary HEAD -- "${source_paths[@]}" 2>/dev/null || true)"
unstaged_diff="$(git diff --binary -- "${source_paths[@]}" 2>/dev/null || true)"
code_diff="$(printf '%s\n%s\n%s\n%s\n%s\n%s' \
  'COMMITTED_BASE_RANGE:' "$committed_diff" \
  'STAGED_OVERLAY:' "$staged_diff" \
  'UNSTAGED_OVERLAY:' "$unstaged_diff")"
changed_files="$(printf '%s\n%s\n%s' \
  "$committed_files" \
  "$(git diff --cached --name-only HEAD -- "${source_paths[@]}" 2>/dev/null || true)" \
  "$(git diff --name-only -- "${source_paths[@]}" 2>/dev/null || true)" \
  | sed '/^$/d' | sort -u)"
untracked_body=""
untracked_manifest=""
untracked_lines=0
while IFS= read -r -d '' file; do
  blob_hash="$(git hash-object -- "$file" 2>/dev/null || true)"
  untracked_manifest="$(printf '%s%s\t%s\n' "$untracked_manifest" "$blob_hash" "$file")"
  untracked_body="$(printf '%s\n--- %s [%s] ---\n' "$untracked_body" "$file" "$blob_hash")$(cat -- "$file" 2>/dev/null || true)"
  file_lines="$(wc -l < "$file" 2>/dev/null | tr -d ' ' || echo 0)"
  untracked_lines=$(( untracked_lines + ${file_lines:-0} ))
done < <(git ls-files --others --exclude-standard -z -- "${source_paths[@]}" 2>/dev/null)
if [ -n "$untracked_manifest" ]; then
  changed_files="$(printf '%s\n%s' "$changed_files" "$untracked_manifest" | sed '/^$/d')"
fi

# 6. Measure size and hash the exact SHA-bound review state.
committed_lines=0
if [ -n "$stack_base_oid" ]; then
  committed_lines="$(git diff --numstat "$stack_base_oid"...HEAD -- "${source_paths[@]}" 2>/dev/null | awk '{a+=$1; r+=$2} END {print a+r+0}')"
fi
staged_lines="$(git diff --cached --numstat HEAD -- "${source_paths[@]}" 2>/dev/null | awk '{a+=$1; r+=$2} END {print a+r+0}')"
unstaged_lines="$(git diff --numstat -- "${source_paths[@]}" 2>/dev/null | awk '{a+=$1; r+=$2} END {print a+r+0}')"
total_lines=$(( ${committed_lines:-0} + ${staged_lines:-0} + ${unstaged_lines:-0} + ${untracked_lines:-0} ))
growth_output="$(node scripts/module-growth-check.mjs 2>&1)"
growth_status=$?
head_oid="$(git rev-parse HEAD 2>/dev/null || true)"
current_hash="$(printf '%s\n%s\n%s\n%s\n%s\n%s\n%s' \
  "$head_oid" "$stack_base_oid" "$changed_files" "$code_diff" "$untracked_manifest" \
  "$growth_output" "$stack_output" | shasum -a 256 | awk '{print $1}')"

# 7. Loop guard resolved here (needs current_hash). It never suppresses a deterministic stack
#    failure: ancestry drift remains blocking until the graph is repaired.
if [ "$stop_active" = "true" ]; then
  if [ "$stack_status" -ne 0 ]; then
    _write_context_and_exit "JUDGE"
  fi
  printf '%s\n' "$current_hash" > "$marker" 2>/dev/null || true
  _write_context_and_exit "SKIP"
fi

# 8. No supported source changes and a valid live stack -> nothing to judge.
if [ -z "$committed_diff" ] && [ -z "$staged_diff" ] && [ -z "$unstaged_diff" ] \
  && [ -z "$untracked_manifest" ] && [ "$stack_status" -eq 0 ]; then
  _write_context_and_exit "SKIP"
fi

# 9. Already reviewed this exact SHA-bound change set (marker matches) -> skip.
if [ -f "$marker" ] && [ "$(cat "$marker" 2>/dev/null)" = "$current_hash" ]; then
  _write_context_and_exit "SKIP"
fi

# 10. Load policy config. Extract the machine-config block, then the individual keys.
cfg=""
if [ -f "$policy" ]; then
  cfg="$(awk '/GATE-CONFIG-START/{f=1;next} /GATE-CONFIG-END/{f=0} f' "$policy" 2>/dev/null || true)"
fi
threshold="$(printf '%s\n' "$cfg" | sed -n 's/^threshold=//p' | head -1)"
threshold="${threshold:-10}"
always="$(printf '%s\n' "$cfg" | sed -n 's/^always-review=//p' | head -1)"
never="$(printf '%s\n' "$cfg" | sed -n 's/^never-review-paths=//p' | head -1)"

# 11. Critical-keyword check: does any always-review keyword appear in the paths or diff?
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
if [ "$stack_status" -ne 0 ]; then
  critical="yes"
fi

# 12. All-excluded check: does EVERY changed file match a never-review path substring?
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

# 13. Cheap SKIP: not critical, and either fully excluded or under the line threshold.
if [ "$critical" = "no" ] && { [ "$all_excluded" = "yes" ] || [ "$total_lines" -le "$threshold" ]; }; then
  _write_context_and_exit "SKIP"
fi

# 14. Otherwise the Haiku judge must decide — hand it the full context.
_write_context_and_exit "JUDGE"
