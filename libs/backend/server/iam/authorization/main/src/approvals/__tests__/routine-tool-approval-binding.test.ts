import { AgentRunTriggers, RUN_INPUT_SNAPSHOT_VERSION } from "@opencrane/contracts";
import { describe, expect, it } from "vitest";

import { _ResolveRoutineToolApprovalBinding } from "../routine-tool-approval-binding";
import type { RoutineToolApprovalBindingSource } from "../routine-tool-approval-binding.types";

/** Routine approval time frozen into the aggregate and snapshot. */
const _AUTHENTICATED_AT = new Date("2026-09-01T08:00:00.000Z");

/** Automatic occurrence slot frozen into the firing, run and snapshot. */
const _SCHEDULED_SLOT = new Date("2026-09-25T10:00:00.000Z");

/** Builds complete server-owned scheduled occurrence evidence. */
function _scheduledSource(): RoutineToolApprovalBindingSource
{
	return {
		invocation: { siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "agent-revision-1" },
		run: { id: "run-1", siloId: "silo-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "agent-revision-1", conversationId: "conversation-1", trigger: AgentRunTriggers.Scheduled, routineFiringId: "firing-1", routineId: "routine-1", routineRevision: 3, routineScheduledSlot: _SCHEDULED_SLOT, inputSnapshotDigest: "sha256:snapshot" },
		snapshot: {
			runId: "run-1", attempt: 1, snapshotVersion: RUN_INPUT_SNAPSHOT_VERSION, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "agent-revision-1", conversationId: "conversation-1", digest: "sha256:snapshot",
			origin: { kind: AgentRunTriggers.Scheduled, routineId: "routine-1", routineRevision: 3, firingId: "firing-1", scheduledSlot: _SCHEDULED_SLOT.toISOString(), requesterPrincipalId: "requester-1", requesterIssuer: "https://issuer.example", requesterSubjectId: "subject-1", requesterAuthenticatedAt: _AUTHENTICATED_AT.toISOString(), workflowTaskId: "task-1", workflowTaskName: "routine-occurrence", workflowTaskKey: "firing-1" },
		},
		firing: {
			id: "firing-1", siloId: "silo-1", routineId: "routine-1", routineRevision: 3, trigger: AgentRunTriggers.Scheduled, scheduledSlot: _SCHEDULED_SLOT, requesterPrincipalId: "requester-1", conversationId: "conversation-1", runId: "run-1", workflowTaskId: "task-1", workflowTaskName: "routine-occurrence", workflowTaskKey: "firing-1",
			routine: { id: "routine-1", siloId: "silo-1", originalRequesterPrincipalId: "requester-1", requesterIssuer: "https://issuer.example", requesterSubjectId: "subject-1", requesterAuthenticatedAt: _AUTHENTICATED_AT, selectedManagedServiceId: "service-1" },
		},
	};
}

describe("routine tool approval binding", function _Suite()
{
	it("derives exact routine and requester coordinates from scheduled server evidence", function _Scheduled()
	{
		expect(_ResolveRoutineToolApprovalBinding(_scheduledSource())).toEqual({ routineId: "routine-1", routineRevision: 3, routineRequesterPrincipalId: "requester-1", routineRequesterSubjectId: "subject-1" });
	});

	it("accepts manual evidence only when every saved slot is null", function _Manual()
	{
		const source = _scheduledSource();
		const origin = { ...(source.snapshot.origin as Readonly<Record<string, unknown>>), kind: AgentRunTriggers.Manual, scheduledSlot: null };
		const manual: RoutineToolApprovalBindingSource = {
			...source,
			run: { ...source.run, trigger: AgentRunTriggers.Manual, routineScheduledSlot: null },
			snapshot: { ...source.snapshot, origin },
			firing: { ...source.firing!, trigger: AgentRunTriggers.Manual as const, scheduledSlot: null },
		};
		expect(_ResolveRoutineToolApprovalBinding(manual)).toMatchObject({ routineId: "routine-1", routineRevision: 3 });
	});

	it("keeps interactive consent separate with null routine coordinates", function _Interactive()
	{
		const source = _scheduledSource();
		const interactive = {
			...source,
			run: { ...source.run, trigger: AgentRunTriggers.Interactive, routineFiringId: null, routineId: null, routineRevision: null, routineScheduledSlot: null },
			snapshot: { ...source.snapshot, origin: { kind: AgentRunTriggers.Interactive, messageId: "message-1", historyRevision: "17" } },
			firing: null,
		};
		expect(_ResolveRoutineToolApprovalBinding(interactive)).toEqual({ routineId: null, routineRevision: null, routineRequesterPrincipalId: null, routineRequesterSubjectId: null });
	});

	it.each([
		function _RunRoutine(source: RoutineToolApprovalBindingSource) { return { ...source, run: { ...source.run, routineId: "routine-2" } }; },
		function _RunRevision(source: RoutineToolApprovalBindingSource) { return { ...source, run: { ...source.run, routineRevision: 4 } }; },
		function _OriginRoutine(source: RoutineToolApprovalBindingSource) { return { ...source, snapshot: { ...source.snapshot, origin: { ...(source.snapshot.origin as object), routineId: "routine-2" } } }; },
		function _OriginRevision(source: RoutineToolApprovalBindingSource) { return { ...source, snapshot: { ...source.snapshot, origin: { ...(source.snapshot.origin as object), routineRevision: 4 } } }; },
		function _FiringRun(source: RoutineToolApprovalBindingSource) { return { ...source, firing: { ...source.firing!, runId: "run-2" } }; },
		function _Requester(source: RoutineToolApprovalBindingSource) { return { ...source, firing: { ...source.firing!, requesterPrincipalId: "requester-2" } }; },
		function _WorkflowTask(source: RoutineToolApprovalBindingSource) { return { ...source, firing: { ...source.firing!, workflowTaskId: "task-2" } }; },
	])("rejects cross-routine, revision, run and requester mismatches", function _Mismatch(mutate)
	{
		expect(_ResolveRoutineToolApprovalBinding(mutate(_scheduledSource()))).toBeNull();
	});

	it.each([
		function _Version(source: RoutineToolApprovalBindingSource) { return { ...source, snapshot: { ...source.snapshot, snapshotVersion: RUN_INPUT_SNAPSHOT_VERSION - 1 } }; },
		function _Digest(source: RoutineToolApprovalBindingSource) { return { ...source, snapshot: { ...source.snapshot, digest: "sha256:other" } }; },
		function _ExtendedOrigin(source: RoutineToolApprovalBindingSource) { return { ...source, snapshot: { ...source.snapshot, origin: { ...(source.snapshot.origin as object), routineOverride: true } } }; },
		function _MissingFiring(source: RoutineToolApprovalBindingSource) { return { ...source, firing: null }; },
		function _NoncanonicalSlot(source: RoutineToolApprovalBindingSource) { return { ...source, snapshot: { ...source.snapshot, origin: { ...(source.snapshot.origin as object), scheduledSlot: "2026-09-25T10:00:00Z" } } }; },
		function _MissingWorkflowTask(source: RoutineToolApprovalBindingSource) { const { workflowTaskId: _, ...origin } = source.snapshot.origin as Readonly<Record<string, unknown>>; return { ...source, snapshot: { ...source.snapshot, origin } }; },
	])("fails closed for missing or corrupt provenance", function _Corrupt(mutate)
	{
		expect(_ResolveRoutineToolApprovalBinding(mutate(_scheduledSource()))).toBeNull();
	});
});
