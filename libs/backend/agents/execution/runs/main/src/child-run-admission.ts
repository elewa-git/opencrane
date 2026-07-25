import { ___CloneCanonicalJson } from "@opencrane/util";
import type { JsonValue } from "@opencrane/util";

import type { GovernedChildRunBudget, GovernedChildRunCapabilityDelegation, GovernedChildRunContextSelection, GovernedChildRunParent, GovernedChildRunPolicy, GovernedChildRunSpawnAuthorizationResult, GovernedChildRunSpawnRequest } from "./child-run-admission.types.js";

/**
 * Authorizes one governed child-run request against a frozen parent snapshot.
 *
 * The caller supplies parent facts that a later repository must load and lock in one transaction,
 * the direct-child count, and a verifier-produced capability-delegation authority. This function
 * never accepts sibling context, expands a capability set, or mutates the parent. Its output is a
 * detached authorization for the subsequent reservation-and-persistence transaction.
 */
export function __AuthorizeGovernedChildRunSpawn(parent: GovernedChildRunParent, request: GovernedChildRunSpawnRequest, existingChildCount: number, policy: GovernedChildRunPolicy, delegation: GovernedChildRunCapabilityDelegation): GovernedChildRunSpawnAuthorizationResult
{
	// 1. Normalize untrusted candidate data before examining parent authority so malformed objects cannot alias it.
	const normalized = _NormalizeRequest(request);
	if (normalized === null || !_IsRequestValid(parent, normalized, existingChildCount, policy)) return { outcome: "denied", reason: "invalid_request" };

	// 2. Keep the complete lineage and all selected durable context inside the parent's exact silo.
	if (parent.siloId !== normalized.siloId) return { outcome: "denied", reason: "cross_silo" };

	// 3. Bound recursive work and direct fan-out before the later transaction reserves capacity.
	if (parent.depth >= policy.maximumDepth) return { outcome: "denied", reason: "depth_exceeded" };
	if (existingChildCount >= policy.maximumChildrenPerParent) return { outcome: "denied", reason: "fanout_exceeded" };

	// 4. Let only an independent capability authority prove a narrowing delegation to the target service.
	if (!delegation.allows(parent.snapshot.capabilitySetDigest, normalized.agentServiceId, normalized.capabilitySetDigest)) return { outcome: "denied", reason: "capability_escalation" };

	// 5. Preserve sibling isolation by copying only coordinates already pinned into the parent's snapshot.
	if (!_IsParentReadableContext(parent, normalized.context)) return { outcome: "denied", reason: "context_not_parent_readable" };

	// 6. Carve finite resources before durable reservation so a child cannot overdraw its parent.
	if (!_FitsBudget(normalized.budget, parent.remainingBudget)) return { outcome: "denied", reason: "budget_exceeded" };

	return { outcome: "authorized", authorization: { siloId: parent.siloId, rootRunId: parent.rootRunId, parentRunId: parent.runId, depth: parent.depth + 1, capabilitySetDigest: normalized.capabilitySetDigest, agentServiceId: normalized.agentServiceId, context: normalized.context, budget: normalized.budget, task: normalized.task } };
}

/** Produces a detached candidate request only when every caller-controlled field has the closed shape. */
function _NormalizeRequest(value: unknown): GovernedChildRunSpawnRequest | null
{
	if (!_IsRecord(value) || typeof value.siloId !== "string" || typeof value.agentServiceId !== "string" || typeof value.capabilitySetDigest !== "string" || !_IsRecord(value.context) || !_IsRecord(value.budget)) return null;
	const context = _Context(value.context);
	const budget = _Budget(value.budget);
	if (context === null || budget === null) return null;
	try
	{
		return { siloId: value.siloId, agentServiceId: value.agentServiceId, capabilitySetDigest: value.capabilitySetDigest, context, budget, task: ___CloneCanonicalJson(value.task as JsonValue) };
	}
	catch
	{
		return null;
	}
}

/** Returns one context selection after validating its four immutable identifier lists. */
function _Context(value: Record<string, unknown>): GovernedChildRunContextSelection | null
{
	if (!_IsStringArray(value.messageIds) || !_IsStringArray(value.memoryFactIds) || !_IsStringArray(value.artifactRevisionIds) || !_IsStringArray(value.skillRevisionIds)) return null;
	return { messageIds: [...value.messageIds], memoryFactIds: [...value.memoryFactIds], artifactRevisionIds: [...value.artifactRevisionIds], skillRevisionIds: [...value.skillRevisionIds] };
}

/** Returns one finite budget carve-out after validating its primitive fields. */
function _Budget(value: Record<string, unknown>): GovernedChildRunBudget | null
{
	return _IsPositiveInteger(value.maxModelTurns) && _IsPositiveInteger(value.maxTotalTokens) && _IsPositiveInteger(value.maxDurationMs) ? { maxModelTurns: value.maxModelTurns, maxTotalTokens: value.maxTotalTokens, maxDurationMs: value.maxDurationMs } : null;
}

/** Returns whether a request is structurally consistent with one loaded parent and bounded policy. */
function _IsRequestValid(parent: GovernedChildRunParent, request: GovernedChildRunSpawnRequest, existingChildCount: number, policy: GovernedChildRunPolicy): boolean
{
	return _Present(parent.runId) && _Present(parent.rootRunId) && _Present(parent.siloId)
		&& parent.snapshot.runId === parent.runId && parent.snapshot.siloId === parent.siloId
		&& Number.isSafeInteger(parent.depth) && parent.depth >= 0
		&& _Present(request.siloId) && _Present(request.agentServiceId) && /^sha256:[0-9a-f]{64}$/u.test(request.capabilitySetDigest)
		&& Number.isSafeInteger(existingChildCount) && existingChildCount >= 0
		&& Number.isSafeInteger(policy.maximumDepth) && policy.maximumDepth >= 0
		&& Number.isSafeInteger(policy.maximumChildrenPerParent) && policy.maximumChildrenPerParent >= 0
		&& _IsBudgetValid(parent.remainingBudget) && _IsBudgetValid(request.budget);
}

/** Returns whether every selected identifier is unique, non-empty, and already frozen in the parent snapshot. */
function _IsParentReadableContext(parent: GovernedChildRunParent, context: GovernedChildRunContextSelection): boolean
{
	return _Subset(new Set(parent.snapshot.messageIds), context.messageIds)
		&& _Subset(new Set(parent.snapshot.memoryFacts.map(function _FactId(fact): string { return fact.factId; })), context.memoryFactIds)
		&& _Subset(new Set(parent.snapshot.artifactRevisionIds), context.artifactRevisionIds)
		&& _Subset(new Set(parent.snapshot.skillRevisionIds), context.skillRevisionIds);
}

/** Returns whether the selected identifiers are unique non-empty members of their immutable allowed set. */
function _Subset(allowed: ReadonlySet<string>, selected: readonly string[]): boolean
{
	return selected.every(_Present) && new Set(selected).size === selected.length && selected.every(function _Allowed(value): boolean { return allowed.has(value); });
}

/** Returns whether a child uses only finite capacity contained by its parent's remaining allocation. */
function _FitsBudget(child: GovernedChildRunBudget, parent: GovernedChildRunBudget): boolean
{
	return child.maxModelTurns <= parent.maxModelTurns && child.maxTotalTokens <= parent.maxTotalTokens && child.maxDurationMs <= parent.maxDurationMs;
}

/** Returns whether one budget contains only positive safe-integer capacity. */
function _IsBudgetValid(value: GovernedChildRunBudget): boolean
{
	return _IsPositiveInteger(value.maxModelTurns) && _IsPositiveInteger(value.maxTotalTokens) && _IsPositiveInteger(value.maxDurationMs);
}

/** Returns whether one unknown value is a JSON record rather than null or an array. */
function _IsRecord(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Returns whether every item is a string. */
function _IsStringArray(value: unknown): value is string[]
{
	return Array.isArray(value) && value.every(function _String(item): boolean { return typeof item === "string"; });
}

/** Returns whether a value is positive finite resource capacity. */
function _IsPositiveInteger(value: unknown): value is number
{
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Returns whether an identifier contains a non-whitespace value. */
function _Present(value: string): boolean
{
	return value.trim().length > 0;
}
