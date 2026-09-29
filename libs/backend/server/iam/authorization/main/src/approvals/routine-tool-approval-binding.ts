import { AgentRunTriggers, RUN_INPUT_SNAPSHOT_VERSION, ___RunInputOriginSchema, type RoutineRunInputOrigin } from "@opencrane/contracts";

import type { RoutineToolApprovalBinding, RoutineToolApprovalBindingSource } from "./routine-tool-approval-binding.types";

/** Returns the canonical ISO instant stored by a nullable database timestamp. */
function _instant(value: Date | null): string | null
{
	return value === null ? null : value.toISOString();
}

/** Verifies invocation, run and snapshot identity before trigger-specific checks. */
function _matchesRunSnapshot(source: RoutineToolApprovalBindingSource): boolean
{
	const { invocation, run, snapshot } = source;
	return invocation.runId === run.id && invocation.siloId === run.siloId && invocation.attempt === run.attempt
		&& invocation.agentServiceId === run.agentServiceId && invocation.agentRevisionId === run.agentRevisionId
		&& snapshot.runId === run.id && snapshot.attempt === run.attempt && snapshot.snapshotVersion === RUN_INPUT_SNAPSHOT_VERSION
		&& snapshot.siloId === run.siloId && snapshot.agentServiceId === run.agentServiceId && snapshot.agentRevisionId === run.agentRevisionId
		&& snapshot.conversationId === run.conversationId && snapshot.digest === run.inputSnapshotDigest;
}

/** Verifies the complete interactive origin and absence of every routine coordinate. */
function _interactiveBinding(source: RoutineToolApprovalBindingSource): RoutineToolApprovalBinding | null
{
	const { run } = source;
	if (source.firing !== null || run.routineFiringId !== null || run.routineId !== null || run.routineRevision !== null || run.routineScheduledSlot !== null)
		return null;
	return { routineId: null, routineRevision: null, routineRequesterPrincipalId: null, routineRequesterSubjectId: null };
}

/** Verifies the routine, firing and snapshot copies of one occurrence. */
function _routineBinding(source: RoutineToolApprovalBindingSource, origin: RoutineRunInputOrigin): RoutineToolApprovalBinding | null
{
	const { run, firing } = source;
	if (firing === null)
		return null;
	const scheduledSlot = origin.scheduledSlot;
	const routine = firing.routine;
	return run.trigger === origin.kind && firing.trigger === origin.kind
		&& run.routineFiringId === firing.id && run.routineId === firing.routineId && run.routineRevision === firing.routineRevision
		&& run.conversationId === firing.conversationId && firing.runId === run.id
		&& _instant(run.routineScheduledSlot) === scheduledSlot && _instant(firing.scheduledSlot) === scheduledSlot
		&& firing.siloId === run.siloId && routine.siloId === run.siloId && routine.id === firing.routineId
		&& routine.selectedManagedServiceId === run.agentServiceId
		&& origin.routineId === firing.routineId && origin.routineRevision === firing.routineRevision && origin.firingId === firing.id
		&& origin.requesterPrincipalId === firing.requesterPrincipalId && origin.requesterPrincipalId === routine.originalRequesterPrincipalId
		&& origin.requesterIssuer === routine.requesterIssuer && origin.requesterSubjectId === routine.requesterSubjectId
		&& origin.requesterAuthenticatedAt === routine.requesterAuthenticatedAt.toISOString()
		&& origin.workflowTaskId === firing.workflowTaskId && origin.workflowTaskName === firing.workflowTaskName && origin.workflowTaskKey === firing.workflowTaskKey
		&& ((origin.kind === AgentRunTriggers.Scheduled) === (scheduledSlot !== null))
		? { routineId: firing.routineId, routineRevision: firing.routineRevision, routineRequesterPrincipalId: routine.originalRequesterPrincipalId, routineRequesterSubjectId: routine.requesterSubjectId }
		: null;
}

/**
 * Derives standing-approval routine coordinates from saved invocation, run and occurrence evidence.
 *
 * The caller must load all rows in its current transaction. Missing, partial, extended or mismatched
 * provenance returns null, so no request field can mint or redirect a routine-scoped approval.
 *
 * @param source - Server-owned rows linked from the tool invocation.
 * @returns Exact routine coordinates and requester, interactive null coordinates, or null on mismatch.
 */
export function _ResolveRoutineToolApprovalBinding(source: RoutineToolApprovalBindingSource): RoutineToolApprovalBinding | null
{
	if (!_matchesRunSnapshot(source))
		return null;
	const parsed = ___RunInputOriginSchema.safeParse(source.snapshot.origin);
	if (!parsed.success)
		return null;
	const origin = parsed.data;
	if (source.run.trigger === AgentRunTriggers.Interactive)
		return origin.kind === AgentRunTriggers.Interactive ? _interactiveBinding(source) : null;
	if (origin.kind === AgentRunTriggers.Interactive)
		return null;
	return _routineBinding(source, origin);
}

/** Checks that a routine occurrence still names the requester who approved the original routine. */
export function _MatchesRoutineRequester(binding: RoutineToolApprovalBinding, requesterPrincipalId: string, requesterSubjectId: string): boolean
{
	return binding.routineId === null
		|| (binding.routineRequesterPrincipalId === requesterPrincipalId && binding.routineRequesterSubjectId === requesterSubjectId);
}
