#!/usr/bin/env bash
# agent-style-check.sh — deterministic checker for the mechanical AGENTS.md
# TypeScript rules (docs/agents/typescript.md). Zero-model-cost: review agents
# run this instead of eyeballing style, and spend their reasoning budget on bugs.
#
# Usage:
#   scripts/agent-style-check.sh                 # changed .ts files vs HEAD
#   scripts/agent-style-check.sh --diff <ref>    # changed .ts files vs <ref>
#   scripts/agent-style-check.sh file1.ts ...    # explicit files
#
# Output: one line per finding — <file>:<line>  <LEVEL>  <RULE>  <message>
#   ERROR — unambiguous rule violation (exit 1 if any).
#   WARN  — heuristic hit; a human/agent should confirm before reporting.
#
# Rules covered (everything greppable in docs/agents/typescript.md):
#   ARROW-FN          standalone arrow-function declaration
#   MULTILINE-IMPORT  import declaration split across lines
#   MIDFILE-IMPORT    import below the first non-import statement
#   REL-IMPORT-EXT    relative import missing the .js extension (NodeNext)
#   PKG-IMPORT-EXT    package specifier wrongly carrying .js
#   CONSOLE           raw console.* in shipped code (use @opencrane/observability)
#   TYPES-IN-IMPL     exported interface/type outside a *.types.ts file
#   JSDOC             exported declaration with no JSDoc directly above (heuristic)
#   BRACE             opening { not on its own line for a multi-line fn/class (heuristic)

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# 1. Resolve the file list — diff vs HEAD by default, so the check always
#    scopes to what the current change actually touched.
FILES=()
if [[ $# -eq 0 ]]; then
	while IFS= read -r f; do FILES+=("$f"); done < <(git diff --name-only --diff-filter=ACMR HEAD -- '*.ts' 2>/dev/null || true)
elif [[ "${1:-}" == "--diff" ]]; then
	while IFS= read -r f; do FILES+=("$f"); done < <(git diff --name-only --diff-filter=ACMR "${2:?--diff needs a ref}" -- '*.ts')
else
	FILES=("$@")
fi

# 2. Exclusions — tests, declarations, generated output, vendored code. Test
#    files follow looser rules; generated files are not hand-maintained.
CHECKABLE=()
for f in "${FILES[@]:-}"; do
	[[ -z "$f" || ! -f "$f" ]] && continue
	case "$f" in
		*.d.ts|*.spec.ts|*.test.ts|*__tests__*|*node_modules*|*dist/*|*generated*) continue ;;
	esac
	CHECKABLE+=("$f")
done

if [[ ${#CHECKABLE[@]} -eq 0 ]]; then
	echo "agent-style-check: no checkable TypeScript files in scope."
	exit 0
fi

ERRORS=0
WARNS=0

# _report <file> <line> <level> <rule> <message>
_report()
{
	printf '%s:%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" "$5"
	if [[ "$3" == "ERROR" ]]; then ERRORS=$((ERRORS + 1)); else WARNS=$((WARNS + 1)); fi
}

for f in "${CHECKABLE[@]}"; do

	# ARROW-FN — a statement-level `const x = (...) =>` is a declaration via
	# arrow, which the rules forbid (arrows belong inside HOF callbacks only).
	while IFS=: read -r ln _; do
		_report "$f" "$ln" ERROR ARROW-FN "standalone arrow-function declaration — use a named function declaration"
	done < <(grep -nE '^[[:space:]]*(export[[:space:]]+)?const[[:space:]]+[A-Za-z_$][A-Za-z0-9_$]*[[:space:]]*(:[^=]*)?=[[:space:]]*(async[[:space:]]+)?(\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)[[:space:]]*(:[^=]*)?=>' "$f" || true)

	# MULTILINE-IMPORT — an import line that opens `{` without closing it.
	while IFS=: read -r ln _; do
		_report "$f" "$ln" ERROR MULTILINE-IMPORT "import split across lines — merge onto one line"
	done < <(grep -nE '^import[[:space:]]+(type[[:space:]]+)?\{[^}]*$' "$f" || true)

	# MIDFILE-IMPORT / JSDOC / BRACE — need statefulness, so one awk pass.
	while IFS=$'\t' read -r ln rule msg; do
		level=ERROR
		[[ "$rule" == "JSDOC" || "$rule" == "BRACE" ]] && level=WARN
		_report "$f" "$ln" "$level" "$rule" "$msg"
	done < <(awk '
		BEGIN { seen_code = 0; prev = "" }
		{
			line = $0
			trimmed = line
			sub(/^[[:space:]]+/, "", trimmed)

			is_import = (trimmed ~ /^import[[:space:]]/)
			is_blank_or_comment = (trimmed == "" || trimmed ~ /^\/\// || trimmed ~ /^\/\*/ || trimmed ~ /^\*/ || trimmed ~ /^"use / || trimmed ~ /^#!/)

			# MIDFILE-IMPORT: an import after real code has started.
			if (is_import && seen_code)
				printf "%d\tMIDFILE-IMPORT\timport below the first non-import statement — move to top\n", NR
			if (!is_import && !is_blank_or_comment)
				seen_code = 1

			# JSDOC: exported declaration must be directly preceded by a JSDoc close.
			# A decorator between the JSDoc and the declaration is fine (prev is then
			# the decorator itself or its closing "})").
			# (identifier required after the keyword so barrel re-exports like
			# "export type { paths }" do not match)
			if (trimmed ~ /^export[[:space:]]+(default[[:space:]]+)?(async[[:space:]]+)?(function|class|interface|type|const|enum)[[:space:]]+[A-Za-z_$]/ && prev !~ /\*\/[[:space:]]*$/ && prev !~ /^@/ && prev !~ /^\}\)/)
				printf "%d\tJSDOC\texported declaration has no JSDoc directly above it\n", NR

			# BRACE: multi-line function/class with { on the declaration line
			# (single-line bodies are exempt — they close } on the same line).
			if ((trimmed ~ /^(export[[:space:]]+)?(default[[:space:]]+)?(async[[:space:]]+)?function[[:space:]]+[A-Za-z_$]/ || trimmed ~ /^(export[[:space:]]+)?(abstract[[:space:]]+)?class[[:space:]]+[A-Za-z_$]/) && trimmed ~ /\{[[:space:]]*$/ && trimmed !~ /\}/)
				printf "%d\tBRACE\topening { should be on its own line (Allman) for multi-line declarations\n", NR

			if (!is_blank_or_comment || trimmed ~ /\*\/[[:space:]]*$/)
				prev = trimmed
		}
	' "$f")

	# REL-IMPORT-EXT — NodeNext services require .js. Angular's bundler resolves
	# extensionless workspace imports, which is the established frontend convention.
	case "$f" in
		apps/opencrane-ui/*|libs/frontend/*) : ;;
		*)
			while IFS=: read -r ln _; do
				_report "$f" "$ln" ERROR REL-IMPORT-EXT "relative import must end in .js (NodeNext)"
			done < <(grep -nE 'from[[:space:]]+"(\.\.?/[^"]*)"' "$f" | grep -vE '\.(js|json)"' || true)
			;;
	esac

	# PKG-IMPORT-EXT — @opencrane barrel specifiers must NOT carry .js. (Deep
	# subpath imports of third-party packages, e.g. the MCP SDK, genuinely end
	# in .js — only our own barrels are covered by the rule.)
	while IFS=: read -r ln _; do
		_report "$f" "$ln" ERROR PKG-IMPORT-EXT "@opencrane package specifier must not end in .js"
	done < <(grep -nE 'from[[:space:]]+"@opencrane/[^"]+\.js"' "$f" || true)

	# CONSOLE — shipped code logs via @opencrane/observability.
	case "$f" in
		*)
			while IFS=: read -r ln _; do
				_report "$f" "$ln" ERROR CONSOLE "raw console.* — use the structured logger (@opencrane/observability)"
			done < <(grep -nE '(^|[^.[:alnum:]_])console\.(log|warn|error|info|debug)\(' "$f" || true)
			;;
	esac

	# TYPES-IN-IMPL — exported interfaces/type aliases belong in *.types.ts.
	# (A bare `types.ts` is a types file by intent — exempt.)
	case "$f" in
		*.types.ts|*/types.ts|types.ts) : ;;
		*)
			while IFS=: read -r ln _; do
				_report "$f" "$ln" ERROR TYPES-IN-IMPL "exported interface/type outside *.types.ts — move to the paired types file"
			done < <(grep -nE '^[[:space:]]*export[[:space:]]+(interface|type)[[:space:]]+[A-Za-z_$]' "$f" || true)
			;;
	esac

done

# 3. Summary + exit code: ERROR findings fail the check; WARN findings are
#    heuristics for the reviewing agent to confirm at the cited line.
echo "agent-style-check: ${#CHECKABLE[@]} file(s) checked — ${ERRORS} error(s), ${WARNS} warning(s)."
[[ $ERRORS -gt 0 ]] && exit 1
exit 0
