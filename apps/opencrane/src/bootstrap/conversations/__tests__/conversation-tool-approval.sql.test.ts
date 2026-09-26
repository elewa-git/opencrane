import { randomUUID } from "node:crypto";

import { AgentRunState, AgentServiceKind, McpExecutionTransport, OrgRole, PrincipalProvenance, ToolInvocationState, ToolResultDeliveryState, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { PrismaElicitationRepository, PrismaElicitationUnitOfWork } from "@opencrane/backend/agents/execution/elicitation";
import { ConversationModelToolModes, ElicitationApprovalScopes, ElicitationBodyKinds, ElicitationConnectionOwnerKinds, McpCredentialRequirement, CONVERSATION_COMPUTER_PROJECTED_TOKEN_AUDIENCE } from "@opencrane/contracts";
import { __FakeWorkflowEngine } from "@opencrane/backend/server/infra/workflows/testing";
import { ConversationGeneratedFileResultStates, ConversationApprovalNotificationOutcomes, PrismaConversationComputerTurnWorkflowEventRepository, PrismaConversationToolProposalUnitOfWork, PrismaConversationToolResultsUnitOfWork, _RegisterConversationComputerTurnWorkflow, CONVERSATION_COMPUTER_TURN_TASK } from "@opencrane/backend/server/conversations";
import { PrismaManagedAuthorizationGrantRepository, ToolInvocationEventTypes } from "@opencrane/backend/server/iam/authorization";
import type { IWorkflowTaskReceipt, IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";
import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationSubjectKinds, ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { _ToolHandoffSqlRuntime, _WaitPastSqlDeadline } from "./conversation-tool-handoff.sql-fixture";
import { _SeedConversationToolProposalSqlFixture } from "./conversation-tool-proposal.sql-fixture";
import { _ConversationTurnRequest, _RecordConversationTurnResult, _ReserveConversationTurnModel, _SelectConversationTurnTool } from "./conversation-turn-protocol.fixture";

const _First = new PrismaClient();
const _Runtimes = new Set<ReturnType<typeof _ToolHandoffSqlRuntime>>();
const _WORKLOAD = { subject: "system:serviceaccount:computers:computer", audience: CONVERSATION_COMPUTER_PROJECTED_TOKEN_AUDIENCE, namespace: "computers", serviceAccountName: "computer", workloadKind: "pod", workloadUid: "computer-pod-1", podUid: "computer-pod-1" } as const;
const _APPROVAL_NOTIFICATIONS = { publishRequested: async function _PublishRequested() { return ConversationApprovalNotificationOutcomes.Published; } } as const;

describe("requester approval through the conversation workflow on PostgreSQL", function _Suite()
{
	beforeAll(async function _Connect()
	{
		if (!process.env.DATABASE_URL)
			throw new Error("The approval SQL proof requires DATABASE_URL and the fresh target baseline");
		await _First.$connect();
	});
	afterEach(async function _FinishControllers() { for (const runtime of _Runtimes) await runtime.register(); _Runtimes.clear(); });
	afterAll(async function _Disconnect() { await _First.$disconnect(); });

	it.each([AgentServiceKind.Personal, AgentServiceKind.Managed])("%s approval waits for the requester, dispatches once and consumes one continuation", async function _ApprovedJourney(agentKind)
	{
		const f = await _SeedConversationToolProposalSqlFixture({ agentKind, approvalRequired: true });
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
		_RegisterConversationComputerTurnWorkflow(workflows, { toolDispatch: { tryExecute: async function _WaitForCompanion() { return false; }, settleExhausted: async function _KeepCompanionAuthority() { return false; } }, authority: authority as never, approvalNotifications: _APPROVAL_NOTIFICATIONS, receipts: { bind: async function _Bind() { return true; } }, routineProgress: { recordRunning: async function _Running() {}, recordWaiting: async function _Waiting() {} }, siloId: f.siloId });
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
		const approvalRequest = await _First.elicitationRequest.findUniqueOrThrow({ where: { id: approval.elicitationRequestId! } });
		expect(approval.principalId).toBe(f.principalId);
		expect(approvalRequest.assignedParticipantId).toBe(f.requesterPrincipalId);
		if (agentKind === AgentServiceKind.Managed)
			expect(f.principalId).not.toBe(f.requesterPrincipalId);
		const approvalGrants = await _First.authorizationGrant.findMany({ where: { siloId: f.siloId, resourceKind: ProductAuthorizationResourceKinds.ApprovalRequest, resourceId: approval.id, revokedAt: null } });
		expect(approvalGrants).toHaveLength(2);
		expect(approvalGrants.map(grant => grant.capabilityId).sort()).toEqual([ProductAuthorizationActions.Read, ProductAuthorizationActions.Decide].map(action => __ProductAuthorizationCapability(ProductAuthorizationResourceKinds.ApprovalRequest, action)!.capabilityId).sort());
		for (const grant of approvalGrants)
			expect(grant).toMatchObject({ subjectPrincipalId: f.requesterPrincipalId, boundaryPrincipalId: f.requesterPrincipalId, managerId: "deferred-tool-approval-assignee" });
		const disclosure = {
			kind: ElicitationBodyKinds.Approval,
			prompt: "Allow this agent to invoke the reviewed tool?",
			action: "Invoke tool",
			target: f.tool.name,
			dataUse: "The proposed arguments shown in this request will be sent to the tool.",
			externalSystem: f.serverName,
			consequence: `This invokes the external tool once. Its saved description says: ${f.tool.description}`,
			proposedArguments: f.proposal.arguments,
			offeredScopes: [ElicitationApprovalScopes.Once, ElicitationApprovalScopes.Always],
			standingScope: { explanation: "Approve always applies only to this exact assistant revision, connection owner and generation, tool revision, action, and final reviewed arguments. Any changed detail requires a fresh approval. You can revoke it later." },
			executionConnection: {
				ownerKind: agentKind === AgentServiceKind.Managed ? ElicitationConnectionOwnerKinds.CompanyAssistant : ElicitationConnectionOwnerKinds.Personal,
				ownerLabel: f.executionOwnerLabel,
				credentialRequirement: McpCredentialRequirement.Credentialless,
			},
		};
		expect(approvalRequest.body).toEqual(disclosure);
		expect(approvalRequest.bodyDigest).toBe(___DigestCanonicalJson(disclosure));
		const elicitation = new PrismaElicitationUnitOfWork(_First, function _WakeFactory(transaction) { return new PrismaConversationComputerTurnWorkflowEventRepository(transaction as never, eventPort); });
		const browserRequest = await elicitation.readOwned(f.siloId, f.turn.binding.conversationId, approval.elicitationRequestId!, f.requesterPrincipalId, new Date());
		expect(browserRequest?.body).toEqual(disclosure);
		expect(JSON.stringify(browserRequest)).not.toMatch(/purposePayload|bodyDigest|requestKey|toolRevisionId|profileId|secretName|secretKey/);
		const response = { kind: ElicitationBodyKinds.Approval, approved: true } as const;
		const respond = { siloId: f.siloId, conversationId: f.turn.binding.conversationId, requestId: approval.elicitationRequestId!, subjectId: f.requesterPrincipalId, verifiedStepUpAt: new Date(), submission: { idempotencyKey: `approve-${f.runId}`, response }, now: new Date() };
		await expect(elicitation.respond(respond)).resolves.toMatchObject({ outcome: "accepted", projection: { idempotent: false } });
		await expect(elicitation.respond({ ...respond, now: new Date() })).resolves.toMatchObject({ outcome: "accepted", projection: { idempotent: true } });
		await expect(_First.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } })).resolves.toMatchObject({ principalId: f.principalId, decidedBy: f.requesterPrincipalId, state: "Approved" });
		expect(await _First.elicitationResponseAttempt.count({ where: { requestId: approvalRequest.id } })).toBe(1);
		expect(await _First.authorizationGrant.count({ where: { siloId: f.siloId, resourceKind: ProductAuthorizationResourceKinds.ApprovalRequest, resourceId: approval.id, revokedAt: null } })).toBe(0);
		const decisionAudits = await _First.auditDecision.findMany({ where: { siloId: f.siloId, actorId: f.requesterPrincipalId, argumentsDigest: ___DigestCanonicalJson(response) }, orderBy: { resourceKind: "asc" } });
		expect(decisionAudits).toEqual(expect.arrayContaining([
			expect.objectContaining({ actorKind: "User", actorId: f.requesterPrincipalId, resourceKind: ProductAuthorizationResourceKinds.Conversation, resourceId: f.turn.binding.conversationId, action: ProductAuthorizationActions.Use, outcome: "Allow" }),
			expect.objectContaining({ actorKind: "User", actorId: f.requesterPrincipalId, resourceKind: ProductAuthorizationResourceKinds.ApprovalRequest, resourceId: approval.id, action: ProductAuthorizationActions.Decide, outcome: "Allow" }),
		]));
		expect(decisionAudits).toHaveLength(2);
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
		_RegisterConversationComputerTurnWorkflow(restarted, { toolDispatch: { tryExecute: async function _WaitForCompanion() { return false; }, settleExhausted: async function _KeepCompanionAuthority() { return false; } }, authority: authority as never, approvalNotifications: _APPROVAL_NOTIFICATIONS, receipts: { bind: async function _Bind() { return true; } }, routineProgress: { recordRunning: async function _Running() {}, recordWaiting: async function _Waiting() {} }, siloId: f.siloId });
		const restartedActivationEventId = activationEventId;
		const restartedTask = await restarted.spawn({ client: {} }, { taskName: CONVERSATION_COMPUTER_TURN_TASK.taskName, idempotencyKey: restartedActivationEventId, input: { siloId: f.siloId, computerId: f.turn.computerId, leaseId: f.turn.lease.leaseId, leaseGeneration: f.turn.lease.leaseGeneration, activationEventId: restartedActivationEventId, causationId: f.turn.latestPendingEntryId, causationPosition: f.turn.latestPendingEntryPosition } });
		restartedAliases.set(persistedTask.taskId, restartedTask);
		const restartedRunning = restarted._DrainPendingTasks();
		await _Eventually(async function _RestartWaiting() { return (await _First.toolInvocation.findFirstOrThrow({ where: { runId: f.runId } })).state === ToolInvocationState.Ready; });
		const commandClaimed = await runtime.authority.claimCompanion(registered.identity, registered.executionReference);
		const command = commandClaimed === null || typeof commandClaimed === "string" ? commandClaimed : commandClaimed.command;
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

	it.each([AgentServiceKind.Personal, AgentServiceKind.Managed])("%s RemoteHttp approval saves its execution owner and one continuation without calling the provider", async function _RemoteApproval(agentKind)
	{
		const f = await _SeedConversationToolProposalSqlFixture({ agentKind, approvalRequired: true, transport: McpExecutionTransport.RemoteHttp });
		const runtime = _ToolHandoffSqlRuntime(_First, f);
		_Runtimes.add(runtime);
		const owner = new PrismaConversationToolProposalUnitOfWork(_First, f.dependencies, runtime.admission, async function _ApprovalExpiry(transaction, command) { await new PrismaElicitationRepository(transaction as never).expireDue(command); });
		const workflows = new __FakeWorkflowEngine();
		workflows.declare(CONVERSATION_COMPUTER_TURN_TASK);
		const task = await workflows.spawn({ client: {} }, { taskName: CONVERSATION_COMPUTER_TURN_TASK.taskName, idempotencyKey: randomUUID(), input: {} });
		const persistedTask = { ...task, taskId: randomUUID() };
		await _First.agentRun.update({ where: { id: f.runId }, data: { workflowTaskId: persistedTask.taskId, workflowTaskName: persistedTask.taskName, workflowTaskKey: persistedTask.idempotencyKey } });
		await owner.admit(f.turn, f.candidate, f.proposal, _WORKLOAD);
		const approval = await _First.approvalRequest.findFirstOrThrow({ where: { runId: f.runId } });
		const request = await _First.elicitationRequest.findUniqueOrThrow({ where: { id: approval.elicitationRequestId! } });
		const invocation = await _First.toolInvocation.findFirstOrThrow({ where: { runId: f.runId } });
		const expectedOwnerKind = agentKind === AgentServiceKind.Managed ? ElicitationConnectionOwnerKinds.CompanyAssistant : ElicitationConnectionOwnerKinds.Personal;
		expect(request.body).toMatchObject({ executionConnection: { ownerKind: expectedOwnerKind, ownerLabel: f.executionOwnerLabel, credentialRequirement: McpCredentialRequirement.Credentialless } });
		expect(request.bodyDigest).toBe(___DigestCanonicalJson(request.body as never));
		expect(approval).toMatchObject({ principalId: f.principalId, state: "Pending" });
		expect(request.assignedParticipantId).toBe(f.requesterPrincipalId);
		expect(invocation.state).toBe(ToolInvocationState.AwaitingApproval);
		const connection = await _First.mcpConnection.findFirstOrThrow({ where: { siloId: f.siloId } });
		expect(connection).toMatchObject({ ownerPrincipalId: f.principalId, actorPrincipalId: f.requesterPrincipalId });
		if (agentKind === AgentServiceKind.Managed)
			expect(f.principalId).not.toBe(f.requesterPrincipalId);
		const grants = await _First.authorizationGrant.findMany({ where: { siloId: f.siloId, resourceKind: ProductAuthorizationResourceKinds.ApprovalRequest, resourceId: approval.id, revokedAt: null } });
		expect(grants).toHaveLength(2);
		expect(grants.every(function _RequesterGrant(grant) { return grant.subjectPrincipalId === f.requesterPrincipalId && grant.boundaryPrincipalId === f.requesterPrincipalId; })).toBe(true);

		const emitted: string[] = [];
		const taskAliases = new Map([[persistedTask.taskId, task]]);
		const eventPort = _EventPort(workflows, emitted, taskAliases);
		const elicitation = new PrismaElicitationUnitOfWork(_First, function _WakeFactory(transaction) { return new PrismaConversationComputerTurnWorkflowEventRepository(transaction as never, eventPort); });
		const response = { kind: ElicitationBodyKinds.Approval, approved: true } as const;
		const command = { siloId: f.siloId, conversationId: f.turn.binding.conversationId, requestId: request.id, subjectId: f.requesterPrincipalId, verifiedStepUpAt: new Date(), submission: { idempotencyKey: `approve-remote-${f.runId}`, response }, now: new Date() };
		await expect(elicitation.respond(command)).resolves.toMatchObject({ outcome: "accepted", projection: { idempotent: false } });
		await expect(elicitation.respond({ ...command, now: new Date() })).resolves.toMatchObject({ outcome: "accepted", projection: { idempotent: true } });
		expect(await _First.toolInvocation.findUniqueOrThrow({ where: { id: invocation.id } })).toMatchObject({ state: ToolInvocationState.Ready });
		expect(await _First.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } })).toMatchObject({ state: "Approved", decidedBy: f.requesterPrincipalId });
		expect(await _First.authorizationGrant.count({ where: { siloId: f.siloId, resourceKind: ProductAuthorizationResourceKinds.ApprovalRequest, resourceId: approval.id, revokedAt: null } })).toBe(0);
		expect(await _First.elicitationResponseAttempt.count({ where: { requestId: request.id } })).toBe(1);
		expect(await _First.mcpRuntimeExecution.count({ where: { siloId: f.siloId } })).toBe(0);
		expect(emitted).toEqual([`tool-approval:${invocation.toolInvocationId}`]);
	});

	it.each([AgentServiceKind.Personal, AgentServiceKind.Managed])("%s unanswered approval expires into one terminal result without dispatch", async function _ExpiredJourney(agentKind)
	{
		const f = await _SeedConversationToolProposalSqlFixture({ agentKind, approvalRequired: true, runLifetimeMs: 1_500 });
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

	it.each([AgentServiceKind.Personal, AgentServiceKind.Managed])("%s requester can deny the saved approval before runtime admission", async function _DeniedJourney(agentKind)
	{
		const f = await _SeedConversationToolProposalSqlFixture({ agentKind, approvalRequired: true, secretArguments: true });
		const runtime = _ToolHandoffSqlRuntime(_First, f);
		_Runtimes.add(runtime);
		const owner = new PrismaConversationToolProposalUnitOfWork(_First, f.dependencies, runtime.admission, async function _ApprovalExpiry(transaction, command) { await new PrismaElicitationRepository(transaction as never).expireDue(command); });
		await owner.admit(f.turn, f.candidate, f.proposal, _WORKLOAD);
		const pending = await _First.toolInvocation.findFirstOrThrow({ where: { runId: f.runId } });
		const approval = await _First.approvalRequest.findFirstOrThrow({ where: { runId: f.runId } });
		const request = await _First.elicitationRequest.findUniqueOrThrow({ where: { id: approval.elicitationRequestId! } });
		expect(request.body).toMatchObject({ target: f.tool.name, externalSystem: f.serverName, proposedArguments: null, dataUse: expect.stringContaining("can only be denied") });
		expect(JSON.stringify(request.body)).not.toContain("sql-secret-never-visible");
		expect(approval.safeProposedArguments).toBeNull();
		const elicitation = new PrismaElicitationUnitOfWork(_First);
		await expect(elicitation.respond({ siloId: f.siloId, conversationId: f.turn.binding.conversationId, requestId: approval.elicitationRequestId!, subjectId: f.requesterPrincipalId, verifiedStepUpAt: new Date(), submission: { idempotencyKey: `approve-hidden-${f.runId}`, response: { kind: ElicitationBodyKinds.Approval, approved: true } }, now: new Date() })).resolves.toEqual({ outcome: "invalid_response" });
		await expect(elicitation.respond({ siloId: f.siloId, conversationId: f.turn.binding.conversationId, requestId: approval.elicitationRequestId!, subjectId: f.requesterPrincipalId, verifiedStepUpAt: new Date(), submission: { idempotencyKey: `deny-${f.runId}`, response: { kind: ElicitationBodyKinds.Approval, approved: false } }, now: new Date() })).resolves.toMatchObject({ outcome: "accepted" });
		const denied = await _First.toolInvocation.findUniqueOrThrow({ where: { id: pending.id } });
		expect(denied).toMatchObject({ state: ToolInvocationState.Failed, failureCode: "approval_denied" });
		expect(await _First.mcpRuntimeExecution.count({ where: { siloId: f.siloId } })).toBe(0);
		expect(await _First.toolResultDelivery.count({ where: { toolInvocationId: pending.id, state: ToolResultDeliveryState.Pending } })).toBe(1);
	});

	it("refuses another active participant's company approval without changing protected state", async function _WrongRequester()
	{
		const { fixture, approval, elicitation, wakes } = await _PendingManagedApproval();
		const otherPrincipalId = await _OtherParticipant(fixture);
		const before = await _ApprovalState(fixture, approval.id, approval.elicitationRequestId!);
		await expect(elicitation.readOwned(fixture.siloId, fixture.turn.binding.conversationId, approval.elicitationRequestId!, otherPrincipalId, new Date())).resolves.toBeNull();
		await expect(elicitation.respond({ siloId: fixture.siloId, conversationId: fixture.turn.binding.conversationId, requestId: approval.elicitationRequestId!, subjectId: otherPrincipalId, verifiedStepUpAt: new Date(), submission: { idempotencyKey: `wrong-requester-${fixture.runId}`, response: { kind: ElicitationBodyKinds.Approval, approved: true } }, now: new Date() })).resolves.toEqual({ outcome: "unauthorized" });
		expect(await _ApprovalState(fixture, approval.id, approval.elicitationRequestId!)).toEqual(before);
		expect(wakes).toEqual([]);
	});

	it("refuses the company requester's response after its exact Decide grant is revoked", async function _RevokedDecision()
	{
		const { fixture, approval, elicitation, wakes } = await _PendingManagedApproval();
		await _RevokeApprovalCapability(fixture, approval.id, ProductAuthorizationActions.Decide);
		const before = await _ApprovalState(fixture, approval.id, approval.elicitationRequestId!);
		await expect(elicitation.readOwned(fixture.siloId, fixture.turn.binding.conversationId, approval.elicitationRequestId!, fixture.requesterPrincipalId, new Date())).resolves.not.toBeNull();
		await expect(elicitation.respond({ siloId: fixture.siloId, conversationId: fixture.turn.binding.conversationId, requestId: approval.elicitationRequestId!, subjectId: fixture.requesterPrincipalId, verifiedStepUpAt: new Date(), submission: { idempotencyKey: `revoked-decide-${fixture.runId}`, response: { kind: ElicitationBodyKinds.Approval, approved: true } }, now: new Date() })).resolves.toEqual({ outcome: "unauthorized" });
		expect(await _ApprovalState(fixture, approval.id, approval.elicitationRequestId!)).toEqual(before);
		expect(wakes).toEqual([]);
	});

	it("hides a pending company approval from detail, open list and activity after Read revocation", async function _RevokedRead()
	{
		const { fixture, approval, elicitation, wakes } = await _PendingManagedApproval();
		const conversationId = fixture.turn.binding.conversationId;
		await expect(elicitation.readOwned(fixture.siloId, conversationId, approval.elicitationRequestId!, fixture.requesterPrincipalId, new Date())).resolves.not.toBeNull();
		await expect(elicitation.listOpenOwned(fixture.siloId, conversationId, fixture.requesterPrincipalId, new Date())).resolves.toHaveLength(1);
		await expect(elicitation.listActivityOwned(fixture.siloId, fixture.requesterPrincipalId, 20, new Date())).resolves.toHaveLength(1);
		await _RevokeApprovalCapability(fixture, approval.id, ProductAuthorizationActions.Read);
		const before = await _ApprovalState(fixture, approval.id, approval.elicitationRequestId!);
		await expect(elicitation.readOwned(fixture.siloId, conversationId, approval.elicitationRequestId!, fixture.requesterPrincipalId, new Date())).resolves.toBeNull();
		await expect(elicitation.listOpenOwned(fixture.siloId, conversationId, fixture.requesterPrincipalId, new Date())).resolves.toEqual([]);
		await expect(elicitation.listActivityOwned(fixture.siloId, fixture.requesterPrincipalId, 20, new Date())).resolves.toEqual([]);
		expect(await _ApprovalState(fixture, approval.id, approval.elicitationRequestId!)).toEqual(before);
		expect(wakes).toEqual([]);
	});
});

/** Open a real company approval while recording any attempted workflow resume. */
async function _PendingManagedApproval()
{
	const fixture = await _SeedConversationToolProposalSqlFixture({ agentKind: AgentServiceKind.Managed, approvalRequired: true });
	const runtime = _ToolHandoffSqlRuntime(_First, fixture);
	_Runtimes.add(runtime);
	const owner = new PrismaConversationToolProposalUnitOfWork(_First, fixture.dependencies, runtime.admission, async function _ApprovalExpiry(transaction, command) { await new PrismaElicitationRepository(transaction as never).expireDue(command); });
	await owner.admit(fixture.turn, fixture.candidate, fixture.proposal, _WORKLOAD);
	const approval = await _First.approvalRequest.findFirstOrThrow({ where: { runId: fixture.runId } });
	expect(approval).toMatchObject({ principalId: fixture.principalId, state: "Pending" });
	expect(fixture.principalId).not.toBe(fixture.requesterPrincipalId);
	const wakes: string[] = [];
	const elicitation = new PrismaElicitationUnitOfWork(_First, function _WakeFactory()
	{
		return { async wake(runId, attempt, toolInvocationId) { wakes.push(`${runId}:${attempt}:${toolInvocationId}`); } };
	});
	return { fixture, approval, elicitation, wakes };
}

/** Give another human normal conversation access without changing the frozen requester. */
async function _OtherParticipant(fixture: Awaited<ReturnType<typeof _SeedConversationToolProposalSqlFixture>>): Promise<string>
{
	const principalId = randomUUID();
	await _First.$transaction(async function _SeedOtherParticipant(transaction)
	{
		await transaction.principal.create({ data: { id: principalId, siloId: fixture.siloId, issuer: "https://identity.example.test", subject: principalId, provenance: PrincipalProvenance.External } });
		await transaction.orgMembership.create({ data: { clusterTenant: fixture.siloId, subject: principalId, role: OrgRole.Member } });
		await transaction.conversationParticipant.create({ data: { conversationId: fixture.turn.binding.conversationId, userId: principalId, visibleFromPosition: 1n, readThroughPosition: 0n } });
		const resource = { kind: ProductAuthorizationResourceKinds.Conversation, id: fixture.turn.binding.conversationId } as const;
		const grants = [ProductAuthorizationActions.Read, ProductAuthorizationActions.Use].map(function _Grant(action)
		{
			const capability = __ProductAuthorizationCapability(resource.kind, action)!;
			return { subject: { kind: AuthorizationSubjectKinds.Principal, principalId }, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability, resource, priority: 0, createdByPrincipalId: principalId } as const;
		});
		await new PrismaManagedAuthorizationGrantRepository(transaction).reconcileManagedResourceGrants({ siloId: fixture.siloId, managerId: `approval-sql-peer-${principalId}`, resource, grants, now: new Date() });
	});
	return principalId;
}

/** Revoke only one temporary approval capability, preserving the requester's other rights. */
async function _RevokeApprovalCapability(fixture: Awaited<ReturnType<typeof _SeedConversationToolProposalSqlFixture>>, approvalRequestId: string, action: ProductAuthorizationActions.Read | ProductAuthorizationActions.Decide): Promise<void>
{
	const capability = __ProductAuthorizationCapability(ProductAuthorizationResourceKinds.ApprovalRequest, action)!;
	const revoked = await _First.authorizationGrant.updateMany({ where: { siloId: fixture.siloId, subjectPrincipalId: fixture.requesterPrincipalId, resourceKind: ProductAuthorizationResourceKinds.ApprovalRequest, resourceId: approvalRequestId, capabilityId: capability.capabilityId, revokedAt: null }, data: { revokedAt: new Date() } });
	expect(revoked.count).toBe(1);
}

/** Read every durable projection that a rejected browser action must leave unchanged. */
async function _ApprovalState(fixture: Awaited<ReturnType<typeof _SeedConversationToolProposalSqlFixture>>, approvalRequestId: string, requestId: string)
{
	return {
		run: await _First.agentRun.findUniqueOrThrow({ where: { id: fixture.runId } }),
		approval: await _First.approvalRequest.findUniqueOrThrow({ where: { id: approvalRequestId } }),
		request: await _First.elicitationRequest.findUniqueOrThrow({ where: { id: requestId } }),
		invocations: await _First.toolInvocation.findMany({ where: { runId: fixture.runId }, orderBy: { id: "asc" } }),
		executions: await _First.mcpRuntimeExecution.findMany({ where: { siloId: fixture.siloId }, orderBy: { id: "asc" } }),
		responses: await _First.elicitationResponseAttempt.findMany({ where: { requestId }, orderBy: { id: "asc" } }),
		audits: await _First.auditDecision.findMany({ where: { siloId: fixture.siloId }, orderBy: { id: "asc" } }),
		grants: await _First.authorizationGrant.findMany({ where: { siloId: fixture.siloId, resourceKind: ProductAuthorizationResourceKinds.ApprovalRequest, resourceId: approvalRequestId }, orderBy: { id: "asc" } }),
	};
}

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
	return new PrismaConversationToolResultsUnitOfWork(_First, f.siloId, { load: async function _Load() { return _ResultTurn(f, invocation.toolInvocationId, invocation.requestFingerprint, resultDigest); } } as never, { admit: async function _Admit() {} }, f.dependencies, function _Files() { return { async read() { return { state: ConversationGeneratedFileResultStates.NotGenerated }; } }; });
}

function _ResultTurn(f: Awaited<ReturnType<typeof _SeedConversationToolProposalSqlFixture>>, proposalId: string, requestFingerprint: string, resultDigest: string): unknown
{
	const deadline = f.candidate.compiledInput.budget.wallClockDeadlineEpochMs;
	const first = f.turn.protocol.steps[0]!.reservation;
	const selected = _SelectConversationTurnTool(f.turn, { ordinal: first.ordinal, modelInvocationFence: first.invocationFence,
		proposalId, toolInvocationId: proposalId, requestFingerprint, declaration: { payloadRef: "payload-ref", ciphertextDigest: "sha256:cipher" } });
	if (resultDigest === "sha256:cipher")
		return selected;
	const ready = _RecordConversationTurnResult(selected, { ordinal: first.ordinal, proposalId, toolInvocationId: proposalId,
		resultDigest, authorityExpiresAtEpochMs: deadline, exchange: { payloadRef: "exchange-ref", ciphertextDigest: resultDigest } });
	const reservation = _ConversationTurnRequest(ready, { ordinal: 2, invocationFence: "continuation-fence", tools: ConversationModelToolModes.None,
		maxCompletionTokens: 128, authorityExpiresAtEpochMs: deadline, dispatchDeadlineEpochMs: deadline });
	return _ReserveConversationTurnModel(ready, reservation);
}
