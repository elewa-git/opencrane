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
#   REL-IMPORT-EXT    relative import carrying a .js extension (bundler resolution)
#   PKG-IMPORT-EXT    package specifier wrongly carrying .js
#   CONSOLE           raw console.* in shipped code (use @opencrane/backend/observability)
#   INLINE-CONDITIONAL more than one ternary conditional on one physical source line
#   CATEGORICAL-LITERAL direct string comparison on a categorical property (heuristic)
#   TYPES-IN-IMPL     exported interface/type outside a *.types.ts file
#   JSDOC             exported declaration with no JSDoc directly above (heuristic)
#   BRACE             opening { not on its own line for a multi-line fn/class (heuristic)
#   TEST-LOCATION     *.test.ts file not placed under a __tests__ directory
#   MISSING-README    new/changed package (project.json) with no sibling README.md
#   README-SECTIONS   leaf package README missing a mandatory package-docs section
#
# The Prisma repository/unit-of-work boundary is also enforced for the same scope by
# scripts/prisma-boundary-check.mjs. It is architectural rather than stylistic, but shares this
# deterministic pre-review entrypoint so service-layer ORM bypasses cannot escape review.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# 1. Resolve the file list — diff vs HEAD by default, so the check always
#    scopes to what the current change actually touched.
FILES=()
if [[ $# -eq 0 ]]; then
	while IFS= read -r -d '' f; do FILES+=("$f"); done < <(git diff --name-only --diff-filter=ACMR -z HEAD -- '*.ts' 2>/dev/null || true)
	while IFS= read -r -d '' f; do FILES+=("$f"); done < <(git ls-files --others --exclude-standard -z -- '*.ts' 2>/dev/null || true)
elif [[ "${1:-}" == "--diff" ]]; then
	while IFS= read -r -d '' f; do FILES+=("$f"); done < <(git diff --name-only --diff-filter=ACMR -z "${2:?--diff needs a ref}" -- '*.ts')
	while IFS= read -r -d '' f; do FILES+=("$f"); done < <(git ls-files --others --exclude-standard -z -- '*.ts' 2>/dev/null || true)
else
	FILES=("$@")
fi

# 2. Exclusions — tests, declarations, generated output, vendored code. Test
#    files follow looser rules; generated files are not hand-maintained.
#    A .upstream/ directory holds a pinned copy of someone else's source (see the
#    sibling VERSION file); it is replaced wholesale on the next sync, so our
#    hand-written style rules must not apply to it.
CHECKABLE=()
INLINE_CHECKABLE=()
for f in ${FILES[@]+"${FILES[@]}"}; do
	[[ -z "$f" || ! -f "$f" ]] && continue
	case "$f" in
		*.d.ts|*node_modules*|*dist/*|*generated*|*/.upstream/*) continue ;;
	esac
	INLINE_CHECKABLE+=("$f")
	case "$f" in
		*.spec.ts|*.test.ts|*__tests__*) continue ;;
	esac
	CHECKABLE+=("$f")
done

ERRORS=0
WARNS=0

# _report <file> <line> <level> <rule> <message>
_report()
{
	printf '%s:%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" "$5"
	if [[ "$3" == "ERROR" ]]; then ERRORS=$((ERRORS + 1)); else WARNS=$((WARNS + 1)); fi
}

# TEST-LOCATION — every *.test.ts must live under a __tests__ directory,
# never co-located next to the source file it tests. Runs against the raw
# FILES list since test files are otherwise excluded from CHECKABLE below.
for f in ${FILES[@]+"${FILES[@]}"}; do
	[[ -z "$f" || ! -f "$f" ]] && continue
	case "$f" in
		*/.upstream/*) continue ;;
	esac
	case "$f" in
		*.test.ts)
			case "$f" in
				*/__tests__/*) : ;;
				*) _report "$f" 1 ERROR TEST-LOCATION "test file not under __tests__/ — move it there and fix relative imports" ;;
			esac
			;;
	esac
done

# INLINE-CONDITIONAL — unlike the looser declaration/style rules below, conditional density applies
# to production and test TypeScript alike. One physical line may contain at most one ternary.
# The whole list goes to one node call — starting a process per file dominated the runtime.
if [[ ${#INLINE_CHECKABLE[@]} -gt 0 ]]; then
	while IFS=: read -r fname ln _; do
		_report "$fname" "$ln" ERROR INLINE-CONDITIONAL "more than one ternary conditional on one line — use an exhaustive lookup, switch, or helper"
	done < <(node scripts/inline-conditional-check.mjs "${INLINE_CHECKABLE[@]}")
fi

# MISSING-README / README-SECTIONS — package docs (docs/agents/package-docs.md).
# A changed package must ship a README, and a changed leaf-package README must
# carry the mandatory sections. Diff-scoped like the .ts checks; skipped when
# explicit files were passed.
DOC_FILES=()
if [[ $# -eq 0 ]]; then
	while IFS= read -r -d '' f; do DOC_FILES+=("$f"); done < <(git diff --name-only --diff-filter=ACMR -z HEAD -- 'libs/**/README.md' 'apps/**/README.md' 'libs/**/project.json' 'apps/**/project.json' 2>/dev/null || true)
	while IFS= read -r -d '' f; do DOC_FILES+=("$f"); done < <(git ls-files --others --exclude-standard -z -- 'libs/**/README.md' 'apps/**/README.md' 'libs/**/project.json' 'apps/**/project.json' 2>/dev/null || true)
elif [[ "${1:-}" == "--diff" ]]; then
	while IFS= read -r -d '' f; do DOC_FILES+=("$f"); done < <(git diff --name-only --diff-filter=ACMR -z "$2" -- 'libs/**/README.md' 'apps/**/README.md' 'libs/**/project.json' 'apps/**/project.json' 2>/dev/null || true)
	while IFS= read -r -d '' f; do DOC_FILES+=("$f"); done < <(git ls-files --others --exclude-standard -z -- 'libs/**/README.md' 'apps/**/README.md' 'libs/**/project.json' 'apps/**/project.json' 2>/dev/null || true)
fi
for f in ${DOC_FILES[@]+"${DOC_FILES[@]}"}; do
	[[ -z "$f" || ! -f "$f" ]] && continue
	dir="$(dirname "$f")"
	case "$f" in
		*/project.json)
			if [[ ! -f "$dir/README.md" ]]; then
				_report "$f" 1 ERROR MISSING-README "package has no README.md — create it from docs/agents/README-TEMPLATE.md"
			fi
			;;
		*/README.md)
			# Only leaf packages (the directory owning project.json) follow the
			# fixed section order; group/area index READMEs have their own shape.
			[[ -f "$dir/project.json" ]] || continue
			if ! head -5 "$f" | grep -q '^> '; then
				_report "$f" 1 ERROR README-SECTIONS "missing breadcrumb line ('> area > group > package') — see docs/agents/package-docs.md"
			fi
			for section in "## What it owns" "## Public surface" "## See also"; do
				if ! grep -q "^${section}" "$f"; then
					_report "$f" 1 ERROR README-SECTIONS "missing mandatory section '${section}' — see docs/agents/package-docs.md"
				fi
			done
			;;
	esac
done

# PRISMA-BOUNDARY — changed production TypeScript may call Prisma delegates only from a class that
# implements an imported Repository contract, and may open transactions only from an imported
# UnitOfWork owner. The checker owns exact exemption validation and fails closed on malformed policy.
node scripts/prisma-boundary-check.mjs "$@"

if [[ ${#CHECKABLE[@]} -eq 0 ]]; then
	echo "agent-style-check: no checkable TypeScript files in scope."
	[[ $ERRORS -gt 0 ]] && exit 1
	exit 0
fi

# Each rule below makes ONE pass over the whole file list instead of one pass per
# file. grep and awk both accept many paths, and starting a few thousand
# short-lived processes cost far more than the scanning itself. -H keeps the
# "<file>:" prefix even when a single file is in scope, so parsing stays uniform.

# Two rules run on a subset, so split the list once up front.
TYPES_CHECKABLE=()
VITEST_CONFIGS=()
for f in "${CHECKABLE[@]}"; do
	# TYPES-IN-IMPL: a bare `types.ts` is a types file by intent — exempt.
	case "$f" in
		*.types.ts|*/types.ts|types.ts) : ;;
		*) TYPES_CHECKABLE+=("$f") ;;
	esac
	case "$f" in
		*vitest.config.ts) VITEST_CONFIGS+=("$f") ;;
	esac
done

# ARROW-FN — a statement-level `const x = (...) =>` is a declaration via
# arrow, which the rules forbid (arrows belong inside HOF callbacks only).
while IFS=: read -r fname ln _; do
	_report "$fname" "$ln" ERROR ARROW-FN "standalone arrow-function declaration — use a named function declaration"
done < <(grep -HnE '^[[:space:]]*(export[[:space:]]+)?const[[:space:]]+[A-Za-z_$][A-Za-z0-9_$]*[[:space:]]*(:[^=]*)?=[[:space:]]*(async[[:space:]]+)?(\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)[[:space:]]*(:[^=]*)?=>' "${CHECKABLE[@]}" || true)

# MULTILINE-IMPORT — an import line that opens `{` without closing it.
while IFS=: read -r fname ln _; do
	_report "$fname" "$ln" ERROR MULTILINE-IMPORT "import split across lines — merge onto one line"
done < <(grep -HnE '^import[[:space:]]+(type[[:space:]]+)?\{[^}]*$' "${CHECKABLE[@]}" || true)

# MIDFILE-IMPORT / JSDOC / BRACE — need statefulness, so one awk pass.
# FNR == 1 resets that state at each new file; FILENAME/FNR replace the per-file loop.
while IFS=$'\t' read -r fname ln rule msg; do
	level=ERROR
	[[ "$rule" == "JSDOC" || "$rule" == "BRACE" ]] && level=WARN
	_report "$fname" "$ln" "$level" "$rule" "$msg"
done < <(awk '
	FNR == 1 { seen_code = 0; prev = "" }
	{
		line = $0
		trimmed = line
		sub(/^[[:space:]]+/, "", trimmed)

		is_import = (trimmed ~ /^import[[:space:]]/)
		is_blank_or_comment = (trimmed == "" || trimmed ~ /^\/\// || trimmed ~ /^\/\*/ || trimmed ~ /^\*/ || trimmed ~ /^"use / || trimmed ~ /^#!/)

		# MIDFILE-IMPORT: an import after real code has started.
		if (is_import && seen_code)
			printf "%s\t%d\tMIDFILE-IMPORT\timport below the first non-import statement — move to top\n", FILENAME, FNR
		if (!is_import && !is_blank_or_comment)
			seen_code = 1

		# JSDOC: exported declaration must be directly preceded by a JSDoc close.
		# A decorator between the JSDoc and the declaration is fine (prev is then
		# the decorator itself or its closing "})").
		# (identifier required after the keyword so barrel re-exports like
		# "export type { paths }" do not match)
		if (trimmed ~ /^export[[:space:]]+(default[[:space:]]+)?(async[[:space:]]+)?(function|class|interface|type|const|enum)[[:space:]]+[A-Za-z_$]/ && prev !~ /\*\/[[:space:]]*$/ && prev !~ /^@/ && prev !~ /^\}\)/)
			printf "%s\t%d\tJSDOC\texported declaration has no JSDoc directly above it\n", FILENAME, FNR

		# BRACE: multi-line function/class with { on the declaration line
		# (single-line bodies are exempt — they close } on the same line).
		if ((trimmed ~ /^(export[[:space:]]+)?(default[[:space:]]+)?(async[[:space:]]+)?function[[:space:]]+[A-Za-z_$]/ || trimmed ~ /^(export[[:space:]]+)?(abstract[[:space:]]+)?class[[:space:]]+[A-Za-z_$]/) && trimmed ~ /\{[[:space:]]*$/ && trimmed !~ /\}/)
			printf "%s\t%d\tBRACE\topening { should be on its own line (Allman) for multi-line declarations\n", FILENAME, FNR

		if (!is_blank_or_comment || trimmed ~ /\*\/[[:space:]]*$/)
			prev = trimmed
	}
' "${CHECKABLE[@]}")

# REL-IMPORT-EXT — the repo type-checks with moduleResolution "bundler" and ships
# esbuild bundles, so a relative import names the file on disk, not the compiled
# output. Run scripts/relative-import-extensions.mjs to fix a whole branch at once.
while IFS=: read -r fname ln _; do
	_report "$fname" "$ln" ERROR REL-IMPORT-EXT "relative import must not end in .js (bundler resolution)"
done < <(grep -HnE '(from|import|require|vi\.(mock|doMock))[[:space:]]*\(?[[:space:]]*"\.\.?/[^"]*\.js"' "${CHECKABLE[@]}" || true)

# PKG-IMPORT-EXT — @opencrane barrel specifiers must NOT carry .js. (Deep
# subpath imports of third-party packages, e.g. the MCP SDK, genuinely end
# in .js — only our own barrels are covered by the rule.)
while IFS=: read -r fname ln _; do
	_report "$fname" "$ln" ERROR PKG-IMPORT-EXT "@opencrane package specifier must not end in .js"
done < <(grep -HnE 'from[[:space:]]+"@opencrane/[^"]+\.js"' "${CHECKABLE[@]}" || true)

# CONSOLE — shipped code logs via @opencrane/backend/observability.
while IFS=: read -r fname ln _; do
	_report "$fname" "$ln" ERROR CONSOLE "raw console.* — use the structured logger (@opencrane/backend/observability)"
done < <(grep -HnE '(^|[^.[:alnum:]_])console\.(log|warn|error|info|debug)\(' "${CHECKABLE[@]}" || true)

# CATEGORICAL-LITERAL — an OpenCrane-owned kind/type/status/state/reason/mode/action/
# outcome/decision branch should compare against a documented string-backed enum.
# External protocols and schema/data literals can look identical, so this remains a
# WARN for the reviewer to confirm rather than an automatic failure.
while IFS=: read -r fname ln _; do
	_report "$fname" "$ln" WARN CATEGORICAL-LITERAL "categorical property compared with a raw string — use the owning string-backed enum or verify an external/schema/data exemption"
done < <(grep -HnE '(\.(kind|type|status|state|reason|mode|action|outcome|decision)[[:space:]]*(===|!==)[[:space:]]*"[^"]+"|"[^"]+"[[:space:]]*(===|!==)[[:space:]]*[^[:space:]]+\.(kind|type|status|state|reason|mode|action|outcome|decision))' "${CHECKABLE[@]}" || true)

# TYPES-IN-IMPL — exported interfaces/type aliases belong in *.types.ts.
if [[ ${#TYPES_CHECKABLE[@]} -gt 0 ]]; then
	while IFS=: read -r fname ln _; do
		_report "$fname" "$ln" ERROR TYPES-IN-IMPL "exported interface/type outside *.types.ts — move to the paired types file"
	done < <(grep -HnE '^[[:space:]]*export[[:space:]]+(interface|type)[[:space:]]+[A-Za-z_$]' "${TYPES_CHECKABLE[@]}" || true)
fi

# ROOT-CACHE — every vitest config must anchor its Vite cache at the repo root,
# or the dep optimizer spawns a stray node_modules/.vite inside the package.
for f in ${VITEST_CONFIGS[@]+"${VITEST_CONFIGS[@]}"}; do
	if ! grep -q '_PackageCacheDir' "$f"; then
		_report "$f" 1 ERROR ROOT-CACHE "vitest config without _PackageCacheDir cacheDir — caches must live under the root node_modules (see vitest.cache.ts)"
	fi
done

# 3. Summary + exit code: ERROR findings fail the check; WARN findings are
#    heuristics for the reviewing agent to confirm at the cited line.
echo "agent-style-check: ${#CHECKABLE[@]} file(s) checked — ${ERRORS} error(s), ${WARNS} warning(s)."
[[ $ERRORS -gt 0 ]] && exit 1
exit 0
