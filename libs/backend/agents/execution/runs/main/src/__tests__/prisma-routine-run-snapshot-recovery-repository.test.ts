import { AgentRoutineFiringDisposition, AgentRoutineFiringTrigger, AgentRunState, AgentRunTrigger, type AgentRoutineFiring, type AgentRun, type Prisma, type RunInputSnapshot as PrismaRunInputSnapshot } from "@prisma/client";

import { RUN_INPUT_SNAPSHOT_VERSION, type RunInputSnapshot } from "@opencrane/contracts";
import { ExecutionSubjectMembershipKinds, type ExecutionSubject } from "@opencrane/models/agents";
import { describe, expect, it, vi } from "vitest";

import { PrismaRoutineRunSnapshotRecoveryRepository } from "../prisma-routine-run-snapshot-recovery-repository";
import type { RoutineRunAdmissionCommand } from "../run-admission.types";
import { __DigestRunInputSnapshot } from "../run-input-snapshot-digest";

/** Build one exact automatic or manual routine admission command. */
function _Command(trigger: "scheduled" | "manual" = "scheduled"): RoutineRunAdmissionCommand
{
	return {
		runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", conversationId: "conversation-1", trigger, requestIdempotencyKey: "firing-1", messageInput: null,
		routineInput: { routineId: "routine-1", routineRevision: 3, firingId: "firing-1", scheduledSlot: trigger === "scheduled" ? "2026-09-01T01:00:00.000Z" : null, requesterPrincipalId: "requester-1", requesterIssuer: "https://issuer.example", requesterSubjectId: "subject-1", requesterAuthenticatedAt: "2026-08-20T00:00:00.000Z", workflowTaskId: "task-1", workflowTaskName: "routine-occurrence", workflowTaskKey: "firing-1" },
	};
}

/** Build the complete managed subject frozen into one admitted routine snapshot. */
function _ExecutionSubject(command: RoutineRunAdmissionCommand): ExecutionSubject
{
	const membership = { kind: ExecutionSubjectMembershipKinds.Fleet, principalId: "requester-1", siloId: command.siloId, revision: 7, assertionId: "membership-1", payloadDigest: `sha256:${"b".repeat(64)}`, decisionEvidenceId: "membership-decision-1", trustedUntil: "2099-09-01T00:00:00.000Z" } as const;
	return {
		schemaVersion: 1, siloId: command.siloId, agentIdentityId: "identity-1", principalId: "company-principal",
		identity: { agentIdentityId: "identity-1", principalId: "company-principal", siloId: command.siloId, headRevision: "4", headDigest: `sha256:${"a".repeat(64)}`, decisionEvidenceId: "identity-decision-1", verifiedAt: "2026-09-01T00:00:00.000Z" },
		membership: { kind: ExecutionSubjectMembershipKinds.Managed, siloId: command.siloId, principalId: "company-principal", agentServiceId: command.agentServiceId, agentRevisionId: "revision-1", agentRevisionDigest: `sha256:${"f".repeat(64)}`, decisionEvidenceId: "company-decision-1", trustedUntil: "2099-09-01T00:00:00.000Z" },
		capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: `sha256:${"c".repeat(64)}`, effectiveContractDigest: `sha256:${"d".repeat(64)}`, decisionEvidenceId: "capability-decision-1", decidedAt: "2026-09-01T00:00:00.000Z" },
		runScope: { siloId: command.siloId, runId: command.runId, attempt: 1, agentServiceId: command.agentServiceId, agentRevisionId: "revision-1" },
		computerScope: { siloId: command.siloId, computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 2 },
		requester: { membership, siloId: command.siloId, requesterPrincipalId: command.routineInput.requesterPrincipalId, requestIdempotencyKey: command.requestIdempotencyKey, authenticatedAt: command.routineInput.requesterAuthenticatedAt },
		admission: { authorizingPrincipalId: "authorizer-1", decisionEvidenceId: "admission-decision-1", admittedAt: "2026-09-01T00:00:00.000Z" },
	};
}

/** Build one digest-valid immutable first-attempt snapshot. */
function _Snapshot(command: RoutineRunAdmissionCommand): RunInputSnapshot
{
	const content: Omit<RunInputSnapshot, "digest"> = {
		runId: command.runId, attempt: 1, siloId: command.siloId, agentServiceId: command.agentServiceId, agentRevisionId: "revision-1", snapshotVersion: RUN_INPUT_SNAPSHOT_VERSION,
		origin: { kind: command.trigger, routineId: command.routineInput.routineId, routineRevision: command.routineInput.routineRevision, firingId: command.routineInput.firingId, scheduledSlot: command.routineInput.scheduledSlot, requesterPrincipalId: command.routineInput.requesterPrincipalId, requesterIssuer: command.routineInput.requesterIssuer, requesterSubjectId: command.routineInput.requesterSubjectId, requesterAuthenticatedAt: command.routineInput.requesterAuthenticatedAt, workflowTaskId: command.routineInput.workflowTaskId, workflowTaskName: command.routineInput.workflowTaskName, workflowTaskKey: command.routineInput.workflowTaskKey },
		conversationId: command.conversationId, messageIds: ["service-prompt-1"], personaRevisionId: "persona-1", preferenceFactIds: [], artifactRevisionIds: [], skillRevisionIds: [], memoryQueryPolicy: { scope: "none" }, mcpTools: [], modelRoute: { alias: "target" }, budgetPolicy: { maxModelTurns: 1, maxCompletionTokens: 1000, maxCostUsdMicros: null, maxToolInvocations: 0, maxLoopIterations: 1, wallClockDeadlineEpochMs: 2_000_000_000_000 }, executionSubject: _ExecutionSubject(command), promptCompilerVersion: "prompt-v1", compiledAt: "2026-09-01T00:00:00.000Z",
	};
	return { ...content, digest: __DigestRunInputSnapshot(content) };
}

/** Convert a public snapshot into the stored Prisma projection read by recovery. */
function _StoredSnapshot(snapshot: RunInputSnapshot): PrismaRunInputSnapshot
{
	return {
		id: "snapshot-1", runId: snapshot.runId, attempt: snapshot.attempt, snapshotVersion: snapshot.snapshotVersion, siloId: snapshot.siloId, agentServiceId: snapshot.agentServiceId, agentRevisionId: snapshot.agentRevisionId, agentIdentityId: snapshot.executionSubject.agentIdentityId, principalId: snapshot.executionSubject.principalId, executionSubject: snapshot.executionSubject, personaRevisionId: snapshot.personaRevisionId, conversationId: snapshot.conversationId, messageIds: [...snapshot.messageIds], preferenceFactIds: [...snapshot.preferenceFactIds], artifactRevisionIds: [...snapshot.artifactRevisionIds], retiredMemoryFacts: [], modelRoute: snapshot.modelRoute, mcpTools: snapshot.mcpTools, skillRevisionIds: [...snapshot.skillRevisionIds], memoryQueryPolicy: snapshot.memoryQueryPolicy, budgetPolicy: snapshot.budgetPolicy, promptCompilerVersion: snapshot.promptCompilerVersion, origin: snapshot.origin, digest: snapshot.digest, compiledAt: new Date(snapshot.compiledAt),
	} as unknown as PrismaRunInputSnapshot;
}

/** Build the run row whose current digest selects the immutable first snapshot. */
function _Run(command: RoutineRunAdmissionCommand, snapshot: RunInputSnapshot): AgentRun
{
	return {
		id: command.runId, siloId: command.siloId, agentServiceId: command.agentServiceId, agentRevisionId: snapshot.agentRevisionId, conversationId: command.conversationId,
		trigger: command.trigger === "scheduled" ? AgentRunTrigger.Scheduled : AgentRunTrigger.Manual,
		routineFiringId: command.routineInput.firingId, routineId: command.routineInput.routineId, routineRevision: command.routineInput.routineRevision,
		routineScheduledSlot: command.routineInput.scheduledSlot === null ? null : new Date(command.routineInput.scheduledSlot),
		agentIdentityId: snapshot.executionSubject.agentIdentityId, principalId: snapshot.executionSubject.principalId, executionSubject: snapshot.executionSubject, requestIdempotencyKey: command.requestIdempotencyKey, attempt: 1, state: AgentRunState.Accepted, inputSnapshotDigest: snapshot.digest, acceptedAt: new Date("2026-09-01T00:00:00.000Z"),
	} as unknown as AgentRun;
}

/** Build the occurrence row linked one-to-one with the admitted run. */
function _Firing(command: RoutineRunAdmissionCommand): AgentRoutineFiring
{
	return {
		id: command.routineInput.firingId, siloId: command.siloId, routineId: command.routineInput.routineId, routineRevision: command.routineInput.routineRevision, conversationId: command.conversationId, requesterPrincipalId: command.routineInput.requesterPrincipalId,
		trigger: command.trigger === "scheduled" ? AgentRoutineFiringTrigger.Automatic : AgentRoutineFiringTrigger.Manual,
		scheduledSlot: command.routineInput.scheduledSlot === null ? null : new Date(command.routineInput.scheduledSlot),
		runId: command.runId, disposition: AgentRoutineFiringDisposition.Preparing, workflowTaskId: command.routineInput.workflowTaskId, workflowTaskName: command.routineInput.workflowTaskName, workflowTaskKey: command.routineInput.workflowTaskKey,
	} as unknown as AgentRoutineFiring;
}

/** Compose read-only Prisma delegates around mutable stored rows. */
function _Fixture(command: RoutineRunAdmissionCommand = _Command())
{
	const snapshot = _Snapshot(command);
	const state: { run: AgentRun | null; firing: AgentRoutineFiring | null; snapshot: PrismaRunInputSnapshot | null } = { run: _Run(command, snapshot), firing: _Firing(command), snapshot: _StoredSnapshot(snapshot) };
	const transaction = {
		agentRun: { findUnique: vi.fn(async function _FindRun() { return state.run; }) },
		agentRoutineFiring: { findUnique: vi.fn(async function _FindFiring() { return state.firing; }) },
		runInputSnapshot: { findUnique: vi.fn(async function _FindSnapshot() { return state.snapshot; }) },
	};
	return { command, snapshot, state, transaction, repository: new PrismaRoutineRunSnapshotRecoveryRepository(transaction as unknown as Prisma.TransactionClient) };
}

describe("PrismaRoutineRunSnapshotRecoveryRepository", function _RoutineRunSnapshotRecoverySuite()
{
	it.each(["scheduled", "manual"] as const)("recovers one exact digest-valid %s first-attempt snapshot using reads only", async function _RecoversExactSnapshot(trigger)
	{
		const fixture = _Fixture(_Command(trigger));

		await expect(fixture.repository.recover(fixture.command, 1)).resolves.toEqual(fixture.snapshot);
		expect(fixture.transaction.agentRun.findUnique).toHaveBeenCalledWith({ where: { id: fixture.command.runId } });
		expect(fixture.transaction.agentRoutineFiring.findUnique).toHaveBeenCalledWith({ where: { id: fixture.command.routineInput.firingId } });
		expect(fixture.transaction.runInputSnapshot.findUnique).toHaveBeenCalledWith({ where: { runId_attempt_digest: { runId: fixture.command.runId, attempt: 1, digest: fixture.snapshot.digest } } });
	});

	it("returns null only when the expected run does not exist", async function _ReturnsMissingRun()
	{
		const fixture = _Fixture();
		fixture.state.run = null;

		await expect(fixture.repository.recover(fixture.command, 1)).resolves.toBeNull();
		expect(fixture.transaction.agentRoutineFiring.findUnique).not.toHaveBeenCalled();
		expect(fixture.transaction.runInputSnapshot.findUnique).not.toHaveBeenCalled();
	});

	it.each([
		["foreign run identifier", { id: "run-2" }],
		["later attempt", { attempt: 2 }],
		["foreign idempotency key", { requestIdempotencyKey: "firing-2" }],
		["foreign silo", { siloId: "silo-2" }],
		["foreign service", { agentServiceId: "service-2" }],
		["foreign conversation", { conversationId: "conversation-2" }],
		["foreign trigger", { trigger: AgentRunTrigger.Manual }],
	] as const)("rejects a stored run with a %s", async function _RejectsRunMismatch(_label, change)
	{
		const fixture = _Fixture();
		fixture.state.run = { ...fixture.state.run!, ...change };

		await expect(fixture.repository.recover(fixture.command, 1)).rejects.toThrow("Stored routine run does not match");
	});

	it.each([
		["foreign requester", { requesterPrincipalId: "requester-2" }],
		["foreign workflow task", { workflowTaskId: "task-2" }],
		["foreign workflow key", { workflowTaskKey: "firing-2" }],
		["detached run", { runId: "run-2" }],
	] as const)("rejects firing %s provenance", async function _RejectsFiringMismatch(_label, change)
	{
		const fixture = _Fixture();
		fixture.state.firing = { ...fixture.state.firing!, ...change };

		await expect(fixture.repository.recover(fixture.command, 1)).rejects.toThrow("Stored routine firing does not match");
	});

	it("rejects a missing snapshot instead of treating a partial admission as absent", async function _RejectsMissingSnapshot()
	{
		const fixture = _Fixture();
		fixture.state.snapshot = null;

		await expect(fixture.repository.recover(fixture.command, 1)).rejects.toThrow("Stored routine snapshot does not match");
	});

	it.each([
		["foreign workflow task", { workflowTaskId: "task-2" }],
		["foreign requester issuer", { requesterIssuer: "https://foreign.example" }],
	] as const)("rejects snapshot origin with %s provenance", async function _RejectsOriginMismatch(_label, change)
	{
		const fixture = _Fixture();
		fixture.state.snapshot = { ...fixture.state.snapshot!, origin: { ...(fixture.state.snapshot!.origin as object), ...change } } as PrismaRunInputSnapshot;

		await expect(fixture.repository.recover(fixture.command, 1)).rejects.toThrow("Stored routine snapshot does not match");
	});

	it("rejects a snapshot whose content no longer matches the run's current digest", async function _RejectsDigestTampering()
	{
		const fixture = _Fixture();
		fixture.state.snapshot = { ...fixture.state.snapshot!, modelRoute: { alias: "tampered" } } as PrismaRunInputSnapshot;

		await expect(fixture.repository.recover(fixture.command, 1)).rejects.toThrow("Recovered routine snapshot digest is invalid");
	});

	it("fails closed when a stored snapshot field cannot be parsed", async function _RejectsCorruptSnapshot()
	{
		const fixture = _Fixture();
		fixture.state.snapshot = { ...fixture.state.snapshot!, budgetPolicy: { maxModelTurns: 0 } } as PrismaRunInputSnapshot;

		await expect(fixture.repository.recover(fixture.command, 1)).rejects.toThrow();
	});

	it("rejects a validly shaped execution subject with foreign run provenance", async function _RejectsForeignSubject()
	{
		const fixture = _Fixture();
		const subject = fixture.state.snapshot!.executionSubject as unknown as ExecutionSubject;
		fixture.state.snapshot = { ...fixture.state.snapshot!, executionSubject: { ...subject, runScope: { ...subject.runScope, runId: "run-2" } } } as unknown as PrismaRunInputSnapshot;

		await expect(fixture.repository.recover(fixture.command, 1)).rejects.toThrow("Recovered routine snapshot does not match");
	});
});
