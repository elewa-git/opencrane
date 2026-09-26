import { AgentRoutineFiringDisposition, AgentRoutineFiringTrigger, AgentRunState, AgentRunTrigger, type AgentRoutineFiring, type AgentRun, type Prisma, type RunInputSnapshot as PrismaRunInputSnapshot } from "@prisma/client";

import { RUN_INPUT_SNAPSHOT_VERSION, type RunInputSnapshot } from "@opencrane/contracts";
import { ExecutionSubjectMembershipKinds, type ExecutionSubject } from "@opencrane/models/agents";
import { describe, expect, it, vi } from "vitest";

import { PrismaRoutineRunProgressFactsRepository, PrismaRoutineRunProgressUnitOfWork } from "../prisma-routine-run-progress-repository";
import { __DigestRunInputSnapshot } from "../run-input-snapshot-digest";

/** Build the smallest ordinary run row accepted by the historical reader. */
function _OrdinaryRun(): Record<string, unknown>
{
	return { id: "run-1", attempt: 1, trigger: AgentRunTrigger.Interactive, routineFiringId: null, routineId: null, routineRevision: null, routineScheduledSlot: null, state: AgentRunState.Running };
}

/** Build a transaction mock with one run lookup. */
function _Transaction(run: Record<string, unknown> | null): Record<string, unknown>
{
	return { agentRun: { findUnique: vi.fn().mockResolvedValue(run) }, agentRoutineFiring: { findUnique: vi.fn() }, runInputSnapshot: { findUnique: vi.fn() } };
}

/** Build the managed execution subject frozen for a routine run. */
function _Subject(): ExecutionSubject
{
	const membership = { kind: ExecutionSubjectMembershipKinds.Fleet, principalId: "requester-1", siloId: "silo-1", revision: 7, assertionId: "membership-1", payloadDigest: `sha256:${"b".repeat(64)}`, decisionEvidenceId: "membership-decision-1", trustedUntil: "2099-09-01T00:00:00.000Z" } as const;
	return { schemaVersion: 1, siloId: "silo-1", agentIdentityId: "identity-1", principalId: "company-principal", identity: { agentIdentityId: "identity-1", principalId: "company-principal", siloId: "silo-1", headRevision: "4", headDigest: `sha256:${"a".repeat(64)}`, decisionEvidenceId: "identity-decision-1", verifiedAt: "2026-09-01T00:00:00.000Z" }, membership: { kind: ExecutionSubjectMembershipKinds.Managed, siloId: "silo-1", principalId: "company-principal", agentServiceId: "service-1", agentRevisionId: "revision-1", agentRevisionDigest: `sha256:${"f".repeat(64)}`, decisionEvidenceId: "company-decision-1", trustedUntil: "2099-09-01T00:00:00.000Z" }, capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: `sha256:${"c".repeat(64)}`, effectiveContractDigest: `sha256:${"d".repeat(64)}`, decisionEvidenceId: "capability-decision-1", decidedAt: "2026-09-01T00:00:00.000Z" }, runScope: { siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1" }, computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 2 }, requester: { membership, siloId: "silo-1", requesterPrincipalId: "requester-1", requestIdempotencyKey: "firing-1", authenticatedAt: "2026-08-20T00:00:00.000Z" }, admission: { authorizingPrincipalId: "authorizer-1", decisionEvidenceId: "admission-decision-1", admittedAt: "2026-09-01T00:00:00.000Z" } };
}

/** Build one digest-valid stored routine snapshot and its reciprocal run/firing rows. */
function _RoutineFixture(trigger: AgentRunTrigger = AgentRunTrigger.Scheduled)
{
	const scheduledSlot = trigger === AgentRunTrigger.Scheduled ? "2026-09-01T01:00:00.000Z" : null;
	const origin = { kind: trigger === AgentRunTrigger.Scheduled ? "scheduled" : "manual", routineId: "routine-1", routineRevision: 3, firingId: "firing-1", scheduledSlot, requesterPrincipalId: "requester-1", requesterIssuer: "https://issuer.example", requesterSubjectId: "subject-1", requesterAuthenticatedAt: "2026-08-20T00:00:00.000Z", workflowTaskId: "task-1", workflowTaskName: "routine-occurrence", workflowTaskKey: "firing-1" } as const;
	const content: Omit<RunInputSnapshot, "digest"> = { runId: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", snapshotVersion: RUN_INPUT_SNAPSHOT_VERSION, origin, conversationId: "conversation-1", messageIds: ["prompt-1"], personaRevisionId: "persona-1", preferenceFactIds: [], artifactRevisionIds: [], skillRevisionIds: [], memoryQueryPolicy: { scope: "none" }, mcpTools: [], modelRoute: { alias: "target" }, budgetPolicy: { maxModelTurns: 1, maxCompletionTokens: 1000, maxCostUsdMicros: null, maxToolInvocations: 0, maxLoopIterations: 1, wallClockDeadlineEpochMs: 2_000_000_000_000 }, executionSubject: _Subject(), promptCompilerVersion: "prompt-v1", compiledAt: "2026-09-01T00:00:00.000Z" };
	const snapshot = { ...content, digest: __DigestRunInputSnapshot(content) };
	const row = { id: "snapshot-1", runId: "run-1", attempt: 1, snapshotVersion: snapshot.snapshotVersion, siloId: snapshot.siloId, agentServiceId: snapshot.agentServiceId, agentRevisionId: snapshot.agentRevisionId, agentIdentityId: snapshot.executionSubject.agentIdentityId, principalId: snapshot.executionSubject.principalId, executionSubject: snapshot.executionSubject, personaRevisionId: snapshot.personaRevisionId, conversationId: snapshot.conversationId, messageIds: snapshot.messageIds, preferenceFactIds: [], artifactRevisionIds: [], retiredMemoryFacts: [], modelRoute: snapshot.modelRoute, mcpTools: snapshot.mcpTools, skillRevisionIds: [], memoryQueryPolicy: snapshot.memoryQueryPolicy, budgetPolicy: snapshot.budgetPolicy, promptCompilerVersion: snapshot.promptCompilerVersion, origin: snapshot.origin, digest: snapshot.digest, compiledAt: new Date(snapshot.compiledAt) } as unknown as PrismaRunInputSnapshot;
	const run = { id: "run-1", siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", conversationId: "conversation-1", trigger, routineFiringId: "firing-1", routineId: "routine-1", routineRevision: 3, routineScheduledSlot: scheduledSlot === null ? null : new Date(scheduledSlot), agentIdentityId: "identity-1", principalId: "company-principal", executionSubject: _Subject(), requestIdempotencyKey: "firing-1", attempt: 1, state: AgentRunState.Accepted, inputSnapshotDigest: snapshot.digest, workflowTaskId: "turn-task-1", workflowTaskName: "conversation-computer-turn", workflowTaskKey: "activation-1", acceptedAt: new Date(), finishedAt: null, terminalReason: null, cancellationCommandId: null, cancellationCommandDigest: null, cancellationBootstrapId: null, cancellationDecision: null, cancellationDecidedAt: null } as unknown as AgentRun;
	const firingTrigger = trigger === AgentRunTrigger.Scheduled ? AgentRoutineFiringTrigger.Automatic : AgentRoutineFiringTrigger.Manual;
	const firingSlot = scheduledSlot === null ? null : new Date(scheduledSlot);
	const firing = { id: "firing-1", siloId: "silo-1", routineId: "routine-1", routineRevision: 3, conversationId: "conversation-1", requesterPrincipalId: "requester-1", trigger: firingTrigger, scheduledSlot: firingSlot, runId: "run-1", disposition: AgentRoutineFiringDisposition.Preparing, workflowTaskId: "task-1", workflowTaskName: "routine-occurrence", workflowTaskKey: "firing-1" } as unknown as AgentRoutineFiring;
	const state = { run, firing, row };
	const transaction = { agentRun: { findUnique: vi.fn().mockImplementation(async function _Run() { return state.run; }) }, agentRoutineFiring: { findUnique: vi.fn().mockImplementation(async function _Firing() { return state.firing; }) }, runInputSnapshot: { findUnique: vi.fn().mockImplementation(async function _Snapshot() { return state.row; }) } };
	return { state, transaction, repository: new PrismaRoutineRunProgressFactsRepository(transaction as unknown as Prisma.TransactionClient) };
}

describe("PrismaRoutineRunProgressRepository", function _Suite()
{
	it("returns null only for an identified ordinary interactive run", async function _Ordinary()
	{
		const transaction = _Transaction(_OrdinaryRun());
		const repository = new PrismaRoutineRunProgressFactsRepository(transaction as never);

		expect(await repository.read("run-1", 1)).toBeNull();
		expect((transaction.agentRoutineFiring as { findUnique: ReturnType<typeof vi.fn> }).findUnique).not.toHaveBeenCalled();
	});

	it("opens one read-only transaction through the unit of work", async function _UnitOfWorkRead()
	{
		const transaction = _Transaction(_OrdinaryRun());
		const prisma = { $transaction: vi.fn(async function _Transaction(work: (value: unknown) => Promise<unknown>) { return work(transaction); }) };
		const unit = new PrismaRoutineRunProgressUnitOfWork(prisma as never);

		expect(await unit.read("run-1", 1)).toBeNull();
		expect(prisma.$transaction).toHaveBeenCalledTimes(1);
		expect((transaction.agentRoutineFiring as { findUnique: ReturnType<typeof vi.fn> }).findUnique).not.toHaveBeenCalled();
	});

	it("rejects a missing run instead of treating it as an ordinary run", async function _Missing()
	{
		const repository = new PrismaRoutineRunProgressFactsRepository(_Transaction(null) as never);

		await expect(repository.read("missing", 1)).rejects.toThrow("exact admitted attempt");
	});

	it("rejects partially routine-linked interactive runs", async function _PartialInteractive()
	{
		const repository = new PrismaRoutineRunProgressFactsRepository(_Transaction({ ..._OrdinaryRun(), routineId: "routine-1" }) as never);

		await expect(repository.read("run-1", 1)).rejects.toThrow("partial routine linkage");
	});

	it("rejects incomplete non-interactive routine links before reading effects", async function _PartialRoutine()
	{
		const repository = new PrismaRoutineRunProgressFactsRepository(_Transaction({ ..._OrdinaryRun(), trigger: AgentRunTrigger.Scheduled, routineId: "routine-1" }) as never);

		await expect(repository.read("run-1", 1)).rejects.toThrow("complete routine linkage");
	});

	it.each([AgentRunTrigger.Scheduled, AgentRunTrigger.Manual])("reads a complete %s routine run", async function _Valid(trigger)
	{
		const fixture = _RoutineFixture(trigger);

		expect(await fixture.repository.read("run-1", 1)).toMatchObject({ runId: "run-1", trigger: trigger === AgentRunTrigger.Scheduled ? "scheduled" : "manual", routine: { firingId: "firing-1", routineId: "routine-1", routineRevision: 3 } });
	});

	it.each([
		["silo", { siloId: "other-silo" }],
		["revision", { routineRevision: 4 }],
		["conversation", { conversationId: "other-conversation" }],
		["slot", { routineScheduledSlot: new Date("2026-09-02T01:00:00.000Z") }],
	] as const)("rejects reciprocal firing mismatch: %s", async function _FiringMismatch(_label, change)
	{
		const fixture = _RoutineFixture();
		Object.assign(fixture.state.run, change);

		await expect(fixture.repository.read("run-1", 1)).rejects.toThrow("reciprocal routine firing");
	});

	it("rejects a substituted snapshot digest", async function _DigestMismatch()
	{
		const fixture = _RoutineFixture();
		Object.assign(fixture.state.run, { inputSnapshotDigest: `sha256:${"0".repeat(64)}` });

		await expect(fixture.repository.read("run-1", 1)).rejects.toThrow("invalid saved routine snapshot");
	});

	it.each(["runId", "subject", "requester", "origin", "slot"] as const)("rejects a substituted snapshot %s", async function _SnapshotMismatch(kind)
	{
		const fixture = _RoutineFixture();
		if (kind === "runId")
			Object.assign(fixture.state.row, { runId: "other-run" });
		if (kind === "subject")
			Object.assign(fixture.state.row, { executionSubject: { ...fixture.state.row.executionSubject as object, runScope: { ...(fixture.state.row.executionSubject as { runScope: object }).runScope, runId: "other-run" } } });
		if (kind === "requester")
			Object.assign(fixture.state.row, { origin: { ...(fixture.state.row.origin as object), requesterPrincipalId: "other-requester" } });
		if (kind === "origin")
			Object.assign(fixture.state.row, { origin: { ...(fixture.state.row.origin as object), routineRevision: 99 } });
		if (kind === "slot")
			Object.assign(fixture.state.row, { origin: { ...(fixture.state.row.origin as object), scheduledSlot: "2026-09-02T01:00:00.000Z" } });

		await expect(fixture.repository.read("run-1", 1)).rejects.toThrow(/invalid saved routine snapshot|mismatched routine snapshot origin|mismatched execution subject/u);
	});

	it("rejects a missing workflow receipt tuple", async function _WorkflowReceipt()
	{
		const fixture = _RoutineFixture();
		Object.assign(fixture.state.run, { workflowTaskKey: null });

		await expect(fixture.repository.read("run-1", 1)).rejects.toThrow("original workflow receipt");
	});

	it("rejects partial cancellation evidence", async function _CancellationEvidence()
	{
		const fixture = _RoutineFixture();
		Object.assign(fixture.state.run, { cancellationCommandId: "stop-1" });

		await expect(fixture.repository.read("run-1", 1)).rejects.toThrow("partial cancellation evidence");
	});
});
