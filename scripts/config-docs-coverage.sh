#!/usr/bin/env bash
# config-docs-coverage.sh — deterministic (zero-token) coverage check: every
# Helm configuration option vs the operator docs on the website.
#
# The deploy fleet's docs run uses this to find undocumented configuration
# instead of asking a model to eyeball 1000+ lines of values.yaml. The gap
# list it prints is the work order handed to the `website` agent.
#
# Usage:
#   scripts/config-docs-coverage.sh                  # all in-repo charts vs website/
#   scripts/config-docs-coverage.sh --chart apps/_infra/deploy-k8s
#   scripts/config-docs-coverage.sh --keys-only apps/_infra/deploy-k8s   # dump inventory
#   scripts/config-docs-coverage.sh --strict         # exit 1 when gaps exist
#
# The fleet-platform chart moved to the WeOwnAI repo (elewa-git/opencrane#150) — pass
# --chart <path-to-checked-out-copy> to check it; it is no longer in the default list.
#
# A key counts as documented when its full dotted path (e.g. `gatewayProxy.
# trustedProxies`) OR its final two segments appear anywhere in the docs
# corpus (website/operators + website/guide + website/advanced). Heuristic on
# purpose: false "documented" is possible, false "undocumented" is rare — so
# the gap list is safe to act on.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

CHARTS=("apps/_infra/deploy-k8s")
DOCS_DIRS=("website/operators" "website/guide" "website/advanced")
STRICT=0
KEYS_ONLY=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--chart) CHARTS=("$2"); shift 2 ;;
		--keys-only) KEYS_ONLY="$2"; shift 2 ;;
		--strict) STRICT=1; shift ;;
		*) echo "unknown flag: $1" >&2; exit 2 ;;
	esac
done

# _extract_keys <values.yaml> — print one dotted key path per leaf, derived
# from 2-space YAML indentation. Comments, blank lines, list internals, and
# block scalars (| / >) are skipped; a list-valued or scalar-valued key is a
# leaf, a map-valued key is a path segment.
_extract_keys()
{
	awk '
		BEGIN { depth = 0; skip_indent = -1 }
		{
			# 1. Measure indentation, ignore blank/comment lines — they carry
			#    no structure.
			line = $0
			if (line ~ /^[[:space:]]*(#|$)/) next
			indent = 0
			while (substr(line, indent + 1, 1) == " ") indent++
			trimmed = substr(line, indent + 1)

			# 2. Block-scalar bodies (values of keys ending in | or >) are prose,
			#    not structure — skip every line deeper than the scalar key.
			if (skip_indent >= 0) {
				if (indent > skip_indent) next
				skip_indent = -1
			}

			# 3. List items are values, not config keys — record nothing inside.
			if (trimmed ~ /^-/) next

			# 4. Must look like a key. Level = indent/2 (Helm values are 2-space).
			if (trimmed !~ /^[A-Za-z0-9_."'\''-]+[[:space:]]*:/) next
			level = int(indent / 2)
			key = trimmed
			sub(/[[:space:]]*:.*/, "", key)
			gsub(/["'\''"]/, "", key)
			path[level] = key
			rest = trimmed
			sub(/^[^:]*:[[:space:]]*/, "", rest)

			# 5. A key with an inline value (or empty map/list literal) is a leaf;
			#    emit its dotted path. A bare `key:` is a branch (children follow).
			if (rest ~ /^[|>]/) { skip_indent = indent }
			if (rest != "" || skip_indent == indent) {
				p = path[0]
				for (i = 1; i <= level; i++) p = p "." path[i]
				print p
			} else {
				# Branch now; if no children follow it will emit nothing — that is
				# fine, an empty map carries no documentable option.
			}
		}
	' "$1" | sort -u
}

if [[ -n "$KEYS_ONLY" ]]; then
	_extract_keys "$KEYS_ONLY/values.yaml"
	exit 0
fi

# Build the docs corpus once.
CORPUS="$(mktemp)"
trap 'rm -f "$CORPUS"' EXIT
for d in "${DOCS_DIRS[@]}"; do
	[[ -d "$d" ]] && cat "$d"/*.md >> "$CORPUS" 2>/dev/null || true
done

TOTAL_GAPS=0
for chart in "${CHARTS[@]}"; do
	vf="$chart/values.yaml"
	[[ -f "$vf" ]] || { echo "skip: $vf not found" >&2; continue; }
	echo "## $chart"
	gaps=0
	checked=0
	while IFS= read -r key; do
		checked=$((checked + 1))
		# Documented if the full dotted path appears, or the last two segments
		# (e.g. `otel.enabled` for `observability.otel.enabled`).
		tail2="$(echo "$key" | awk -F. '{ if (NF >= 2) print $(NF-1)"."$NF; else print $NF }')"
		if ! grep -qF "$key" "$CORPUS" && ! grep -qF "$tail2" "$CORPUS"; then
			echo "  UNDOCUMENTED  $key"
			gaps=$((gaps + 1))
		fi
	done < <(_extract_keys "$vf")
	echo "  -- $gaps undocumented of $checked configuration keys"
	TOTAL_GAPS=$((TOTAL_GAPS + gaps))
done

echo
echo "config-docs-coverage: $TOTAL_GAPS undocumented key(s) total."
[[ $STRICT -eq 1 && $TOTAL_GAPS -gt 0 ]] && exit 1
exit 0
