#!/usr/bin/env bash
#
# Codex entrypoint for the shared review pre-filter.
#
# The deterministic implementation lives under .claude/hooks because Claude Code
# invokes that path directly. This wrapper gives Codex the same classification,
# then translates its JUDGE/SKIP result into the documented Codex Stop-hook JSON
# contract. Codex has no separate judge model, so JUDGE continues the turn asking
# the model to judge its own change against the policy prose that Claude Code
# hands to its Haiku judge; stop_hook_active makes the shared pre-filter return
# SKIP on the second stop.

set -uo pipefail

repo="${CODEX_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}}"
context="$repo/.claude/.review-context.md"
input="$(cat)"

prefilter_status=1
if : > "$context" 2>/dev/null; then
	printf '%s' "$input" \
		| CLAUDE_PROJECT_DIR="$repo" bash "$repo/.claude/hooks/require-review.sh"
	prefilter_status=$?
fi

verdict="$(sed -n 's/^VERDICT=//p' "$context" 2>/dev/null | head -1)"
case "$prefilter_status:$verdict" in
	"0:SKIP")
		printf '%s\n' '{"continue":true}'
		;;
	"0:JUDGE")
		# Hand the change to the model as the judge. Blocking outright here would make Codex
		# stricter than the policy, whose pre-MVP default leans toward allowing.
		printf '%s\n' '{"decision":"block","reason":"You are the review-gate judge for this change. Read .claude/.review-context.md, then apply the Judgment guidance in .claude/review-policy.md to its DIFF, UNTRACKED_SOURCE_BODIES, and MODULE_GROWTH sections. If that guidance allows the change, say so in one line and stop. If it does not, invoke the review agent for all required dimensions, fix every verified finding, rerun validation, then run the comments documentation gate last (it needs the diff range including removals plus the plan slice), and then stop again."}'
		;;
	*)
		# A crash, missing context, or unknown verdict blocks closed: only a fresh, explicit
		# SKIP or JUDGE is authoritative enough to decide the turn.
		printf '%s\n' '{"decision":"block","reason":"The deterministic review pre-filter produced no usable verdict. Diagnose .claude/hooks/require-review.sh and .claude/.review-context.md, then run the repository independent review gate for this change — read the context, invoke the review agent for all required dimensions, fix every verified finding, rerun validation, and run the comments documentation gate last — before stopping again."}'
		;;
esac
