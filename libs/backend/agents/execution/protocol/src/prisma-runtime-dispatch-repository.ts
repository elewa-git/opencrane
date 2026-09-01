import { createHash } from "node:crypto";

import { AgentRunState as PrismaAgentRunState, Prisma, RuntimeSteeringRequestState, WarmRuntimeReservationState, WorkloadAssignmentState, WorkloadKind } from "@prisma/client";

import { __ValidateWarmRuntimeLease } from "@opencrane/backend/agents/execution/runs";
import { ___ExecutionSubjectSchema, ___ParseExecutionSubject, type ExecutionSubject, type ExecutionSubjectVerificationContext } from "@opencrane/contracts";

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
		return this.prisma.runtimeCommandStream.updateMany({ where: { runId, attempt, nextCommandSequence: expectedSequence }, data: { nextCommandSequence: nextSequence, dispatchBlockedReason: null, dispatchBlockedAt: null } });
	}

	/** Records a visible fail-closed state without consuming the unsendable resume inputs. */
	markDispatchRecoveryRequired(runId: string, attempt: number, expectedSequence: number, reason: string, now: Date)
	{
		return this.prisma.runtimeCommandStream.updateMany({ where: { runId, attempt, nextCommandSequence: expectedSequence }, data: { dispatchBlockedReason: reason, dispatchBlockedAt: now } });
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
	async loadContext(config: RuntimeDispatchAuthorityConfig, identity: RuntimeStreamWorkloadIdentity, now: Date): Promise<RuntimeDispatchContext | null>
	{
		const reservation = await this.prisma.warmRuntimeReservation.findUnique({ where: { namespace_podUid: { namespace: identity.namespace, podUid: identity.podUid } } });
		if (reservation === null)
			return null;
		const assignment = await this.prisma.workloadAssignment.findUnique({ where: { runId_attempt: { runId: reservation.runId, attempt: reservation.attempt } } });
		if (assignment === null || !__ValidateWarmRuntimeLease(identity, assignment, reservation, now, [config.personalRuntimeNamespace, config.managedRuntimeNamespace]))
			return null;
		const run = await this.prisma.agentRun.findUnique({ where: { id: assignment.runId } });
		if (run === null || run.attempt !== assignment.attempt || run.agentServiceId !== assignment.agentServiceId || run.agentRevisionId !== assignment.agentRevisionId || run.siloId !== assignment.siloId)
			return null;
		const snapshot = await this.prisma.runInputSnapshot.findUnique({ where: { runId_attempt_digest: { runId: run.id, attempt: assignment.attempt, digest: run.inputSnapshotDigest } } });
		if (snapshot === null)
			return null;
		const executionSubject = _VerifiedExecutionSubject(run, assignment, snapshot, reservation, now.getTime());
		if (executionSubject === null || !_RuntimePlaneMatches(assignment, reservation, config))
			return null;
		const assignmentDigest = _computeAssignmentDigest({ runId: assignment.runId, attempt: assignment.attempt, generation: reservation.generation, agentServiceId: assignment.agentServiceId, agentRevisionId: assignment.agentRevisionId, siloId: assignment.siloId, agentIdentityId: assignment.agentIdentityId, principalId: assignment.principalId, executionSubject, workloadProfile: assignment.workloadProfile, serviceAccountName: reservation.serviceAccountName, podUid: reservation.podUid, expiresAt: reservation.idleDeadline, createdAt: reservation.reservedAt });
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
			executionSubject,
			workloadProfile: assignment.workloadProfile,
			serviceAccountName: reservation.serviceAccountName,
			workloadKind: assignment.workloadKind,
			podUid: reservation.podUid,
			leaseExpiresAtEpochMs: reservation.idleDeadline.getTime(),
			assignmentIssuedAt: reservation.reservedAt.toISOString(),
			assignmentExpiresAt: reservation.idleDeadline.toISOString(),
		};
	}
}

/** Returns whether the lease-selected workload profile still binds this assignment to one runtime plane. */
function _RuntimePlaneMatches(assignment: { readonly workloadProfile: string; readonly namespace: string; readonly serviceAccountName: string; readonly workloadKind: WorkloadKind }, reservation: { readonly namespace: string; readonly serviceAccountName: string; readonly claimedProfile: string }, config: RuntimeDispatchAuthorityConfig): boolean
{
	return assignment.workloadKind === WorkloadKind.Deployment
		&& assignment.workloadProfile.trim().length > 0
		&& assignment.workloadProfile === reservation.claimedProfile
		&& assignment.namespace === reservation.namespace
		&& reservation.serviceAccountName === assignment.serviceAccountName
		&& (reservation.namespace === config.personalRuntimeNamespace || reservation.namespace === config.managedRuntimeNamespace);
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

/** Hashes the assignment's verified subject and computer-selected workload profile in one fixed order. */
function _computeAssignmentDigest(context: { readonly runId: string; readonly attempt: number; readonly generation: number; readonly agentServiceId: string; readonly agentRevisionId: string; readonly siloId: string; readonly agentIdentityId: string; readonly principalId: string; readonly executionSubject: ExecutionSubject; readonly workloadProfile: string; readonly serviceAccountName: string; readonly podUid: string; readonly expiresAt: Date; readonly createdAt: Date }): string
{
	const canonical = JSON.stringify(["opencrane-runtime-assignment-digest-v4", context.runId, context.attempt, context.generation, context.agentServiceId, context.agentRevisionId, context.siloId, context.agentIdentityId, context.principalId, context.executionSubject, context.workloadProfile, context.serviceAccountName, context.podUid, context.expiresAt.toISOString(), context.createdAt.toISOString()]);
	return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

/** Parses one persisted execution subject through a strict schema before comparing trusted durable bindings. */
function _ParseExecutionSubject(value: unknown): ExecutionSubject | null
{
	const parsed = ___ExecutionSubjectSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

/** Rejects a snapshot unless its subject remains exactly bound to the current run, assignment, and lease. */
function _VerifiedExecutionSubject(run: { readonly id: string; readonly attempt: number; readonly siloId: string; readonly agentServiceId: string; readonly agentRevisionId: string; readonly agentIdentityId: string; readonly principalId: string; readonly executionSubject: unknown; readonly requestIdempotencyKey: string }, assignment: { readonly runId: string; readonly attempt: number; readonly siloId: string; readonly agentServiceId: string; readonly agentRevisionId: string; readonly agentIdentityId: string; readonly principalId: string; readonly executionSubject: unknown }, snapshot: { readonly runId: string; readonly attempt: number; readonly siloId: string; readonly agentServiceId: string; readonly agentRevisionId: string; readonly agentIdentityId: string; readonly principalId: string; readonly executionSubject: unknown }, reservation: { readonly generation: number }, nowEpochMilliseconds: number): ExecutionSubject | null
{
	const current = _ParseExecutionSubject(run.executionSubject);
	if (current === null)
		return null;
	const verificationContext = _ExecutionSubjectVerificationContext(current, nowEpochMilliseconds);
	const assigned = ___ParseExecutionSubject(assignment.executionSubject, verificationContext);
	const frozen = ___ParseExecutionSubject(snapshot.executionSubject, verificationContext);
	if (assigned === null || frozen === null)
		return null;
	if (current.siloId === run.siloId
		&& current.siloId === assignment.siloId
		&& current.siloId === snapshot.siloId
		&& current.agentIdentityId === run.agentIdentityId
		&& current.agentIdentityId === assignment.agentIdentityId
		&& current.agentIdentityId === snapshot.agentIdentityId
		&& current.principalId === run.principalId
		&& current.principalId === assignment.principalId
		&& current.principalId === snapshot.principalId
		&& current.runScope.runId === run.id
		&& current.runScope.runId === assignment.runId
		&& current.runScope.runId === snapshot.runId
		&& current.runScope.attempt === run.attempt
		&& current.runScope.attempt === assignment.attempt
		&& current.runScope.attempt === snapshot.attempt
		&& current.runScope.agentServiceId === run.agentServiceId
		&& current.runScope.agentServiceId === assignment.agentServiceId
		&& current.runScope.agentServiceId === snapshot.agentServiceId
		&& current.runScope.agentRevisionId === run.agentRevisionId
		&& current.runScope.agentRevisionId === assignment.agentRevisionId
		&& current.runScope.agentRevisionId === snapshot.agentRevisionId
		&& current.requester.requestIdempotencyKey === run.requestIdempotencyKey
		&& current.computerScope.leaseGeneration === reservation.generation
		&& Date.parse(current.membership.trustedUntil) > nowEpochMilliseconds)
	{
		return current;
	}
	return null;
}

/** Builds the trusted current verification context from the durable run admission currently under the stream lock. */
function _ExecutionSubjectVerificationContext(subject: ExecutionSubject, nowEpochMilliseconds: number): ExecutionSubjectVerificationContext
{
	return {
		siloId: subject.siloId,
		agentIdentityId: subject.agentIdentityId,
		principalId: subject.principalId,
		identityHeadRevision: subject.identity.headRevision,
		identityHeadDigest: subject.identity.headDigest,
		identityDecisionEvidenceId: subject.identity.decisionEvidenceId,
		identityVerifiedAt: subject.identity.verifiedAt,
		membershipRevision: subject.membership.revision,
		membershipAssertionId: subject.membership.assertionId,
		membershipPayloadDigest: subject.membership.payloadDigest,
		membershipDecisionEvidenceId: subject.membership.decisionEvidenceId,
		membershipTrustedUntil: subject.membership.trustedUntil,
		capabilitySetDigest: subject.capability.capabilitySetDigest,
		effectiveContractDigest: subject.capability.effectiveContractDigest,
		capabilityDecisionEvidenceId: subject.capability.decisionEvidenceId,
		capabilityDecidedAt: subject.capability.decidedAt,
		runId: subject.runScope.runId,
		attempt: subject.runScope.attempt,
		agentServiceId: subject.runScope.agentServiceId,
		agentRevisionId: subject.runScope.agentRevisionId,
		computerId: subject.computerScope.computerId,
		computerLeaseId: subject.computerScope.leaseId,
		computerLeaseGeneration: subject.computerScope.leaseGeneration,
		nowEpochMilliseconds,
		requesterPrincipalId: subject.requester.requesterPrincipalId,
		requestIdempotencyKey: subject.requester.requestIdempotencyKey,
		requesterAuthenticatedAt: subject.requester.authenticatedAt,
		authorizingPrincipalId: subject.admission.authorizingPrincipalId,
		admissionDecisionEvidenceId: subject.admission.decisionEvidenceId,
		admissionAdmittedAt: subject.admission.admittedAt,
	};
}
