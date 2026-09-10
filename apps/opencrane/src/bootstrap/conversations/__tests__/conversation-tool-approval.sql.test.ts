import { randomUUID } from "node:crypto";

import { AgentRunState, ToolInvocationState, ToolResultDeliveryState, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { PrismaElicitationRepository, PrismaElicitationUnitOfWork } from "@opencrane/backend/agents/execution/elicitation";
import { ElicitationBodyKinds, CONVERSATION_COMPUTER_PROJECTED_TOKEN_AUDIENCE } from "@opencrane/contracts";
import { __FakeWorkflowEngine } from "@opencrane/backend/server/infra/workflows/testing";
import { PrismaConversationComputerTurnWorkflowEventRepository, PrismaConversationToolProposalUnitOfWork, PrismaConversationToolResultsUnitOfWork, _RegisterConversationComputerTurnWorkflow, CONVERSATION_COMPUTER_TURN_TASK } from "@opencrane/backend/server/conversations";
import { ToolInvocationEventTypes } from "@opencrane/backend/server/iam/authorization";
import type { IWorkflowTaskReceipt, IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

import { _ToolHandoffSqlRuntime, _WaitPastSqlDeadline } from "./conversation-tool-handoff.sql-fixture";
import { _SeedConversationToolProposalSqlFixture } from "./conversation-tool-proposal.sql-fixture";

const _First = new PrismaClient();
const _Runtimes = new Set<ReturnType<typeof _ToolHandoffSqlRuntime>>();
const _WORKLOAD = { subject: "system:serviceaccount:computers:computer", audience: CONVERSATION_COMPUTER_PROJECTED_TOKEN_AUDIENCE, namespace: "computers", serviceAccountName: "computer", workloadKind: "pod", workloadUid: "computer-pod-1", podUid: "computer-pod-1" } as const;

describe("saved personal approval through the conversation workflow on PostgreSQL", function _Suite()
{
	beforeAll(async function _Connect()
	{
		if (!process.env.DATABASE_URL)
			throw new Error("The approval SQL proof requires DATABASE_URL and the fresh target baseline");
		await _First.$connect();
	});
	afterEach(async function _FinishControllers() { for (const runtime of _Runtimes) await runtime.register(); _Runtimes.clear(); });
	afterAll(async function _Disconnect() { await _First.$disconnect(); });

	it("waits for the exact owner, dispatches once, saves the result and consumes one continuation", async function _ApprovedJourney()
	{
		const f = await _SeedConversationToolProposalSqlFixture({ approvalRequired: true });
		const runtime = _ToolHandoffSqlRuntime(_First, f);
		_Runtimes.add(runtime);
		const workflows = new __FakeWorkflowEngine();
		const emitted: string[] = [];
		const taskAliases = new Map<string, { readonly taskId: string; readonly taskName: string; readonly idempotencyKey: string }>();
		const eventPort = _EventPort(workflows, emitted, taskAliases);
		const approvalExpiry = (transaction: unknown, command: { readonly runId: string; readonly attempt: number; readonly now: Date }) => new PrismaElicitationRepository(transaction as never, new PrismaConversationComputerTurnWorkflowEventRepository(transaction as never, eventPort)).expireDue(command).then(() => undefined);
		const proposalOwner = new PrismaConversationToolProposalUnitOfWork(_First, f.dependencies, runtime.admission, approvalExpiry);
		let advanceCount = 0;
		let resultReader: PrismaConversationToolResultsUnitOfWork | null = null;
		const authority = {
			start: async function _Start() { return f.turn; },
			advance: async function _Advance()
			{
				advanceCount++;
				const invocation = await _First.toolInvocation.findFirst({ where: { runId: f.runId } });
				if (invocation === null)
				{
					await proposalOwner.admit(f.turn, f.candidate, f.proposal, _WORKLOAD);
					const opened = await _First.toolInvocation.findFirstOrThrow({ where: { runId: f.runId } });
					return { outcome: "tool_pending" as const, toolInvocationId: opened.toolInvocationId, waitFor: "approval" as const, waitUntilEpochMs: (await _First.approvalRequest.findFirstOrThrow({ where: { runId: f.runId } })).expiresAt.getTime() };
				}
				if (invocation.state === ToolInvocationState.AwaitingApproval)
					return { outcome: "tool_pending" as const, toolInvocationId: invocation.toolInvocationId, waitFor: "approval" as const, waitUntilEpochMs: (await _First.approvalRequest.findFirstOrThrow({ where: { runId: f.runId } })).expiresAt.getTime() };
				if (invocation.state === ToolInvocationState.Ready)
				{
					if (await _First.mcpRuntimeExecution.findUnique({ where: { toolInvocationId: invocation.id } }) === null)
						await proposalOwner.admit(f.turn, f.candidate, f.proposal, _WORKLOAD);
					return { outcome: "tool_pending" as const, toolInvocationId: invocation.toolInvocationId, waitFor: "result" as const };
				}
				if (invocation.state !== ToolInvocationState.Succeeded)
					return { outcome: "tool_pending" as const, toolInvocationId: invocation.toolInvocationId, waitFor: "result" as const };
				const delivery = await _First.toolResultDelivery.findUniqueOrThrow({ where: { toolInvocationId: invocation.id } });
				const storedTurn = _ResultTurn(f, invocation.toolInvocationId, invocation.requestFingerprint, delivery.payloadDigest);
				resultReader = _ResultReader(f, invocation, delivery.payloadDigest);
				const result = await resultReader!.consume(storedTurn as never, _WORKLOAD);
				expect(result.outcome).toBe("available");
				return { outcome: "completed" as const };
			},
		};
		_RegisterConversationComputerTurnWorkflow(workflows, { authority: authority as never, receipts: { bind: async function _Bind() { return true; } }, siloId: f.siloId });
		const activationEventId = randomUUID();
		const task = await workflows.spawn({ client: {} }, { taskName: CONVERSATION_COMPUTER_TURN_TASK.taskName, idempotencyKey: activationEventId, input: { siloId: f.siloId, computerId: f.turn.computerId, leaseId: f.turn.lease.leaseId, leaseGeneration: f.turn.lease.leaseGeneration, activationEventId, causationId: f.turn.latestPendingEntryId, causationPosition: f.turn.latestPendingEntryPosition } });
		const persistedTask = { ...task, taskId: randomUUID() };
		taskAliases.set(persistedTask.taskId, task);
		await _First.agentRun.update({ where: { id: f.runId }, data: { workflowTaskId: persistedTask.taskId, workflowTaskName: persistedTask.taskName, workflowTaskKey: persistedTask.idempotencyKey } });
		const running = workflows._DrainPendingTasks();
		await _Eventually(async function _ApprovalOpened() { return (await _First.approvalRequest.findFirst({ where: { runId: f.runId } })) !== null; });
		const invocationBefore = await _First.toolInvocation.findFirstOrThrow({ where: { runId: f.runId } });
		expect(invocationBefore.state).toBe(ToolInvocationState.AwaitingApproval);
		expect(await _First.mcpRuntimeExecution.count({ where: { siloId: f.siloId } })).toBe(0);
		const approval = await _First.approvalRequest.findFirstOrThrow({ where: { runId: f.runId } });
		const elicitation = new PrismaElicitationUnitOfWork(_First, function _WakeFactory(transaction) { return new PrismaConversationComputerTurnWorkflowEventRepository(transaction as never, eventPort); });
		await expect(elicitation.respond({ siloId: f.siloId, conversationId: f.turn.binding.conversationId, requestId: approval.elicitationRequestId!, subjectId: f.principalId, verifiedStepUpAt: new Date(), submission: { idempotencyKey: `approve-${f.runId}`, response: { kind: ElicitationBodyKinds.Approval, approved: true } }, now: new Date() })).resolves.toMatchObject({ outcome: "accepted" });
		await _Eventually(async function _Ready() { return (await _First.toolInvocation.findFirstOrThrow({ where: { runId: f.runId } })).state === ToolInvocationState.Ready; });
		expect(await _First.mcpRuntimeExecution.count({ where: { siloId: f.siloId } })).toBe(0);
		const registered = await _EventuallyValue(async function _Registered() { return runtime.register(); });
		if (registered === null)
			throw new Error("MCP execution was not admitted after owner approval");
		await workflows.cancel(task);
		await running;
		const restarted = new __FakeWorkflowEngine();
		const restartedAliases = new Map<string, { readonly taskId: string; readonly taskName: string; readonly idempotencyKey: string }>();
		const restartedEventPort = _EventPort(restarted, emitted, restartedAliases);
		_RegisterConversationComputerTurnWorkflow(restarted, { authority: authority as never, receipts: { bind: async function _Bind() { return true; } }, siloId: f.siloId });
		const restartedActivationEventId = activationEventId;
		const restartedTask = await restarted.spawn({ client: {} }, { taskName: CONVERSATION_COMPUTER_TURN_TASK.taskName, idempotencyKey: restartedActivationEventId, input: { siloId: f.siloId, computerId: f.turn.computerId, leaseId: f.turn.lease.leaseId, leaseGeneration: f.turn.lease.leaseGeneration, activationEventId: restartedActivationEventId, causationId: f.turn.latestPendingEntryId, causationPosition: f.turn.latestPendingEntryPosition } });
		restartedAliases.set(persistedTask.taskId, restartedTask);
		const restartedRunning = restarted._DrainPendingTasks();
		await _Eventually(async function _RestartWaiting() { return (await _First.toolInvocation.findFirstOrThrow({ where: { runId: f.runId } })).state === ToolInvocationState.Ready; });
		const command = await runtime.authority.claimCompanion(registered.identity, registered.executionReference);
		if (command === null || typeof command === "string" || command.kind !== "invocation")
			throw new Error("Expected the real invocation claim");
		await expect(runtime.authority.completeCompanion(registered.identity, { executionReference: registered.executionReference, podUid: registered.identity.podUid, executionId: command.executionId, claimFence: command.claimFence, completion: { kind: command.kind, result: { isError: false, content: [{ type: "text", text: "approved SQL result" }] } } })).resolves.toBe("completed");
		await _Eventually(async function _ExecutionSaved() { return (await _First.mcpRuntimeExecution.count({ where: { siloId: f.siloId } })) === 1; });
		const invocationAfter = await _First.toolInvocation.findFirstOrThrow({ where: { runId: f.runId } });
		await new PrismaConversationComputerTurnWorkflowEventRepository(_First as never, restartedEventPort).emit({ runId: f.runId, attempt: 1, eventType: ToolInvocationEventTypes.Completed, payload: { toolInvocationId: invocationAfter.toolInvocationId } });
		await restartedRunning;
		expect(advanceCount).toBe(4);
		expect(emitted).toEqual([`tool-approval:${invocationAfter.toolInvocationId}`, `tool-result:${invocationAfter.toolInvocationId}`]);
		expect(invocationAfter.id).not.toBe(invocationAfter.toolInvocationId);
		expect(await _First.mcpRuntimeExecution.count({ where: { siloId: f.siloId } })).toBe(1);
		expect(await _First.toolInvocation.count({ where: { runId: f.runId } })).toBe(1);
		expect(await _First.toolResultDelivery.count({ where: { toolInvocationId: invocationAfter.id, state: ToolResultDeliveryState.Consumed } })).toBe(1);
		await expect(resultReader!.consume(_ResultTurn(f, invocationAfter.toolInvocationId, invocationAfter.requestFingerprint, (await _First.toolResultDelivery.findUniqueOrThrow({ where: { toolInvocationId: invocationAfter.id } })).payloadDigest) as never, _WORKLOAD)).resolves.toMatchObject({ outcome: "available" });
		expect(await _First.toolResultDelivery.count({ where: { toolInvocationId: invocationAfter.id, state: ToolResultDeliveryState.Consumed } })).toBe(1);
		expect((await _First.runInputSnapshot.findFirstOrThrow({ where: { runId: f.runId } })).budgetPolicy).toMatchObject({ maxToolInvocations: 1 });
	});

	it("expires an unanswered approval into one saved terminal result without dispatch", async function _ExpiredJourney()
	{
		const f = await _SeedConversationToolProposalSqlFixture({ approvalRequired: true, runLifetimeMs: 1_500 });
		const runtime = _ToolHandoffSqlRuntime(_First, f);
		_Runtimes.add(runtime);
		const owner = new PrismaConversationToolProposalUnitOfWork(_First, f.dependencies, runtime.admission, async function _ApprovalExpiry(transaction, command) { await new PrismaElicitationRepository(transaction as never).expireDue(command); });
		const opened = await owner.admit(f.turn, f.candidate, f.proposal, _WORKLOAD);
		const pending = await _First.toolInvocation.findFirstOrThrow({ where: { runId: f.runId } });
		expect(opened.proposalId).toBe(pending.toolInvocationId);
		expect(pending.id).not.toBe(pending.toolInvocationId);
		expect(pending.state).toBe(ToolInvocationState.AwaitingApproval);
		expect(await _First.mcpRuntimeExecution.count({ where: { siloId: f.siloId } })).toBe(0);
		await _WaitPastSqlDeadline(_First, f.candidate.compiledInput.budget.wallClockDeadlineEpochMs!);
		await new PrismaElicitationRepository(_First as never).expireDue({ runId: f.runId, attempt: 1, now: new Date() });
		await expect(owner.admit(f.turn, f.candidate, f.proposal, _WORKLOAD)).resolves.toMatchObject({ proposalId: pending.toolInvocationId });
		const expired = await _First.toolInvocation.findUniqueOrThrow({ where: { id: pending.id } });
		expect(expired.state).toBe(ToolInvocationState.Failed);
		expect(expired.failureCode).toBe("approval_expired");
		expect(await _First.agentRun.findUniqueOrThrow({ where: { id: f.runId } })).toMatchObject({ state: AgentRunState.Running });
		expect(await _First.mcpRuntimeExecution.count({ where: { siloId: f.siloId } })).toBe(0);
		expect(await _First.toolResultDelivery.count({ where: { toolInvocationId: pending.id, state: ToolResultDeliveryState.Pending } })).toBe(1);
	});

	it("denies the saved approval before runtime admission", async function _DeniedJourney()
	{
		const f = await _SeedConversationToolProposalSqlFixture({ approvalRequired: true });
		const runtime = _ToolHandoffSqlRuntime(_First, f);
		_Runtimes.add(runtime);
		const owner = new PrismaConversationToolProposalUnitOfWork(_First, f.dependencies, runtime.admission, async function _ApprovalExpiry(transaction, command) { await new PrismaElicitationRepository(transaction as never).expireDue(command); });
		await owner.admit(f.turn, f.candidate, f.proposal, _WORKLOAD);
		const pending = await _First.toolInvocation.findFirstOrThrow({ where: { runId: f.runId } });
		const approval = await _First.approvalRequest.findFirstOrThrow({ where: { runId: f.runId } });
		const elicitation = new PrismaElicitationUnitOfWork(_First);
		await expect(elicitation.respond({ siloId: f.siloId, conversationId: f.turn.binding.conversationId, requestId: approval.elicitationRequestId!, subjectId: f.principalId, verifiedStepUpAt: new Date(), submission: { idempotencyKey: `deny-${f.runId}`, response: { kind: ElicitationBodyKinds.Approval, approved: false } }, now: new Date() })).resolves.toMatchObject({ outcome: "accepted" });
		const denied = await _First.toolInvocation.findUniqueOrThrow({ where: { id: pending.id } });
		expect(denied).toMatchObject({ state: ToolInvocationState.Failed, failureCode: "approval_denied" });
		expect(await _First.mcpRuntimeExecution.count({ where: { siloId: f.siloId } })).toBe(0);
		expect(await _First.toolResultDelivery.count({ where: { toolInvocationId: pending.id, state: ToolResultDeliveryState.Pending } })).toBe(1);
	});
});

async function _Eventually(check: () => Promise<boolean>): Promise<void>
{
	for (let attempt = 0; attempt < 100; attempt++)
	{
		if (await check())
			return;
		await new Promise(resolve => setTimeout(resolve, 10));
	}
	throw new Error("SQL approval fixture did not reach its expected durable state");
}

async function _EventuallyValue<TValue>(read: () => Promise<TValue | null>): Promise<TValue>
{
	let value: TValue | null = null;
	await _Eventually(async function _Read() { value = await read(); return value !== null; });
	return value!;
}

function _EventPort(workflows: __FakeWorkflowEngine, emitted: string[], taskAliases: ReadonlyMap<string, { readonly taskId: string; readonly taskName: string; readonly idempotencyKey: string }>): Pick<IWorkflowEngine, "emitEventInTransaction">
{
	return { emitEventInTransaction: async function _Emit(transaction: unknown, task: IWorkflowTaskReceipt, event: { readonly eventName: string; readonly payload: unknown })
	{
		emitted.push(event.eventName);
		return workflows.emitEventInTransaction(transaction as never, taskAliases.get(task.taskId) ?? task, event as never);
	} } as Pick<IWorkflowEngine, "emitEventInTransaction">;
}

function _ResultReader(f: Awaited<ReturnType<typeof _SeedConversationToolProposalSqlFixture>>, invocation: { readonly toolInvocationId: string; readonly requestFingerprint: string }, resultDigest: string): PrismaConversationToolResultsUnitOfWork
{
	return new PrismaConversationToolResultsUnitOfWork(_First, f.siloId, { load: async function _Load() { return _ResultTurn(f, invocation.toolInvocationId, invocation.requestFingerprint, resultDigest); } } as never, { admit: async function _Admit() {} }, f.dependencies);
}

function _ResultTurn(f: Awaited<ReturnType<typeof _SeedConversationToolProposalSqlFixture>>, proposalId: string, requestFingerprint: string, resultDigest: string): unknown
{
	const deadline = f.candidate.compiledInput.budget.wallClockDeadlineEpochMs!;
	return { ...f.turn, modelReservation: { ordinal: 1 as const, tools: "select", compiledInputDigest: f.turn.compile.digest, invocationFence: "model-fence", requestDigest: "sha256:request", maxCompletionTokens: 128, authorityExpiresAtEpochMs: deadline, dispatchDeadlineEpochMs: deadline }, toolSelection: { proposalId, requestFingerprint, payloadRef: "payload-ref", ciphertextDigest: "sha256:cipher" }, continuationReservation: resultDigest === "sha256:cipher" ? null : { ordinal: 2 as const, tools: "none", compiledInputDigest: f.turn.compile.digest, invocationFence: "continuation-fence", requestDigest: "sha256:continuation", maxCompletionTokens: 128, authorityExpiresAtEpochMs: deadline, dispatchDeadlineEpochMs: deadline, continuation: { payloadRef: "continuation-ref", ciphertextDigest: resultDigest }, proposalId, resultDigest } };
}
