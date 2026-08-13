#!/usr/bin/env bash
#
# Codex entrypoint for the shared review pre-filter.
#
# The deterministic implementation lives under .claude/hooks because Claude Code
# invokes that path directly. This wrapper gives Codex the same classification,
# then translates its JUDGE/SKIP result into the documented Codex Stop-hook JSON
# contract. JUDGE continues the turn with an independent-review instruction;
# stop_hook_active makes the shared pre-filter return SKIP on the second stop.

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
	*)
		# JUDGE is the expected blocking result. A crash, missing context, or unknown verdict also
		# blocks: only a fresh, explicit SKIP is authoritative enough to let the turn end.
		printf '%s\n' '{"decision":"block","reason":"Run the repository independent review gate now: read .claude/.review-context.md, invoke the review agent for all required dimensions, fix every verified finding, rerun validation, then run the comments documentation gate last (it needs the diff range including removals plus the plan slice), and then stop again. If the context is missing, diagnose the deterministic pre-filter before proceeding."}'
		;;
esac
