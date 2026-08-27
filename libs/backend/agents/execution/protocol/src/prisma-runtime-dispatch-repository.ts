import { createHash } from "node:crypto";

import { AgentRunState as PrismaAgentRunState, Prisma, RuntimeSteeringRequestState, WorkloadAssignmentState, WorkloadKind } from "@prisma/client";

import { AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, MANAGED_AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, RunInputSnapshotIdentityKinds, WARM_RUNTIME_SERVICE_ACCOUNT_NAME, ___IsAgentRuntimeServiceAccountName, ___IsManagedAgentRuntimeServiceAccountName, type RuntimeAssignmentIdentity } from "@opencrane/contracts";

import { __ProjectRuntimeInputSnapshot } from "./runtime-input-snapshot-projector";
import type { RuntimeDispatchAuthorityConfig, RuntimeDispatchContext, RuntimeStreamBindingRepository, RuntimeStreamWorkloadIdentity } from "./prisma-runtime-dispatch-authority.types";
import type { RuntimeAdmissionRunState } from "./runtime-protocol-authority.types";

/** Owns every typed Prisma delegate used by runtime dispatch. */
export class PrismaRuntimeDispatchRepository implements RuntimeStreamBindingRepository
{
	/** Dispatch transaction that owns all reads and writes. */
	private readonly prisma: Prisma.TransactionClient;

	/** Creates the runtime dispatch repository inside one transaction. */
	constructor(prisma: Prisma.TransactionClient)
	{
		this.prisma = prisma;
	}

	/** Binds an empty stream, keeps the same owner, or rejects a competing runtime instance. */
	async bind(context: { readonly runId: string; readonly attempt: number }, runtimeInstanceId: string): Promise<string | null>
	{
		const existing = await this.prisma.runtimeCommandStream.findUnique({ where: { runId_attempt: { runId: context.runId, attempt: context.attempt } } });
		if (existing === null)
		{
			const created = await this.prisma.runtimeCommandStream.createMany({ data: [{ runId: context.runId, attempt: context.attempt, runtimeInstanceId }], skipDuplicates: true });
			if (created.count === 1)
				return runtimeInstanceId;
			const winner = await this.prisma.runtimeCommandStream.findUnique({ where: { runId_attempt: { runId: context.runId, attempt: context.attempt } } });
			return winner?.runtimeInstanceId === runtimeInstanceId ? runtimeInstanceId : null;
		}
		if (existing.runtimeInstanceId === null)
		{
			const bound = await this.prisma.runtimeCommandStream.updateMany({ where: { runId: context.runId, attempt: context.attempt, runtimeInstanceId: null }, data: { runtimeInstanceId } });
			if (bound.count === 1)
				return runtimeInstanceId;
			const winner = await this.prisma.runtimeCommandStream.findUnique({ where: { runId_attempt: { runId: context.runId, attempt: context.attempt } } });
			return winner?.runtimeInstanceId === runtimeInstanceId ? runtimeInstanceId : null;
		}
		return existing.runtimeInstanceId === runtimeInstanceId ? runtimeInstanceId : null;
	}

	/** Loads one command-stream row for a run attempt. */
	readStream(runId: string, attempt: number)
	{
		return this.prisma.runtimeCommandStream.findUnique({ where: { runId_attempt: { runId, attempt } } });
	}

	/** Loads every command in stable sequence order. */
	readCommands(runId: string, attempt: number)
	{
		return this.prisma.runtimeDispatchedCommand.findMany({ where: { runId, attempt }, orderBy: { sequence: "asc" } });
	}

	/** Saves one admitted command. */
	saveCommand(data: Prisma.RuntimeDispatchedCommandUncheckedCreateInput)
	{
		return this.prisma.runtimeDispatchedCommand.create({ data });
	}

	/** Advances the exact command sequence fence. */
	advanceCommand(runId: string, attempt: number, expectedSequence: number, nextSequence: number)
	{
		return this.prisma.runtimeCommandStream.updateMany({ where: { runId, attempt, nextCommandSequence: expectedSequence }, data: { nextCommandSequence: nextSequence } });
	}

	/** Marks steering requests delivered by a saved resume command. */
	consumeSteeringRequests(ids: readonly string[], consumedAt: Date)
	{
		return this.prisma.runtimeSteeringRequest.updateMany({ where: { id: { in: [...ids] }, state: RuntimeSteeringRequestState.Pending }, data: { state: RuntimeSteeringRequestState.Consumed, consumedAt } });
	}

	/** Appends one accepted candidate id under the command sequence fence. */
	appendCandidate(runId: string, attempt: number, nextCommandSequence: number, candidateId: string)
	{
		return this.prisma.runtimeCommandStream.updateMany({ where: { runId, attempt, nextCommandSequence }, data: { acceptedCandidateIds: { push: candidateId } } });
	}

	/** Releases the named runtime instance when it still owns the stream. */
	release(runId: string, attempt: number, runtimeInstanceId: string)
	{
		return this.prisma.runtimeCommandStream.updateMany({ where: { runId, attempt, runtimeInstanceId }, data: { runtimeInstanceId: null } });
	}

	/** Loads and validates the assignment, run, and snapshot for one reviewed Pod identity. */
	async loadContext(config: RuntimeDispatchAuthorityConfig, identity: RuntimeStreamWorkloadIdentity): Promise<RuntimeDispatchContext | null>
	{
		const assignment = await this.prisma.workloadAssignment.findUnique({ where: { namespace_podUid: { namespace: identity.namespace, podUid: identity.podUid } } });
		if (assignment === null || assignment.podUid === null || assignment.state !== WorkloadAssignmentState.Registered || assignment.serviceAccountName !== identity.serviceAccountName)
			return null;
		const run = await this.prisma.agentRun.findUnique({ where: { id: assignment.runId } });
		if (run === null || run.attempt !== assignment.attempt || run.agentServiceId !== assignment.agentServiceId || run.agentRevisionId !== assignment.agentRevisionId || run.siloId !== assignment.siloId)
			return null;
		const snapshot = await this.prisma.runInputSnapshot.findUnique({ where: { runId_digest: { runId: run.id, digest: run.inputSnapshotDigest } } });
		if (snapshot === null)
			return null;
		const snapshotIdentity = _snapshotIdentity(snapshot.identitySnapshot);
		if (snapshotIdentity === null || assignment.subjectId !== snapshotIdentity.executionSubjectId || !_RuntimePlaneMatches(snapshotIdentity, assignment, config))
			return null;
		const assignmentDigest = _computeAssignmentDigest({ runId: assignment.runId, attempt: assignment.attempt, agentServiceId: assignment.agentServiceId, agentRevisionId: assignment.agentRevisionId, siloId: assignment.siloId, subjectId: assignment.subjectId, identity: snapshotIdentity, serviceAccountName: assignment.serviceAccountName, podUid: assignment.podUid, expiresAt: assignment.expiresAt, createdAt: assignment.createdAt });
		return {
			runId: assignment.runId,
			attempt: assignment.attempt,
			agentServiceId: assignment.agentServiceId,
			agentRevisionId: assignment.agentRevisionId,
			siloId: assignment.siloId,
			runState: _toAdmissionRunState(run.state),
			terminalReason: run.terminalReason,
			assignmentDigest,
			inputSnapshotDigest: run.inputSnapshotDigest,
			snapshot: __ProjectRuntimeInputSnapshot(snapshot),
			conversationId: snapshot.conversationId,
			personaRevisionId: snapshot.personaRevisionId,
			identity: snapshotIdentity,
			capabilitySetDigest: snapshot.capabilitySetDigest,
			serviceAccountName: assignment.serviceAccountName,
			workloadKind: assignment.workloadKind,
			podUid: assignment.podUid,
			leaseExpiresAtEpochMs: assignment.expiresAt.getTime(),
			assignmentIssuedAt: assignment.createdAt.toISOString(),
			assignmentExpiresAt: assignment.expiresAt.toISOString(),
		};
	}
}

/** Returns whether the assignment plane matches the snapshot identity. */
function _RuntimePlaneMatches(identity: RuntimeAssignmentIdentity, assignment: { namespace: string; audience: string; serviceAccountName: string; workloadKind: WorkloadKind }, config: RuntimeDispatchAuthorityConfig): boolean
{
	const warm = assignment.workloadKind === WorkloadKind.Deployment && assignment.serviceAccountName === WARM_RUNTIME_SERVICE_ACCOUNT_NAME;
	if (identity.kind === RunInputSnapshotIdentityKinds.Service)
	{
		return assignment.namespace === config.managedRuntimeNamespace
			&& assignment.audience === MANAGED_AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE
			&& (warm || (assignment.workloadKind === WorkloadKind.Job && ___IsManagedAgentRuntimeServiceAccountName(assignment.serviceAccountName)));
	}
	return assignment.namespace === config.personalRuntimeNamespace
		&& assignment.audience === AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE
		&& (warm || (assignment.workloadKind === WorkloadKind.Job && ___IsAgentRuntimeServiceAccountName(assignment.serviceAccountName)));
}

/** Maps a stored run state to the protocol vocabulary. */
function _toAdmissionRunState(state: PrismaAgentRunState): RuntimeAdmissionRunState
{
	switch (state)
	{
		case PrismaAgentRunState.Accepted: return "accepted";
		case PrismaAgentRunState.Queued: return "queued";
		case PrismaAgentRunState.Assigned: return "assigned";
		case PrismaAgentRunState.Running: return "running";
		case PrismaAgentRunState.WaitingForInput: return "waiting_for_input";
		case PrismaAgentRunState.Cancelling: return "cancelling";
		case PrismaAgentRunState.Completed: return "completed";
		case PrismaAgentRunState.Failed: return "failed";
		default: return "cancelled";
	}
}

/** Hashes the assignment identity fields in one fixed order. */
function _computeAssignmentDigest(context: { runId: string; attempt: number; agentServiceId: string; agentRevisionId: string; siloId: string; subjectId: string; identity: RuntimeAssignmentIdentity; serviceAccountName: string; podUid: string; expiresAt: Date; createdAt: Date }): string
{
	const canonical = JSON.stringify(["opencrane-runtime-assignment-digest-v2", context.runId, context.attempt, context.agentServiceId, context.agentRevisionId, context.siloId, context.subjectId, _CanonicalAssignmentIdentity(context.identity), context.serviceAccountName, context.podUid, context.expiresAt.toISOString(), context.createdAt.toISOString()]);
	return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

/** Puts identity fields in a fixed order before hashing. */
function _CanonicalAssignmentIdentity(identity: RuntimeAssignmentIdentity): readonly string[]
{
	if (identity.kind === RunInputSnapshotIdentityKinds.User)
		return [identity.kind, identity.executionSubjectId, String(identity.fleetMembershipRevision)];
	return [identity.kind, identity.executionSubjectId, identity.agentServiceId, String(identity.fleetMembershipRevision), identity.effectiveBoundaryAttachmentDigest];
}

/** Parses the execution identity stored in snapshot JSON. */
function _snapshotIdentity(value: unknown): RuntimeAssignmentIdentity | null
{
	if (!value || typeof value !== "object" || Array.isArray(value))
		return null;
	const identity = value as Record<string, unknown>;
	const kind = identity["kind"];
	const executionSubjectId = identity["executionSubjectId"];
	const fleetMembershipRevision = identity["fleetMembershipRevision"];
	if ((kind !== "user" && kind !== "service") || typeof executionSubjectId !== "string" || executionSubjectId.trim().length === 0 || typeof fleetMembershipRevision !== "number" || !Number.isSafeInteger(fleetMembershipRevision) || fleetMembershipRevision < 0)
		return null;
	if (kind === "user")
		return { kind, executionSubjectId, fleetMembershipRevision };
	const agentServiceId = identity["agentServiceId"];
	const effectiveBoundaryAttachmentDigest = identity["effectiveBoundaryAttachmentDigest"];
	if (typeof agentServiceId !== "string" || agentServiceId.trim().length === 0 || executionSubjectId !== `agent-service:${agentServiceId}` || typeof effectiveBoundaryAttachmentDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(effectiveBoundaryAttachmentDigest))
		return null;
	return { kind, executionSubjectId, agentServiceId, fleetMembershipRevision, effectiveBoundaryAttachmentDigest };
}
