import type { GovernedChildRunBudget, GovernedChildRunCapabilityDelegation, GovernedChildRunParent, GovernedChildRunPolicy, GovernedChildRunSpawnAuthorizationResult, GovernedChildRunSpawnRequest } from "./child-run-admission.types.js";
import { ___CloneCanonicalJson } from "@opencrane/util";
import type { JsonValue } from "@opencrane/util";

/**
 * Evaluates the pure, fail-closed parent boundary for one governed child-run request.
 *
 * This is deliberately not a durable admission and does not reserve fan-out or budget. The owning
 * repository must lock the parent, count its children, load its remaining budget, call this
 * function, then atomically reserve and persist the returned complete authorization.
 */
export function __AuthorizeGovernedChildRunSpawn(parent: GovernedChildRunParent, request: GovernedChildRunSpawnRequest, existingChildCount: number, policy: GovernedChildRunPolicy, delegation: GovernedChildRunCapabilityDelegation): GovernedChildRunSpawnAuthorizationResult
{
	// 1. Validate caller-controlled bounds before examining authority so malformed requests cannot widen a read.
	const normalizedRequest = _normalizeRequest(request);
	if (normalizedRequest === null || !_isRequestValid(parent, normalizedRequest, existingChildCount, policy)) return { outcome: "denied", reason: "invalid_request" };
	// 2. Keep a run tree inside one silo; cross-silo execution needs an explicit external adapter, not a child edge.
	if (parent.siloId !== normalizedRequest.siloId) return { outcome: "denied", reason: "cross_silo" };
	// 3. Bound recursion and direct fan-out before a durable child can consume capacity.
	if (parent.depth >= policy.maximumDepth) return { outcome: "denied", reason: "depth_exceeded" };
	if (existingChildCount >= policy.maximumChildrenPerParent) return { outcome: "denied", reason: "fanout_exceeded" };
	// 4. Require a proof that the requested child capability set is a legal delegation.
	if (!delegation.allows(parent.snapshot.capabilitySetDigest, normalizedRequest.agentServiceId, normalizedRequest.capabilitySetDigest)) return { outcome: "denied", reason: "capability_escalation" };
	// 5. Preserve sibling isolation by allowing only context coordinates the parent snapshot contains.
	if (!_isContextSubset(parent, normalizedRequest)) return { outcome: "denied", reason: "context_not_parent_readable" };
	// 6. Carve finite child limits from the parent's remaining budget before durable admission accounts for them.
	if (!_fitsBudget(normalizedRequest.budget, parent.remainingBudget)) return { outcome: "denied", reason: "budget_exceeded" };
	return { outcome: "authorized", authorization: { siloId: parent.siloId, rootRunId: parent.rootRunId, parentRunId: parent.runId, depth: parent.depth + 1, context: normalizedRequest.context, budget: normalizedRequest.budget, agentServiceId: normalizedRequest.agentServiceId, capabilitySetDigest: normalizedRequest.capabilitySetDigest, task: normalizedRequest.task } };
}

/** Deep-copies only structurally valid request data so the authorization cannot alias a caller's objects. */
function _normalizeRequest(value: unknown): GovernedChildRunSpawnRequest | null
{
	if (!_isRecord(value) || typeof value.siloId !== "string" || typeof value.agentServiceId !== "string" || typeof value.capabilitySetDigest !== "string" || !_isRecord(value.context) || !_isRecord(value.budget)) return null;
	const context = value.context;
	const budget = value.budget;
	if (!_isStringArray(context.messageIds) || !_isStringArray(context.memoryFactIds) || !_isStringArray(context.artifactRevisionIds) || !_isStringArray(context.skillRevisionIds) || !_isBudgetShape(budget)) return null;
	try
	{
		return {
			siloId: value.siloId,
			agentServiceId: value.agentServiceId,
			capabilitySetDigest: value.capabilitySetDigest,
			context: { messageIds: [...context.messageIds], memoryFactIds: [...context.memoryFactIds], artifactRevisionIds: [...context.artifactRevisionIds], skillRevisionIds: [...context.skillRevisionIds] },
			budget: { maxTotalTokens: budget.maxTotalTokens, maxCostUsdMicros: budget.maxCostUsdMicros, maxToolInvocations: budget.maxToolInvocations },
			task: ___CloneCanonicalJson(value.task as JsonValue),
		};
	}
	catch
	{
		return null;
	}
}

/** Returns whether one unknown value is a non-null object with string-addressable fields. */
function _isRecord(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Returns whether one unknown value is an array whose every item is a string. */
function _isStringArray(value: unknown): value is string[]
{
	return Array.isArray(value) && value.every(function _isString(item) { return typeof item === "string"; });
}

/** Returns whether a plain object contains the three budget fields with their expected primitive shapes. */
function _isBudgetShape(value: Record<string, unknown>): value is Record<keyof GovernedChildRunBudget, number | null>
{
	return _isLimitShape(value.maxTotalTokens) && _isLimitShape(value.maxCostUsdMicros) && _isLimitShape(value.maxToolInvocations);
}

/** Returns whether one unknown budget field is explicitly null or a number for later range validation. */
function _isLimitShape(value: unknown): value is number | null
{
	return value === null || typeof value === "number";
}

/** Returns whether the request and policy contain finite non-negative coordinates. */
function _isRequestValid(parent: GovernedChildRunParent, request: GovernedChildRunSpawnRequest, existingChildCount: number, policy: GovernedChildRunPolicy): boolean
{
	return parent.runId.trim().length > 0 && parent.rootRunId.trim().length > 0 && parent.siloId.trim().length > 0
		&& parent.snapshot.runId === parent.runId && parent.snapshot.siloId === parent.siloId
		&& Number.isSafeInteger(parent.depth) && parent.depth >= 0 && request.siloId.trim().length > 0
		&& request.agentServiceId.trim().length > 0 && request.capabilitySetDigest.trim().length > 0
		&& Number.isSafeInteger(existingChildCount) && existingChildCount >= 0
		&& Number.isSafeInteger(policy.maximumDepth) && policy.maximumDepth >= 0
		&& Number.isSafeInteger(policy.maximumChildrenPerParent) && policy.maximumChildrenPerParent >= 0
		&& _isBudgetValid(request.budget) && _isBudgetValid(parent.remainingBudget);
}

/** Returns whether each proposed context coordinate was already included in the parent's frozen snapshot. */
function _isContextSubset(parent: GovernedChildRunParent, request: GovernedChildRunSpawnRequest): boolean
{
	const parentMessages = new Set(parent.snapshot.messageIds);
	const parentMemoryFacts = new Set(parent.snapshot.memoryFacts.map(function _factId(fact) { return fact.factId; }));
	return _containsOnly(parentMessages, request.context.messageIds)
		&& _containsOnly(parentMemoryFacts, request.context.memoryFactIds)
		&& _containsOnly(new Set(parent.snapshot.artifactRevisionIds), request.context.artifactRevisionIds)
		&& _containsOnly(new Set(parent.snapshot.skillRevisionIds), request.context.skillRevisionIds);
}

/** Returns whether every selected identifier is non-empty and present in the parent-owned set. */
function _containsOnly(allowed: ReadonlySet<string>, selected: readonly string[]): boolean
{
	return selected.every(function _isAllowed(id) { return id.trim().length > 0 && allowed.has(id); });
}

/** Returns whether a budget uses only finite non-negative integer limits or an explicit unlimited null. */
function _isBudgetValid(budget: GovernedChildRunBudget): boolean
{
	return _isLimitValid(budget.maxTotalTokens) && _isLimitValid(budget.maxCostUsdMicros) && _isLimitValid(budget.maxToolInvocations);
}

/** Returns whether one optional numeric limit is representable without coercion. */
function _isLimitValid(value: number | null): boolean
{
	return value === null || (Number.isSafeInteger(value) && value >= 0);
}

/** Returns whether every finite child limit fits in its corresponding finite parent allowance. */
function _fitsBudget(child: GovernedChildRunBudget, parent: GovernedChildRunBudget): boolean
{
	return _fitsLimit(child.maxTotalTokens, parent.maxTotalTokens) && _fitsLimit(child.maxCostUsdMicros, parent.maxCostUsdMicros) && _fitsLimit(child.maxToolInvocations, parent.maxToolInvocations);
}

/** Returns whether a child either stays bounded by its parent or both explicitly retain no ceiling. */
function _fitsLimit(child: number | null, parent: number | null): boolean
{
	return parent === null ? true : child !== null && child <= parent;
}
