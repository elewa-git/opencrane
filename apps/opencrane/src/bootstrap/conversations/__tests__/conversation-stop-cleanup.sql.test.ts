import { randomUUID } from "node:crypto";
import { Absurd } from "absurd-sdk";
import pg from "pg";
import { AgentRunState, ExternalActionClaimKind, ExternalActionRecoveryMode, OrgMemberStatus, Prisma, PrismaClient, ToolInvocationState } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { _CreateAbsurdWorkflowEngine } from "@opencrane/backend/server/infra/workflows/infra_absurd";
import { PrismaAuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";
import { CONVERSATION_COMPUTER_STOP_TASK, CONVERSATION_COMPUTER_TURN_TASK, ConversationComputerStopDecisions, ConversationComputerStopStatuses, PrismaConversationComputerStopAdmissionUnitOfWork, PrismaConversationComputerStopLifecycleUnitOfWork, PrismaConversationComputerStopTargetUnitOfWork, PrismaConversationToolProposalUnitOfWork, _ConversationComputerStopAuthority } from "@opencrane/backend/server/conversations";
import type { ConversationComputerStopAdmission, ConversationComputerStopCommand, ConversationComputerStopPublisher, ConversationComputerStopSelection } from "@opencrane/backend/server/conversations";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { _SeedConversationToolProposalSqlFixture } from "./conversation-tool-proposal.sql-fixture";

/** Every assertion reads real run, approval and workflow receipts in the disposable database. */
const _Client = new PrismaClient();
/** Shares a test-owned PostgreSQL pool with SDK clients. */
const _Pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
/** Uses one isolated Absurd queue for this test process. */
const _Queue = `stop-proof-${randomUUID()}`;
/** Reuses the verified conversation-computer workload identity used by the approval journey. */
const _Workload = { subject: "system:serviceaccount:computers:computer", audience: "opencrane-conversation-computer", namespace: "computers", serviceAccountName: "computer", workloadKind: "pod", workloadUid: "computer-pod-1", podUid: "computer-pod-1" } as const;
/** Retains the actual SDK owner to close its test pool. */
let _QueueOwner: Absurd;
/** Creates a fresh engine facade to prove admission recovery without process-local state. */
function _Engine()
{
	return _CreateAbsurdWorkflowEngine({ databaseUrl: process.env.DATABASE_URL!, databasePool: _Pool, databasePoolSize: 2, queueAuthority: { queueForTask: function _QueueForTask() { return _Queue; } } });
}

/** Registers declarations without running a model or tool worker. */
function _Declare(engine: ReturnType<typeof _Engine>): void
{
	engine.register({ ...CONVERSATION_COMPUTER_TURN_TASK, run: async function _UnusedTurn() { throw new Error("This SQL test must never dispatch model work"); } });
	engine.register({ ...CONVERSATION_COMPUTER_STOP_TASK, run: async function _UnusedStop() { throw new Error("This SQL test drives cleanup directly after verified arbitration"); } });
}

/** Binds a real original Absurd task and derives the command from the fixture's authenticated requester. */
async function _Fixture(engine: ReturnType<typeof _Engine>)
{
	const f = await _SeedConversationToolProposalSqlFixture({ approvalRequired: true });
	const original = await _Client.$transaction(async function _BindOriginal(transaction)
	{
		const receipt = await engine.spawn({ client: transaction }, { taskName: CONVERSATION_COMPUTER_TURN_TASK.taskName, idempotencyKey: randomUUID(), input: { siloId: f.siloId } });
		await transaction.agentRun.update({ where: { id: f.runId }, data: { workflowTaskId: receipt.taskId, workflowTaskName: receipt.taskName, workflowTaskKey: receipt.idempotencyKey } });
		return receipt;
	});
	const command: ConversationComputerStopCommand = { commandId: randomUUID(), siloId: f.siloId, conversationId: f.turn.binding.conversationId, computerId: f.turn.computerId, generation: 1, causationId: randomUUID(), causationPosition: "2", requester: { principalId: f.principalId, subjectId: f.principalId, issuer: "https://identity.example.test", authenticatedAt: new Date().toISOString() } };
	return { ...f, original, command };
}

/** Resolves the fixture's history pointer through real requester, run and lease checks. */
function _Targets(f: Awaited<ReturnType<typeof _Fixture>>): PrismaConversationComputerStopTargetUnitOfWork
{
	return new PrismaConversationComputerStopTargetUnitOfWork(_Client, { async read() { return { turn: f.turn, activeTurnStreamName: `stop-sql-active-${f.runId}`, activeTurnExpectedRevision: "0" }; } });
}

/** Supplies the selected target to direct SQL admission tests; Kurrent selection has its own integration proof. */
async function _Selected(f: Awaited<ReturnType<typeof _Fixture>>)
{
	const selected = await _Targets(f).resolve(f.command);
	if (selected === null || selected.kind !== "target")
		throw new Error("Expected a currently authorized Stop target");
	return selected;
}

/** Adds a second active participant with the same Conversation Use grant, but no ownership of the run. */
async function _OtherParticipant(f: Awaited<ReturnType<typeof _Fixture>>): Promise<string>
{
	const principalId = randomUUID();
	const principal = await _Client.principal.findUniqueOrThrow({ where: { id: f.principalId } });
	const membership = await _Client.orgMembership.findUniqueOrThrow({ where: { clusterTenant_subject: { clusterTenant: f.siloId, subject: f.principalId } } });
	const participant = await _Client.conversationParticipant.findUniqueOrThrow({ where: { conversationId_userId: { conversationId: f.command.conversationId, userId: f.principalId } } });
	const capability = __ProductAuthorizationCapability(ProductAuthorizationResourceKinds.Conversation, ProductAuthorizationActions.Use)!;
	const grant = await _Client.authorizationGrant.findFirstOrThrow({ where: { siloId: f.siloId, resourceId: f.command.conversationId, subjectPrincipalId: f.principalId, capabilityId: capability.capabilityId } });
	await _Client.principal.create({ data: { ...principal, id: principalId, subject: principalId } });
	await _Client.orgMembership.create({ data: { ...membership, id: randomUUID(), subject: principalId } });
	await _Client.conversationParticipant.create({ data: { ...participant, userId: principalId } });
	await _Client.authorizationGrant.create({ data: { ...grant, id: randomUUID(), subjectPrincipalId: principalId, boundaryPrincipalId: principalId } });
	return principalId;
}

/** Seeds an expired dispatch using real admitted argument authority without enabling a provider. */
async function _ExpiredProviderInvocation(f: Awaited<ReturnType<typeof _Fixture>>)
{
	const proposals = new PrismaConversationToolProposalUnitOfWork(_Client, f.dependencies, async function _NoRuntime() { throw new Error("Pending approval cannot dispatch"); }, async function _NoExpiry() {});
	await proposals.admit(f.turn, f.candidate, f.proposal, _Workload);
	const authorized = await _Client.toolInvocation.findFirstOrThrow({ where: { runId: f.runId } });
	const requestIdentity = { runtimeInstanceId: authorized.runtimeInstanceId, commandId: authorized.commandId, candidateId: randomUUID() };
	const invocation = await _Client.toolInvocation.create({ data: {
		...authorized, id: randomUUID(), candidateId: requestIdentity.candidateId, toolInvocationId: randomUUID(), requestIdentity,
		requestFingerprint: ___DigestCanonicalJson(requestIdentity), approvalRequired: false,
		recoveryMode: ExternalActionRecoveryMode.ProviderIdempotency, recoveryKey: randomUUID(),
		state: ToolInvocationState.Preparing, preparationAttempt: 0, revision: 0,
		authorizationExecutionSubject: authorized.authorizationExecutionSubject as Prisma.InputJsonValue,
		authorizationCoordinates: authorized.authorizationCoordinates as Prisma.InputJsonValue,
		arguments: authorized.arguments as Prisma.InputJsonValue, effectiveArguments: authorized.effectiveArguments as Prisma.InputJsonValue,
		result: Prisma.DbNull,
	} });
	await _Client.toolInvocation.update({ where: { id: invocation.id }, data: { state: ToolInvocationState.Ready, preparationAttempt: 1, revision: 1 } });
	return _Client.toolInvocation.update({ where: { id: invocation.id }, data: { state: ToolInvocationState.Claimed, claimKind: ExternalActionClaimKind.Dispatch, claimAttempt: 1, claimFence: 1, claimExpiresAt: new Date(Date.now() - 1_000), revision: 2 } });
}

describe("Stop admission and approval cleanup across server recovery", function _Suite()
{
	beforeAll(async function _Connect()
	{
		if (!process.env.DATABASE_URL)
			throw new Error("The Stop SQL proof requires DATABASE_URL and a fresh target baseline");
		await _Client.$connect();
		_QueueOwner = new Absurd({ db: _Pool, queueName: _Queue });
		await _QueueOwner.createQueue(_Queue);
	});
	afterAll(async function _Close() { await _Client.$disconnect(); await _QueueOwner?.close(); await _Pool.end(); });

	it("recovers one saved cancellation task after authority expires, then closes the exact approval", async function _CleanupAfterRevocation()
	{
		const first = _Engine();
		const restarted = _Engine();
		_Declare(first);
		_Declare(restarted);
		try
		{
			const f = await _Fixture(first);
			const proposals = new PrismaConversationToolProposalUnitOfWork(_Client, f.dependencies, async function _NoRuntime() { throw new Error("Pending approval cannot dispatch"); }, async function _NoExpiry() {});
			await proposals.admit(f.turn, f.candidate, f.proposal, _Workload);
			const admissionOwner = new PrismaConversationComputerStopAdmissionUnitOfWork(_Client, first);
			const admitted = await admissionOwner.admit(f.command, await _Selected(f));
			if (admitted.kind !== "target")
				throw new Error("Expected one admitted Stop target");
			const lifecycle = new PrismaConversationComputerStopLifecycleUnitOfWork(_Client);
			await expect(lifecycle.cleanup(admitted)).rejects.toThrow("saved cancellation winner");
			await _Client.orgMembership.updateMany({ where: { clusterTenant: f.siloId, subject: f.principalId }, data: { status: OrgMemberStatus.Suspended } });
			await _Client.conversationComputerActiveLease.updateMany({ where: { computerId: f.turn.computerId }, data: { expiresAt: new Date(0) } });
			const recovery = new PrismaConversationComputerStopAdmissionUnitOfWork(_Client, restarted);
			expect(await recovery.read(f.command)).toEqual(admitted);
			await lifecycle.recordDecision(admitted, { decision: ConversationComputerStopDecisions.CancellationWon, published: true, outputReceiptDigest: null });
			await expect(lifecycle.cleanup(admitted)).resolves.toEqual({ activeClaimCount: 0, nextClaimExpiryAt: null });
			await expect(lifecycle.finalize(admitted)).resolves.toBe(true);
			await expect(new PrismaConversationComputerStopLifecycleUnitOfWork(_Client).finalize(admitted)).resolves.toBe(true);
			expect(await _Client.agentRun.findUniqueOrThrow({ where: { id: f.runId } })).toMatchObject({ state: AgentRunState.Cancelled, workflowTaskId: f.original.taskId, cancellationWorkflowTaskId: admitted.cancellationTask.taskId });
			expect(await _Client.approvalRequest.findFirstOrThrow({ where: { runId: f.runId } })).toMatchObject({ state: "Cancelled", decidedBy: null, finalArguments: null });
			expect(await _Client.elicitationRequest.findFirstOrThrow({ where: { runId: f.runId } })).toMatchObject({ state: "Cancelled" });
			expect(await _Client.toolInvocation.findFirstOrThrow({ where: { runId: f.runId } })).toMatchObject({ state: "Failed", failureCode: "run_cancelled", claimKind: null });
			expect(await _Client.mcpRuntimeExecution.count({ where: { siloId: f.siloId } })).toBe(0);
		}
		finally { await first.close(); await restarted.close(); }
	});

	it("keeps an expired idempotent provider dispatch uncertain after Stop completes", async function _ExpiredDispatch()
	{
		const engine = _Engine();
		_Declare(engine);
		try
		{
			const f = await _Fixture(engine);
			const invocation = await _ExpiredProviderInvocation(f);
			const snapshot = await _Client.runInputSnapshot.findFirstOrThrow({ where: { runId: f.runId, attempt: 1 } });
			const elicitationCount = await _Client.elicitationRequest.count({ where: { runId: f.runId } });
			const admitted = await new PrismaConversationComputerStopAdmissionUnitOfWork(_Client, engine).admit(f.command, await _Selected(f));
			if (admitted.kind !== "target")
				throw new Error("Expected one admitted Stop target");
			const lifecycle = new PrismaConversationComputerStopLifecycleUnitOfWork(_Client);
			await lifecycle.recordDecision(admitted, { decision: ConversationComputerStopDecisions.CancellationWon, published: true, outputReceiptDigest: null });
			await expect(lifecycle.cleanup(admitted)).resolves.toEqual({ activeClaimCount: 0, nextClaimExpiryAt: null });
			await expect(lifecycle.finalize(admitted)).resolves.toBe(true);
			await expect(new PrismaConversationComputerStopLifecycleUnitOfWork(_Client).finalize(admitted)).resolves.toBe(true);
			expect(await _Client.toolInvocation.findUniqueOrThrow({ where: { id: invocation.id } })).toMatchObject({ state: ToolInvocationState.RecoveryRequired, recoveryMode: ExternalActionRecoveryMode.ProviderIdempotency, recoveryKey: invocation.recoveryKey, recoveryRequiredAt: expect.any(Date), claimFence: 1, claimAttempt: 1, claimKind: null, claimExpiresAt: null, failureCode: null, result: null });
			expect(await _Client.toolResultDelivery.count({ where: { toolInvocationId: invocation.id } })).toBe(0);
			expect(await _Client.elicitationRequest.count({ where: { runId: f.runId } })).toBe(elicitationCount);
			expect(await _Client.mcpRuntimeExecution.count({ where: { siloId: f.siloId } })).toBe(0);
			expect(await _Client.runInputSnapshot.findFirstOrThrow({ where: { runId: f.runId, attempt: 1 } })).toEqual(snapshot);
			expect(await _Client.agentRun.findUniqueOrThrow({ where: { id: f.runId } })).toMatchObject({ state: AgentRunState.Cancelled, workflowTaskId: f.original.taskId, cancellationWorkflowTaskId: admitted.cancellationTask.taskId });
		}
		finally { await engine.close(); }
	});

	it.each(["authorized", "membership", "grant", "participation"])("checks current %s authority before publishing nothing-to-stop", async function _NoTargetAuthority(kind)
	{
		const engine = _Engine();
		_Declare(engine);
		try
		{
			const f = await _Fixture(engine);
			if (kind === "membership")
				await _Client.orgMembership.updateMany({ where: { clusterTenant: f.siloId, subject: f.principalId }, data: { status: OrgMemberStatus.Suspended } });
			if (kind === "grant")
				await _Client.authorizationGrant.updateMany({ where: { siloId: f.siloId, resourceId: f.command.conversationId }, data: { revokedAt: new Date() } });
			if (kind === "participation")
				await _Client.conversationParticipant.update({ where: { conversationId_userId: { conversationId: f.command.conversationId, userId: f.principalId } }, data: { accessEndedPosition: 1n } });
			const published: ConversationComputerStopSelection[] = [];
			const publisher: ConversationComputerStopPublisher = {
				async recover() { return published.length === 0 ? null : { decision: ConversationComputerStopDecisions.NoTarget, published: false, outputReceiptDigest: null }; },
				async recoverSelection() { return published[0] ?? null; },
				async select(command, resolution) { const selection = { command, ...resolution } as ConversationComputerStopSelection; published.push(selection); return selection; },
				async publish() { return { decision: ConversationComputerStopDecisions.NoTarget, published: true, outputReceiptDigest: null }; },
			};
			const targets = new PrismaConversationComputerStopTargetUnitOfWork(_Client, { async read() { return { turn: null, activeTurnStreamName: `no-active-turn-${f.runId}`, activeTurnExpectedRevision: null }; } });
			const authority = new _ConversationComputerStopAuthority(new PrismaConversationComputerStopAdmissionUnitOfWork(_Client, engine), targets, publisher);
			const allowed = kind === "authorized";
			await expect(authority.stop(f.command)).resolves.toEqual({ status: allowed ? ConversationComputerStopStatuses.NothingToStop : ConversationComputerStopStatuses.Denied });
			expect(published).toHaveLength(allowed ? 1 : 0);
			if (allowed)
			{
				const receipt = published[0]!;
				expect(await _Client.auditDecision.findUniqueOrThrow({ where: { decisionDigest: receipt.authorizationDecisionDigest } })).toMatchObject({ actorId: f.principalId, resourceId: f.command.conversationId, argumentsDigest: receipt.commandDigest });
			}
			expect(await _Client.agentRun.findUniqueOrThrow({ where: { id: f.runId } })).toMatchObject({ state: AgentRunState.Running, workflowTaskId: f.original.taskId, cancellationCommandId: null, cancellationWorkflowTaskId: null });
			expect(await _Client.mcpRuntimeExecution.count({ where: { siloId: f.siloId } })).toBe(0);
		}
		finally { await engine.close(); }
	});

	it.each(["generation", "expired-lease", "requester"])("denies a fresh Stop with stale %s authority", async function _StaleAuthority(kind)
	{
		const engine = _Engine();
		_Declare(engine);
		try
		{
			const f = await _Fixture(engine);
			const selected = await _Selected(f);
			if (kind === "expired-lease")
				await _Client.conversationComputerActiveLease.updateMany({ where: { computerId: f.turn.computerId }, data: { expiresAt: new Date(0) } });
			const generation = kind === "generation" ? 2 : 1;
			let principalId = f.principalId;
			if (kind === "requester")
				principalId = "another-person";
			const command = { ...f.command, generation, requester: { ...f.command.requester, principalId } };
			const admission = new PrismaConversationComputerStopAdmissionUnitOfWork(_Client, engine);
			await expect(admission.admit(command, selected)).rejects.toThrow();
			expect(await _Client.agentRun.findUniqueOrThrow({ where: { id: f.runId } })).toMatchObject({ state: AgentRunState.Running, cancellationCommandId: null });
		}
		finally { await engine.close(); }
	});

	it("denies another participant with Conversation Use before writing a target selection", async function _ForeignRequesterSelection()
	{
		const engine = _Engine();
		_Declare(engine);
		try
		{
			const f = await _Fixture(engine);
			const principalId = await _OtherParticipant(f);
			const decision = await _Client.$transaction(async function _CurrentUse(transaction)
			{
				return new PrismaAuthorizationAuthority(transaction).decidePrincipal({ siloId: f.siloId, principalId, resource: { kind: ProductAuthorizationResourceKinds.Conversation, id: f.command.conversationId }, action: ProductAuthorizationActions.Use, nowEpochMs: Date.now() });
			});
			expect(decision.outcome).toBe(AuthorizationDecisionOutcomes.Allow);
			let selections = 0;
			const publisher: ConversationComputerStopPublisher = {
				async recover() { return null; },
				async recoverSelection() { return null; },
				async select() { selections += 1; throw new Error("A foreign requester cannot write Kurrent selection"); },
				async publish() { throw new Error("A foreign requester cannot publish a Stop outcome"); },
			};
			const command = { ...f.command, requester: { ...f.command.requester, principalId, subjectId: principalId } };
			const authority = new _ConversationComputerStopAuthority(new PrismaConversationComputerStopAdmissionUnitOfWork(_Client, engine), _Targets(f), publisher);
			await expect(authority.stop(command)).resolves.toEqual({ status: ConversationComputerStopStatuses.Denied });
			expect(selections).toBe(0);
			expect(await _Client.agentRun.findUniqueOrThrow({ where: { id: f.runId } })).toMatchObject({ state: AgentRunState.Running, cancellationCommandId: null, cancellationWorkflowTaskId: null, workflowTaskId: f.original.taskId });
		}
		finally { await engine.close(); }
	});
});
