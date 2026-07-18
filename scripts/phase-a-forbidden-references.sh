#!/usr/bin/env bash
# Phase A deletion-debt guard (#245/#248).
#
# Retired runtime/CLI concepts may remain only in exact target decision records, applied Prisma
# schema history, and the legacy implementation paths that are still awaiting direct deletion. The
# patterns deliberately avoid generic words such as "channels", "MCP", or "session": those remain
# valid product concepts. Linkerd is governed by an exact path inventory until it is deleted.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

FAILURES=0
LEGACY_LINKERD_INVENTORY="docs/agents/legacy-linkerd-inventory.txt"

TARGET_RECORDS='^(plan\.md|docs/design/(personal-agent-platform-architecture|personal-agent-platform-direct-refactor-plan|personal-agent-platform-product-contract|openclaw-agent-loop-replacement-plan)\.md|docs/adr/0005-[^/]+\.md)$'
APPLIED_SCHEMA_HISTORY='^apps/opencrane/prisma/migrations/'
RESEARCH_HISTORY='^(docs/research/litellm-byok-byom-research\.md|docs/specs/mcp-catalog-credential-spec\.md)$'
HISTORICAL_RECORDS='^(plan-done\.md|CHANGELOG\.md|silo-multi-tenant-plan\.md|docs/briefs/mcp-skills-platform-brief\.md|docs/design/stage5-silo-autonomous-controllers-plan\.md|docs/agents/deploy-ledger\.md)$'
RUNTIME_CONTRACT_TESTS='^(\.github/workflows/docker\.yml|apps/_infra/deploy-k8s/platform/tests/tenant-image-immutability\.sh|libs/backend/feat-openclaw-tenant/main/src/__tests__/tenants/tenant-resource-builder\.test\.ts)$'

_search_repo_lines()
{
	local pattern="$1"

	git grep -nI -E -e "$pattern" -- \
		. \
		':(exclude)node_modules/**' \
		':(exclude)dist/**' \
		':(exclude)scripts/phase-a-forbidden-references.sh' \
		':(exclude)scripts/phase-a-forbidden-references-negative-tests.sh' \
		':(exclude)docs/agents/legacy-linkerd-inventory.txt' \
		2>/dev/null || true
}

_search_repo_files()
{
	local pattern="$1"

	git grep -Il -E -e "$pattern" -- \
		. \
		':(exclude)node_modules/**' \
		':(exclude)dist/**' \
		':(exclude)scripts/phase-a-forbidden-references.sh' \
		':(exclude)scripts/phase-a-forbidden-references-negative-tests.sh' \
		':(exclude)docs/agents/legacy-linkerd-inventory.txt' \
		2>/dev/null || true
}

_search_file_lines()
{
	local pattern="$1"
	local file="$2"

	grep -nE -- "$pattern" "$file" 2>/dev/null || true
}

_file_matches()
{
	local pattern="$1"
	local file="$2"

	grep -qiE -- "$pattern" "$file"
}

_report()
{
	local label="$1"
	local file="$2"
	local line="$3"
	local text="$4"
	printf '%s:%s\tERROR\t%s\t%s\n' "$file" "$line" "$label" "$text"
	FAILURES=$((FAILURES + 1))
}

_check_pattern()
{
	local label="$1"
	local pattern="$2"
	local allowed="$3"
	local match_file
	local match_line
	local match_text

	while IFS=: read -r match_file match_line match_text; do
		[[ -z "$match_file" ]] && continue
		match_file="${match_file#./}"
		if [[ "$match_file" =~ $allowed ]]; then
			continue
		fi
		_report "$label" "$match_file" "$match_line" "$match_text"
	done < <(_search_repo_lines "$pattern")
}

_check_file_absent()
{
	local label="$1"
	local file="$2"
	local pattern="$3"
	local match_line
	local match_text

	[[ ! -f "$file" ]] && return 0
	while IFS=: read -r match_line match_text; do
		[[ -z "$match_line" ]] && continue
		_report "$label" "$file" "$match_line" "$match_text"
	done < <(_search_file_lines "$pattern" "$file")
}

_check_legacy_linkerd_inventory()
{
	local file
	local allowed

	if [[ ! -f "$LEGACY_LINKERD_INVENTORY" ]]; then
		_report "LINKERD-LEGACY-INVENTORY" "$LEGACY_LINKERD_INVENTORY" 1 "inventory file is missing"
		return
	fi

	while IFS= read -r file; do
		[[ -z "$file" ]] && continue
		allowed="false"
		while IFS= read -r inventory_path; do
			[[ -z "$inventory_path" || "$inventory_path" == \#* ]] && continue
			if [[ "$file" == "$inventory_path" ]]; then
				allowed="true"
				break
			fi
		done < "$LEGACY_LINKERD_INVENTORY"

		if [[ "$allowed" != "true" ]]; then
			_report "LINKERD-LEGACY-REFERENCE" "$file" 1 "new Linkerd reference outside the legacy inventory"
		fi
	done < <(_search_repo_files 'linkerd|LINKERD_' | sed 's#^\./##' | sort -u || true)

	# The inventory is exact, not a bank of pre-authorized paths. A path that no longer contains a
	# legacy Linkerd reference must be removed so it cannot silently regain one later.
	while IFS= read -r inventory_path; do
		[[ -z "$inventory_path" || "$inventory_path" == \#* ]] && continue
		if [[ ! -f "$inventory_path" ]] || ! _file_matches 'linkerd|LINKERD_' "$inventory_path"; then
			_report "LINKERD-INVENTORY-STALE" "$inventory_path" 1 "inventory path has no current Linkerd reference"
		fi
	done < "$LEGACY_LINKERD_INVENTORY"
}

# Retired tenant runtime filesystem/config/version surfaces. Effective-contract properties such as
# mcpPolicyEnforced and genuine frontend channel models are intentionally outside these patterns.
_check_pattern "SHARED-SKILLS" '(/shared-skills|OPENCRANE_SHARED_SKILLS_DIR|_link_shared_skills)' "($TARGET_RECORDS|$HISTORICAL_RECORDS|$RUNTIME_CONTRACT_TESTS)"
_check_pattern "SHARED-SKILLS-VALUES" '^[[:space:]]*sharedSkills:' "($TARGET_RECORDS|$HISTORICAL_RECORDS)"
_check_pattern "CONFIG-OVERRIDES" 'configOverrides' "($TARGET_RECORDS|$APPLIED_SCHEMA_HISTORY|$HISTORICAL_RECORDS)"
_check_pattern "TENANT-MCP-POLICY" '(^|[^[:alnum:]_])mcpPolicy([^[:alnum:]_]|$)' "($TARGET_RECORDS|$HISTORICAL_RECORDS)"
_check_pattern "OPENCLAW-RUNTIME-VERSION" '(openclawVersion|OPENCLAW_VERSION|DEFAULT_OPENCLAW_VERSION)' "($TARGET_RECORDS|$HISTORICAL_RECORDS|$RUNTIME_CONTRACT_TESTS|^apps/feat-openclaw-tenant/deploy/Dockerfile$)"
_check_pattern "OPENCLAW-CANARY" '(TenantUpdateWithCanaryStrategyController|tenant-update-with-canary-strategy|OPENCRANE_TENANT_ROLLOUT|OPENCRANE_CANARY_TIMEOUT)' "($TARGET_RECORDS|$HISTORICAL_RECORDS)"
_check_pattern "OPENCLAW-OBOT-HEALTH" '(Obot health checker|Obot health)' "($TARGET_RECORDS|$HISTORICAL_RECORDS)"
_check_file_absent "TENANT-CRD-RETIRED-FIELD" "apps/_infra/deploy-k8s/templates/crds/tenant.opencrane.io_tenants.yaml" '^[[:space:]]+(mcpPolicy|channels|configOverrides|openclawVersion):'
_check_file_absent "TENANT-SPEC-RETIRED-FIELD" "libs/backend/feat-openclaw-tenant/main/src/reconcilers/tenants/models/tenant-spec.types.ts" '^[[:space:]]+(mcpPolicy|channels|configOverrides|openclawVersion)\??:'

# Pairing/device state and the no-token pod-token route are direct-deletion targets. Constrain the
# remaining implementation and documentation so no new dependency can grow before removal.
_check_pattern "PAIRING-DEVICE" '(BrokeredDevice|brokered-device|openclaw-pairing|/pod-token/cut|/:name/pairing)' "($TARGET_RECORDS|$APPLIED_SCHEMA_HISTORY|$HISTORICAL_RECORDS)"
POD_TOKEN_DELETION_SCOPE="^(libs/backend/server/identity/main/src/auth\.router\.ts|libs/backend/server/connections/main/src/(core/gateway-resolve|routes/auth-connections|__tests__/auth-connections\.test)\.ts|website/security/connection-security\.md|docs/agents/(architecture|apps/opencrane)\.md|CHANGELOG\.md|plan\.md|plan-done\.md|docs/design/(personal-agent-platform-architecture|personal-agent-platform-direct-refactor-plan|openclaw-agent-loop-replacement-plan)\.md)$"
_check_pattern "POD-TOKEN-DELETION-BOUNDARY" '(/api/v1/auth/pod-token|["`]/?pod-token(/cut)?["`])' "$POD_TOKEN_DELETION_SCOPE"

# SessionScope is retired product state. All runtime CRUD/client/package references are forbidden
# outside the exact old schema, applied Prisma schema history, and decision records.
SESSION_SCOPE_RETENTION="($TARGET_RECORDS|$APPLIED_SCHEMA_HISTORY|$HISTORICAL_RECORDS|^docs/agents/apps/opencrane\.md$)"
_check_pattern "SESSION-SCOPE" '(SessionScope|session-scope([^[:alnum:]]|$)|@opencrane/backend-sessions|/sessions/[^[:space:]`"]*/scope)' "$SESSION_SCOPE_RETENTION"

# The Obot registry poll was a no-op. The spec is retained only as evidence explaining its removal.
_check_pattern "OBOT-REGISTRY-POLL" '(obot-registry|OBOT_SERVER_PROVIDER_REGISTRIES)' "($TARGET_RECORDS|$RESEARCH_HISTORY|$HISTORICAL_RECORDS)"

# Artifact bytes have one target owner: ArtifactStore on the artifact-service PVC. Keep retired
# OCI/Zot vocabulary out of active guidance and the README so it cannot be mistaken for a usable
# deployment option. Target decision records and applied history retain the deletion rationale.
ARTIFACT_LEGACY_RECORDS="($TARGET_RECORDS|$APPLIED_SCHEMA_HISTORY|$HISTORICAL_RECORDS|^docs/adr/0002-[^/]+\.md$|^\.agents/skills/observability/SKILL\.md$|^\.claude/agents/observability\.md$|^\.codex/agents/observability\.toml$)"
_check_pattern "ARTIFACT-OCI-ZOT" '(skill-oci-store|SKILL_OCI_|[Zz]ot([[:space:]/[:punct:]]|$)|OCI/ORAS|OCI registry)' "$ARTIFACT_LEGACY_RECORDS"

# CLI history is kept only in the accepted decision trail and the two named research/spec records.
_check_pattern "OC-CLI-PACKAGE" '(@opencrane/cli|apps/cli)' "($TARGET_RECORDS|$RESEARCH_HISTORY|$HISTORICAL_RECORDS)"
_check_pattern "OC-CLI-INVOCATION" '(^|[[:space:]`$])oc[[:space:]]+(auth|tenants|cluster-tenant|policies|mcp|skills|budget|audit|tokens|providers|model|routing|sessions|platform|awareness)([[:space:]`]|$)' "($TARGET_RECORDS|$RESEARCH_HISTORY|$HISTORICAL_RECORDS)"
_check_pattern "CLI-DEVICE-FLOW" '(device-grant|/auth/device(/activate|/token)?|cli-device-)' "($TARGET_RECORDS|$HISTORICAL_RECORDS)"

# Production-transition vocabulary is historical only. Active plans, guidance, and code must not
# rebuild the discarded release program around a product that has never been in production. The two
# decision records that respectively selected (0006, superseded) and retired (0007) the program may
# name it; nothing else may.
TRANSITION_DECISION_RECORDS='^docs/adr/(README\.md|000[67]-[^/]+\.md)$'
_check_pattern "TRANSITION-PROGRAM" '(frozen-blue|blue/green|whole-silo|maintenance[- ]window|activeSlot|activationEpoch|mid-cutover|R0/R3|R9 cutover|green branch|strangler|through[[:space:]]+R([0-9]|10)([^[:alnum:]_]|$)|until[[:space:]]+R([0-9]|10)([^[:alnum:]_]|$)|R([0-9]|10)(/R([0-9]|10))?[[:space:]]+(gate|cutover|migration|decommission|freeze))' "($HISTORICAL_RECORDS|$TRANSITION_DECISION_RECORDS)"

# Issue #135's external secret-custody half is blocked. Existing references may shrink, but no new
# broad-secret broadcast reference may be added while that explicit exception remains open.
ORG_SECRET_135='^(docs/design/personal-agent-platform-architecture\.md|docs/research/litellm-byok-byom-research\.md)$'
_check_pattern "ORG-SHARED-SECRETS-135" 'org-shared-secrets' "$ORG_SECRET_135"

_check_legacy_linkerd_inventory

if [[ "$FAILURES" -gt 0 ]]; then
	printf 'phase-a-forbidden-references: %d forbidden reference(s).\n' "$FAILURES"
	exit 1
fi

echo "phase-a-forbidden-references: retired references and legacy Linkerd inventory are clean."
