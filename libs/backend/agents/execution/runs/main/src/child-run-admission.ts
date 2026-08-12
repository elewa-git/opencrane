import type { ChildRunAdmissionLimits, ChildRunParentAuthority, ChildRunTargetAuthorization, PrepareChildRunAdmissionCommand, PrepareChildRunAdmissionResult } from "./child-run-admission.types.js";

/**
 * Works out whether a parent run may spawn this child, and with what budget.
 *
 * Pure decision only — nothing is written. Every value comes from the parent's own facts and the
 * server's limits, never from the spawning tool's arguments, which is what stops an agent from
 * asking for a deeper tree, a bigger budget, or a subject it does not have.
 *
 * Called by: `prisma-child-run-reservation-repository.ts`, which calls it again inside the
 * transaction that reserves the budget, so a policy change cannot race the durable admission.
 *
 * @param parent - The parent's lineage, subject and remaining budget, already loaded.
 * @param command - The requested child id, target service, target revision and budget.
 * @param limits - Server-owned depth and fan-out limits.
 * @param targetAuthorization - Policy re-checked here rather than trusted from earlier.
 * @returns `prepared` with the values the persistence layer must write through unchanged.
 * `denied` names which rule stopped it: a malformed request, a limit, an exhausted parent budget,
 * or a target the parent may not invoke — `target_authorization_unavailable` differs from
 * `target_not_authorized` in that the policy could not be consulted at all, so it may be retried.
 */
export async function __PrepareChildRunAdmission(parent: ChildRunParentAuthority, command: PrepareChildRunAdmissionCommand, limits: ChildRunAdmissionLimits, targetAuthorization: ChildRunTargetAuthorization): Promise<PrepareChildRunAdmissionResult>
{
	// 1. Reject malformed parent authority separately, so callers cannot mistake it for a bad child request.
	if (!_IsValidParent(parent)) return { outcome: "denied", reason: "invalid_parent_authority" };
	if (!_IsValidCommand(command) || !_IsValidLimits(limits)) return { outcome: "denied", reason: "invalid_command" };

	// 2. Enforce tree bounds here so no child can bypass the parent-brokered fan-out or recursive depth limits.
	if (parent.depth >= limits.maximumDepth) return { outcome: "denied", reason: "depth_exceeded" };
	if (parent.admittedChildCount >= limits.maximumChildrenPerParent) return { outcome: "denied", reason: "fanout_exceeded" };

	// 3. Carve budget before persistence; a child may never reserve more than its parent still controls.
	if (command.requestedBudget.maxTokens > parent.remainingTokens || command.requestedBudget.maxCostUsdMicros > parent.remainingCostUsdMicros) return { outcome: "denied", reason: "budget_exceeded" };

	// 4. Recheck the exact target rather than trusting an agent-provided service or revision identifier.
	try
	{
		if ((await targetAuthorization.authorize(parent, command)).outcome === "denied") return { outcome: "denied", reason: "target_not_authorized" };
	}
	catch
	{
		return { outcome: "denied", reason: "target_authorization_unavailable" };
	}

	return { outcome: "prepared", value: { depth: parent.depth + 1, runId: command.childRunId, parentRunId: parent.runId, rootRunId: parent.rootRunId, siloId: parent.siloId, executionSubjectId: parent.executionSubjectId, agentServiceId: command.targetAgentServiceId, agentRevisionId: command.targetAgentRevisionId, trigger: "managed_invocation", budget: command.requestedBudget } };
}

/** Returns whether parent facts are complete and safe for a child to inherit. */
function _IsValidParent(parent: ChildRunParentAuthority): boolean
{
	return parent.runId.trim().length > 0 && parent.siloId.trim().length > 0 && parent.rootRunId.trim().length > 0 && parent.executionSubjectId.trim().length > 0 && Number.isSafeInteger(parent.depth) && parent.depth >= 0 && Number.isSafeInteger(parent.admittedChildCount) && parent.admittedChildCount >= 0 && Number.isSafeInteger(parent.remainingTokens) && parent.remainingTokens >= 0 && Number.isSafeInteger(parent.remainingCostUsdMicros) && parent.remainingCostUsdMicros >= 0;
}

/** Returns whether the requested child identity and budget are complete positive values. */
function _IsValidCommand(command: PrepareChildRunAdmissionCommand): boolean
{
	return command.childRunId.trim().length > 0 && command.targetAgentServiceId.trim().length > 0 && command.targetAgentRevisionId.trim().length > 0 && Number.isSafeInteger(command.requestedBudget.maxTokens) && command.requestedBudget.maxTokens > 0 && Number.isSafeInteger(command.requestedBudget.maxCostUsdMicros) && command.requestedBudget.maxCostUsdMicros > 0;
}

/** Returns whether server-owned tree limits are finite non-negative values. */
function _IsValidLimits(limits: ChildRunAdmissionLimits): boolean
{
	return Number.isSafeInteger(limits.maximumDepth) && limits.maximumDepth >= 0 && Number.isSafeInteger(limits.maximumChildrenPerParent) && limits.maximumChildrenPerParent >= 0;
}
