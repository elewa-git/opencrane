#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root resolved from this executable. */
const _ROOT = fileURLToPath(new URL("../", import.meta.url));
/** Default inventory reviewed beside the repository's other agent policies. */
const _INVENTORY_PATH = "docs/agents/authorization-enforcement-inventory.json";
/** Hand-maintained production trees in which a product authorization bypass can be introduced. */
const _PRODUCTION_ROOTS = ["apps", "libs"];
/** Source extensions whose executable policy is inspected. */
const _SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".py", ".ts", ".tsx"]);
/** Migration states that have precise checker semantics. */
const _MIGRATION_STATES = new Set(["authority-adopted", "identity-boundary-survivor", "temporary-migration", "workload-proof-survivor"]);
/** Durable evidence classes supported by the product authorization catalogue. */
const _RECEIPT_CLASSES = new Set(["decision", "effect", "read", "workload-assignment-proof"]);
/** Target ports accepted by this migration inventory. */
const _TARGET_AUTHORITIES = new Set([
	"AuthorizationAuthority.admit",
	"AuthorizationAuthority.admitPrincipal",
	"AuthorizationAuthority.admitPrincipalBatch",
	"AuthorizationAuthority.decide",
	"AuthorizationAuthority.listEntitled",
	"AuthorizationAuthority.listManagedGrants",
	"AuthorizationAuthority.listPrincipalEntitled",
	"AuthorizationAuthority.replaceManagedGrants",
	"IdentityAuthority.authenticate",
	"WorkloadAssignmentAuthority.verify",
]);
/** Ordered implementation waves that must delete temporary policy paths. */
const _REMOVAL_WAVES = new Set(["agent-authority", "data-and-actions", "governed-packages", "legacy-reaping", "workload-boundary"]);
/** Resource kinds already declared by ProductAuthorizationResourceKinds. */
const _CATALOGUE_RESOURCES = new Set(["agent-revision", "agent-run", "agent-service", "approval-request", "artifact", "artifact-collection", "artifact-revision", "audit-log", "authorization-grant", "budget", "channel-target", "conversation", "conversation-collection", "dataset", "group", "mcp-server", "mcp-server-revision", "mcp-task", "mcp-tool-revision", "memory-scope", "model-definition", "organization", "organization-membership", "persona", "persona-collection", "provider-connection", "resource-share", "schedule", "skill", "skill-revision", "third-party-source", "token-usage", "tool-invocation"]);
/** Actions already declared by ProductAuthorizationActions. */
const _CATALOGUE_ACTIONS = new Set(["administer", "assign", "cancel", "create", "decide", "delegate", "delete", "discover", "edit", "forget", "install", "invoke", "manage", "publish", "read", "retire", "retry", "review", "revoke", "schedule", "send", "share", "use"]);
/** Catalogue source whose reviewed rule classes constrain each inventory entry. */
const _CATALOGUE_SOURCE_PATH = "libs/models/authorization/main/src/product-authorization.ts";
/** Enum source that maps TypeScript member names to persisted catalogue strings. */
const _CATALOGUE_TYPES_PATH = "libs/models/authorization/main/src/product-authorization.types.ts";

/**
 * Fixed forbidden syntax owned by this checker.
 *
 * Inventory entries may bind an existing match to a removal wave, but cannot add a new pattern or
 * broaden one. That keeps the inventory from becoming a compatibility-exemption mechanism.
 */
const _FORBIDDEN_PATTERNS = [
	{ id: "legacy-cluster-tenant-scope-guard", expression: /\b_ClusterTenantScopeGuard\s*\(/gu },
	{ id: "legacy-conversation-access-helper", expression: /\b_ConversationAccess\s*\(\s*caller\s*\)/gu },
	{ id: "legacy-conversation-read-authorizer", expression: /\b__AuthorizeConversationRead\s*\(/gu },
	{ id: "legacy-frontend-org-admin-capability", expression: /authenticated\s*&&\s*isOrgAdmin/gu },
	{ id: "legacy-inline-org-admin-decision", expression: /if\s*\(\s*!\s*(?:[A-Za-z_$][\w$]*\.)+isOrgAdmin\s*\)/gu },
	{ id: "legacy-mcp-access-editor", expression: /["']mcp-access-editor["']/gu },
	{ id: "legacy-org-admin-middleware", expression: /\b_RequireOrgAdmin\s*\(\s*\)(?!\s*:)/gu },
	{ id: "legacy-organization-role-decision", expression: /role:\s*\{\s*in:\s*\[OrgRole\.Owner,\s*OrgRole\.Admin\]\s*\}/gu },
	{ id: "legacy-personal-artifact-owner-catalogue", expression: /listOwnedCatalogue\s*\(\s*caller\.siloId,\s*caller\.ownerPrincipalId\s*\)/gu },
	{ id: "legacy-personal-grant-filter", expression: /\.filter\s*\(\s*function\s+_IsActivePersonalGrant\b/gu },
	{ id: "legacy-platform-operator-decision", expression: /if\s*\(\s*authUser\.isPlatformOperator(?:\s*===\s*true)?\s*\)/gu },
	{ id: "legacy-product-boundary-evaluator", expression: /\b__ValidateBoundaryAttachAuthority\s*\(/gu },
	{ id: "legacy-resource-share-owner-decision", expression: /recipient\.ownerPrincipalId\s*!==\s*command\.caller\.principalId/gu },
	{ id: "legacy-run-owner-query", expression: /delegatedUserId:\s*(?:command\.)?(?:subjectId|requestedBy)/gu },
	{ id: "legacy-silo-wide-skill-catalogue", expression: /listCatalogue\s*\(\s*caller\.siloId\s*\)/gu },
	{ id: "legacy-skill-owner-decision", expression: /skill:\s*\{\s*siloId:\s*caller\.siloId,\s*ownerPrincipalId:\s*caller\.principalId\s*\}/gu },
	{ id: "legacy-tool-invocation-direct-admission", expression: /\.mcpTasks\.admitToolInvocation\s*\(/gu },
];

/** Return a normalized repository-relative path. */
function _Relative(root, path)
{
	return relative(root, path).replaceAll("\\", "/");
}

/** Return the extension of one path without importing another policy dependency. */
function _Extension(path)
{
	const name = path.slice(path.lastIndexOf("/") + 1);
	const index = name.lastIndexOf(".");
	return index < 0 ? "" : name.slice(index);
}

/** Reject generated, vendored, fixture, and test source from the production scan. */
function _IsProductionSource(path)
{
	if (!_SOURCE_EXTENSIONS.has(_Extension(path))) return false;
	return !/(?:^|\/)(?:__tests__|fixtures|generated|node_modules|test|tests)(?:\/|$)/u.test(path)
		&& !/\.(?:spec|test)\.[^.]+$/u.test(path);
}

/** Recursively collect maintained production source below one repository directory. */
function _ProductionFiles(root, directory)
{
	if (!existsSync(directory)) return [];
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true }))
	{
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(..._ProductionFiles(root, path));
		else if (entry.isFile() && _IsProductionSource(_Relative(root, path))) files.push(path);
	}
	return files;
}

/** Count literal, non-overlapping anchor occurrences in one source file. */
function _CountOccurrences(source, anchor)
{
	let count = 0;
	let offset = 0;
	while (offset <= source.length)
	{
		const index = source.indexOf(anchor, offset);
		if (index < 0) break;
		count += 1;
		offset = index + anchor.length;
	}
	return count;
}

/** Return every start and end offset covered by a literal anchor. */
function _AnchorRanges(source, anchor)
{
	const ranges = [];
	let offset = 0;
	while (offset <= source.length)
	{
		const start = source.indexOf(anchor, offset);
		if (start < 0) break;
		ranges.push({ start, end: start + anchor.length });
		offset = start + anchor.length;
	}
	return ranges;
}

/** Return true when a value is a non-array object. */
function _IsObject(value)
{
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Parse one string-valued enum without executing TypeScript during the repository check. */
function _EnumValues(source, name)
{
	const start = source.indexOf(`export enum ${name}`);
	if (start < 0) return new Map();
	const end = source.indexOf("\n}", start);
	if (end < 0) return new Map();
	const values = new Map();
	for (const match of source.slice(start, end).matchAll(/^\s*([A-Za-z][A-Za-z0-9]*)\s*=\s*"([a-z0-9-]+)"/gmu))
		values.set(match[1], match[2]);
	return values;
}

/** Parse action members from one `_Rules` call body. */
function _RuleActions(source, actionValues)
{
	return [...source.matchAll(/ProductAuthorizationActions\.([A-Za-z][A-Za-z0-9]*)/gu)].flatMap(function _Action(match)
	{
		const action = actionValues.get(match[1]);
		return action === undefined ? [] : [action];
	});
}

/** Load the exact evidence class declared by the product catalogue for each coordinate. */
function _CatalogueEvidence(root)
{
	const cataloguePath = join(root, _CATALOGUE_SOURCE_PATH);
	const typesPath = join(root, _CATALOGUE_TYPES_PATH);
	if (!existsSync(cataloguePath) || !existsSync(typesPath)) return new Map();
	const source = readFileSync(cataloguePath, "utf8");
	const typeSource = readFileSync(typesPath, "utf8");
	const resourceValues = _EnumValues(typeSource, "ProductAuthorizationResourceKinds");
	const actionValues = _EnumValues(typeSource, "ProductAuthorizationActions");
	const evidence = new Map();
	function _Add(resourceMember, actionSource, evidenceMember)
	{
		const resource = resourceValues.get(resourceMember);
		if (resource === undefined) return;
		for (const action of _RuleActions(actionSource, actionValues))
			evidence.set(`${resource}:${action}`, evidenceMember.toLowerCase());
	}
	for (const match of source.matchAll(/_Rules\(ProductAuthorizationResourceKinds\.([A-Za-z][A-Za-z0-9]*),\s*\[([^\]]*)\],\s*ProductAuthorizationEvidenceKinds\.([A-Za-z][A-Za-z0-9]*)\)/gu))
		_Add(match[1], match[2], match[3]);
	for (const helperName of ["_PackageRules", "_RevisionRules", "_ContentRules"])
	{
		const helperStart = source.indexOf(`function ${helperName}(`);
		const helperEnd = helperStart < 0 ? -1 : source.indexOf("\n}", helperStart);
		if (helperStart < 0 || helperEnd < 0) continue;
		const helperSource = source.slice(helperStart, helperEnd);
		const helperRules = [...helperSource.matchAll(/_Rules\(resourceKind,\s*\[([^\]]*)\],\s*ProductAuthorizationEvidenceKinds\.([A-Za-z][A-Za-z0-9]*)\)/gu)];
		const invocation = new RegExp(`${helperName}\\(ProductAuthorizationResourceKinds\\.([A-Za-z][A-Za-z0-9]*)\\)`, "gu");
		for (const match of source.matchAll(invocation))
			for (const rule of helperRules)
				_Add(match[1], rule[1], rule[2]);
	}
	return evidence;
}

/** Return whether a target port can satisfy the catalogue's evidence requirement. */
function _TargetMatchesReceipt(targetAuthority, receiptClass)
{
	if (!targetAuthority.startsWith("AuthorizationAuthority.")) return true;
	const method = targetAuthority.slice("AuthorizationAuthority.".length);
	if (receiptClass === "read") return ["decide", "listEntitled", "listManagedGrants", "listPrincipalEntitled"].includes(method);
	return ["admit", "admitPrincipal", "admitPrincipalBatch", "replaceManagedGrants"].includes(method);
}

/** Read an exact authority method from an anchor that directly names one. */
function _AnchoredAuthorityMethod(anchor)
{
	const match = anchor.match(/\.(admitPrincipalBatch|admitPrincipal|admit|decide|listManagedGrants|listPrincipalEntitled|listEntitled|replaceManagedGrants)\s*\(/u);
	return match?.[1] ?? null;
}

/** Validate the exact shape of one current source locator. */
function _ValidateCurrentPath(currentPath, context, errors)
{
	if (!_IsObject(currentPath)
		|| typeof currentPath.path !== "string"
		|| !/^(?:apps|libs)\/[A-Za-z0-9_./-]+$/u.test(currentPath.path)
		|| currentPath.path.includes("..")
		|| typeof currentPath.anchor !== "string"
		|| currentPath.anchor.trim().length < 12
		|| !Number.isSafeInteger(currentPath.expectedOccurrences)
		|| currentPath.expectedOccurrences < 1)
	{
		errors.push(`${context}: malformed currentPath`);
	}
}

/** Validate schema, uniqueness, catalogue gaps, migration semantics, and live source anchors. */
export function _ValidateAuthorizationEnforcementInventory(inventory, root)
{
	const errors = [];
	if (!_IsObject(inventory) || inventory.version !== 1 || typeof inventory.policy !== "string" || inventory.policy.trim().length < 40 || !Array.isArray(inventory.entries) || !Array.isArray(inventory.catalogueGaps))
		return ["inventory: malformed top-level schema"];

	const catalogueEvidence = _CatalogueEvidence(root);
	if (catalogueEvidence.size === 0) errors.push("inventory: product authorization catalogue could not be read");
	const gaps = new Set();
	for (const [index, gap] of inventory.catalogueGaps.entries())
	{
		const context = `catalogueGaps[${index}]`;
		if (!_IsObject(gap) || typeof gap.kind !== "string" || !["action", "resource"].includes(gap.kind) || typeof gap.value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(gap.value) || typeof gap.reason !== "string" || gap.reason.trim().length < 20)
		{
			errors.push(`${context}: malformed catalogue gap`);
			continue;
		}
		const coordinate = `${gap.kind}:${gap.value}`;
		if (gaps.has(coordinate)) errors.push(`${context}: duplicate catalogue gap '${coordinate}'`);
		if ((gap.kind === "resource" ? _CATALOGUE_RESOURCES : _CATALOGUE_ACTIONS).has(gap.value)) errors.push(`${context}: '${gap.value}' already exists in the product catalogue`);
		gaps.add(coordinate);
	}

	const ids = new Set();
	const coordinates = new Set();
	const forbiddenIds = new Set(_FORBIDDEN_PATTERNS.map(function _Id(pattern) { return pattern.id; }));
	for (const [index, entry] of inventory.entries.entries())
	{
		const context = `entries[${index}]`;
		if (!_IsObject(entry))
		{
			errors.push(`${context}: entry must be an object`);
			continue;
		}
		const requiredStrings = ["id", "actor", "resource", "action", "targetAuthority", "lifecycleOwner", "receiptClass", "migrationState"];
		for (const field of requiredStrings)
		{
			if (typeof entry[field] !== "string" || !entry[field].trim()) errors.push(`${context}: ${field} must be a non-empty string`);
		}
		if (typeof entry.id === "string")
		{
			if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(entry.id)) errors.push(`${context}: id must be a stable lowercase coordinate`);
			if (ids.has(entry.id)) errors.push(`${context}: duplicate id '${entry.id}'`);
			ids.add(entry.id);
		}
		if (typeof entry.actor === "string" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(entry.actor)) errors.push(`${context}: actor must be lowercase kebab-case`);
		if (typeof entry.resource === "string" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(entry.resource)) errors.push(`${context}: resource must be lowercase kebab-case`);
		if (typeof entry.action === "string" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(entry.action)) errors.push(`${context}: action must be lowercase kebab-case`);
		if (typeof entry.resource === "string" && !_CATALOGUE_RESOURCES.has(entry.resource) && !gaps.has(`resource:${entry.resource}`)) errors.push(`${context}: resource '${entry.resource}' is missing from the catalogue without a declared gap`);
		if (typeof entry.action === "string" && !_CATALOGUE_ACTIONS.has(entry.action) && !gaps.has(`action:${entry.action}`)) errors.push(`${context}: action '${entry.action}' is missing from the catalogue without a declared gap`);
		if (!_TARGET_AUTHORITIES.has(entry.targetAuthority)) errors.push(`${context}: unsupported targetAuthority '${entry.targetAuthority}'`);
		if (!_RECEIPT_CLASSES.has(entry.receiptClass)) errors.push(`${context}: unsupported receiptClass '${entry.receiptClass}'`);
		if (typeof entry.resource === "string" && typeof entry.action === "string" && entry.migrationState === "authority-adopted")
		{
			const expectedReceipt = catalogueEvidence.get(`${entry.resource}:${entry.action}`);
			if (expectedReceipt === undefined) errors.push(`${context}: ${entry.resource}:${entry.action} has no product catalogue rule`);
			else if (entry.receiptClass !== expectedReceipt) errors.push(`${context}: receiptClass '${entry.receiptClass}' disagrees with catalogue '${expectedReceipt}'`);
			if (!_TargetMatchesReceipt(entry.targetAuthority, entry.receiptClass)) errors.push(`${context}: targetAuthority '${entry.targetAuthority}' cannot produce '${entry.receiptClass}' evidence`);
			const anchoredMethod = _AnchoredAuthorityMethod(entry.currentPath?.anchor ?? "");
			const targetMethod = entry.targetAuthority.startsWith("AuthorizationAuthority.") ? entry.targetAuthority.slice("AuthorizationAuthority.".length) : null;
			if (anchoredMethod !== null && targetMethod !== anchoredMethod) errors.push(`${context}: targetAuthority method '${targetMethod}' disagrees with anchored call '${anchoredMethod}'`);
		}
		if (!_MIGRATION_STATES.has(entry.migrationState)) errors.push(`${context}: unsupported migrationState '${entry.migrationState}'`);
		if (typeof entry.lifecycleOwner !== "string" || !/^(?:apps|libs)\/[A-Za-z0-9_./-]+$/u.test(entry.lifecycleOwner) || !existsSync(join(root, entry.lifecycleOwner))) errors.push(`${context}: lifecycleOwner must be a live repository path`);
		_ValidateCurrentPath(entry.currentPath, context, errors);

		if (!Array.isArray(entry.forbiddenPatterns) || new Set(entry.forbiddenPatterns).size !== entry.forbiddenPatterns?.length)
			errors.push(`${context}: forbiddenPatterns must be a duplicate-free list`);
		else
		{
			for (const patternId of entry.forbiddenPatterns)
				if (!forbiddenIds.has(patternId)) errors.push(`${context}: unknown forbidden pattern '${patternId}'`);
		}

		if (entry.migrationState === "temporary-migration")
		{
			if (!_REMOVAL_WAVES.has(entry.removeByWave)) errors.push(`${context}: temporary migration requires a reviewed removeByWave`);
		}
		else
		{
			if (entry.removeByWave !== null) errors.push(`${context}: retained or adopted entry must set removeByWave to null`);
			if (Array.isArray(entry.forbiddenPatterns) && entry.forbiddenPatterns.length > 0) errors.push(`${context}: only temporary migrations may cover forbidden syntax`);
		}

		if (_IsObject(entry.currentPath) && typeof entry.currentPath.path === "string" && typeof entry.currentPath.anchor === "string")
		{
			const coordinate = `${entry.currentPath.path}\u0000${entry.currentPath.anchor}`;
			if (coordinates.has(coordinate)) errors.push(`${context}: duplicate source anchor`);
			coordinates.add(coordinate);
			const absolutePath = join(root, entry.currentPath.path);
			if (!existsSync(absolutePath)) errors.push(`${context}: stale path '${entry.currentPath.path}'`);
			else
			{
				const occurrences = _CountOccurrences(readFileSync(absolutePath, "utf8"), entry.currentPath.anchor);
				if (occurrences !== entry.currentPath.expectedOccurrences) errors.push(`${context}: stale anchor expected ${entry.currentPath.expectedOccurrences}, found ${occurrences}`);
			}
		}
	}
	return errors;
}

/** Return the one-based line containing a source offset. */
function _Line(source, offset)
{
	return source.slice(0, offset).split("\n").length;
}

/** Test whether one temporary entry covers this exact forbidden source match. */
function _EntryCoversMatch(entry, path, patternId, source, match)
{
	if (entry.migrationState !== "temporary-migration" || entry.currentPath.path !== path || !entry.forbiddenPatterns.includes(patternId)) return false;
	return _AnchorRanges(source, entry.currentPath.anchor).some(function _Contains(range)
	{
		return match.index >= range.start && match.index + match[0].length <= range.end;
	});
}

/** Find forbidden product-policy syntax not bound to one exact temporary migration entry. */
export function _FindUninventoriedAuthorizationPatterns(root, inventory)
{
	const findings = [];
	const files = _PRODUCTION_ROOTS.flatMap(function _Files(directory) { return _ProductionFiles(root, join(root, directory)); }).sort();
	for (const absolutePath of files)
	{
		const path = _Relative(root, absolutePath);
		const source = readFileSync(absolutePath, "utf8");
		for (const pattern of _FORBIDDEN_PATTERNS)
		{
			const expression = new RegExp(pattern.expression.source, pattern.expression.flags);
			for (const match of source.matchAll(expression))
			{
				const covered = inventory.entries.some(function _Covers(entry) { return _EntryCoversMatch(entry, path, pattern.id, source, match); });
				if (!covered) findings.push(`${path}:${_Line(source, match.index ?? 0)} ${pattern.id} is not bound to an exact temporary migration entry`);
			}
		}
	}
	return findings;
}

/** Load and check the committed authorization inventory against the current tree. */
export function _CheckAuthorizationEnforcement(root = _ROOT, inventoryPath = _INVENTORY_PATH)
{
	const absoluteInventoryPath = resolve(root, inventoryPath);
	if (!existsSync(absoluteInventoryPath)) return [`${inventoryPath}: inventory is missing`];
	let inventory;
	try
	{
		inventory = JSON.parse(readFileSync(absoluteInventoryPath, "utf8"));
	}
	catch (error)
	{
		return [`${inventoryPath}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`];
	}
	const errors = _ValidateAuthorizationEnforcementInventory(inventory, root);
	if (errors.length > 0) return errors;
	return _FindUninventoriedAuthorizationPatterns(root, inventory);
}

if (process.argv[1] === fileURLToPath(import.meta.url))
{
	const root = process.env.AUTHORIZATION_ENFORCEMENT_ROOT ? resolve(process.env.AUTHORIZATION_ENFORCEMENT_ROOT) : _ROOT;
	const inventoryPath = process.env.AUTHORIZATION_ENFORCEMENT_INVENTORY ?? _INVENTORY_PATH;
	const findings = _CheckAuthorizationEnforcement(root, inventoryPath);
	for (const finding of findings) console.error(`authorization-enforcement: ${finding}`);
	if (findings.length > 0) process.exitCode = 1;
	else console.log("authorization-enforcement: PASS");
}
