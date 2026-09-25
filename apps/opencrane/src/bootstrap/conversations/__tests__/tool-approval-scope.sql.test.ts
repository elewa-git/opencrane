import { randomUUID } from "node:crypto";

import { AgentServiceKind, McpExecutionTransport, PrismaClient, ToolApprovalScopeState } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaElicitationRepository, PrismaElicitationUnitOfWork } from "@opencrane/backend/agents/execution/elicitation";
import { PrismaConversationToolProposalUnitOfWork } from "@opencrane/backend/server/conversations";
import { PrismaToolApprovalScopeUnitOfWork } from "@opencrane/backend/server/iam/authorization";
import { CONVERSATION_COMPUTER_PROJECTED_TOKEN_AUDIENCE, ElicitationApprovalScopes, ElicitationBodyKinds, ToolApprovalScopeStates } from "@opencrane/contracts";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { _ToolHandoffSqlRuntime } from "./conversation-tool-handoff.sql-fixture";
import { _SeedConversationToolProposalSqlFixture } from "./conversation-tool-proposal.sql-fixture";

const _DATABASE = new PrismaClient();
const _SECOND = new PrismaClient();
const _WORKLOAD = { subject: "system:serviceaccount:computers:computer", audience: CONVERSATION_COMPUTER_PROJECTED_TOKEN_AUDIENCE, namespace: "computers", serviceAccountName: "computer", workloadKind: "pod", workloadUid: "computer-pod-1", podUid: "computer-pod-1" } as const;

describe("requester-owned standing consent on fresh PostgreSQL", function _Suite()
{
	beforeAll(async function _Connect()
	{
		if (!process.env.DATABASE_URL)
			throw new Error("The standing consent SQL proof requires an isolated database with the fresh target baseline");
		await Promise.all([_DATABASE.$connect(), _SECOND.$connect()]);
	});

	afterAll(async function _Disconnect() { await Promise.all([_DATABASE.$disconnect(), _SECOND.$disconnect()]); });

	it.each([
		[AgentServiceKind.Personal, McpExecutionTransport.OciImage],
		[AgentServiceKind.Managed, McpExecutionTransport.OciImage],
		[AgentServiceKind.Personal, McpExecutionTransport.RemoteHttp],
		[AgentServiceKind.Managed, McpExecutionTransport.RemoteHttp],
	])("%s %s creates exact standing consent only after the first human decision", async function _FirstHumanApproval(agentKind, transport)
	{
		const pending = await _PendingApproval(agentKind, transport);
		const { fixture, approval, requestId, caller, authority } = pending;
		expect(await _DATABASE.toolApprovalScope.count({ where: { siloId: fixture.siloId } })).toBe(0);
		expect(await authority.list(caller, null, new Date())).toEqual({ scopes: [] });
		const opened = await pending.elicitation.readOwned(fixture.siloId, fixture.turn.binding.conversationId, requestId, fixture.requesterPrincipalId, new Date());
		expect(opened?.body).toMatchObject({ offeredScopes: [ElicitationApprovalScopes.Once, ElicitationApprovalScopes.Always], proposedArguments: fixture.proposal.arguments, standingScope: { explanation: expect.any(String) } });
		const executeGrantsBefore = await _DATABASE.authorizationGrant.count({ where: { siloId: fixture.siloId, resourceKind: { not: ProductAuthorizationResourceKinds.ApprovalRequest }, revokedAt: null } });
		await _ApproveAlways(pending);
		const scope = await _DATABASE.toolApprovalScope.findFirstOrThrow({ where: { siloId: fixture.siloId } });
		expect(scope).toMatchObject({ state: ToolApprovalScopeState.Active, revision: 0, requesterPrincipalId: fixture.requesterPrincipalId, requesterSubjectId: fixture.requesterPrincipalId, agentServiceId: fixture.turn.binding.agentServiceId, agentRevisionId: fixture.subject.runScope.agentRevisionId, toolRevisionId: fixture.proposal.toolRevisionId, reviewedArguments: fixture.proposal.arguments, argumentsDigest: ___DigestCanonicalJson(fixture.proposal.arguments), sourceApprovalRequestId: approval.id, routineId: null, routineRevision: null });
		if (transport === McpExecutionTransport.RemoteHttp)
			expect(scope).toMatchObject({ connectionId: expect.any(String), connectionGeneration: 1, connectionOwnerPrincipalId: fixture.principalId, connectionEndpointDigest: expect.any(String) });
		else
			expect(scope).toMatchObject({ connectionId: null, connectionGeneration: null, connectionOwnerPrincipalId: fixture.principalId, connectionEndpointDigest: null });
		expect(await _DATABASE.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } })).toMatchObject({ state: "Approved", decisionScope: "Always", decidedBy: fixture.requesterPrincipalId });
		expect(await _DATABASE.toolInvocation.findFirstOrThrow({ where: { runId: fixture.runId } })).toMatchObject({ approvalRequired: true, state: "Ready" });
		expect(await _DATABASE.elicitationResponseAttempt.count({ where: { requestId } })).toBe(1);
		expect(await _DATABASE.toolApprovalAdmission.count({ where: { scopeId: scope.id } })).toBe(0);
		expect(await _DATABASE.mcpRuntimeExecution.count({ where: { siloId: fixture.siloId } })).toBe(0);
		const grants = await _DATABASE.authorizationGrant.findMany({ where: { siloId: fixture.siloId, resourceKind: ProductAuthorizationResourceKinds.ToolApprovalScope, resourceId: scope.id, revokedAt: null } });
		expect(grants).toHaveLength(2);
		expect(grants.map(grant => grant.capabilityId).sort()).toEqual([ProductAuthorizationActions.Read, ProductAuthorizationActions.Revoke].map(action => __ProductAuthorizationCapability(ProductAuthorizationResourceKinds.ToolApprovalScope, action)!.capabilityId).sort());
		for (const grant of grants)
			expect(grant).toMatchObject({ subjectPrincipalId: fixture.requesterPrincipalId, boundaryPrincipalId: fixture.requesterPrincipalId, boundaryKind: "Personal", boundaryCoverage: "Exact" });
		expect(await _DATABASE.authorizationGrant.count({ where: { siloId: fixture.siloId, resourceKind: { not: ProductAuthorizationResourceKinds.ApprovalRequest }, revokedAt: null } })).toBe(executeGrantsBefore + 2);
		const page = await authority.list(caller, null, new Date());
		expect(page.scopes).toHaveLength(1);
		expect(page.scopes[0]).toMatchObject({ id: scope.id, state: ToolApprovalScopeStates.Active, target: fixture.tool.name, connectionOwnerLabel: fixture.executionOwnerLabel });
		expect(JSON.stringify(page)).not.toMatch(/reviewedArguments|argumentsDigest|endpointDigest|requesterSubjectId|sourceApprovalRequestId|scopeIdentityDigest/u);
		await expect(pending.elicitation.respond(_Response(pending, ElicitationApprovalScopes.Always))).resolves.toMatchObject({ outcome: "accepted", projection: { idempotent: true } });
		expect(await _DATABASE.toolApprovalScope.count({ where: { siloId: fixture.siloId } })).toBe(1);
	});

	it.each([true, false])("once-only decision approved=%s does not create standing consent", async function _OnceOnly(approved)
	{
		const pending = await _PendingApproval();
		const command = _Response(pending, ElicitationApprovalScopes.Once);
		await expect(pending.elicitation.respond({ ...command, submission: { ...command.submission, response: { ...command.submission.response, approved } } })).resolves.toMatchObject({ outcome: "accepted" });
		expect(await _DATABASE.toolApprovalScope.count({ where: { siloId: pending.fixture.siloId } })).toBe(0);
	});

	it("does not offer or accept standing consent when proposed arguments are hidden", async function _HiddenArguments()
	{
		const pending = await _PendingApproval(AgentServiceKind.Managed, McpExecutionTransport.OciImage, true);
		const request = await pending.elicitation.readOwned(pending.fixture.siloId, pending.fixture.turn.binding.conversationId, pending.requestId, pending.fixture.requesterPrincipalId, new Date());
		expect(request?.body).toMatchObject({ offeredScopes: [ElicitationApprovalScopes.Once] });
		expect(JSON.stringify(request)).not.toContain("sql-secret-never-visible");
		await expect(pending.elicitation.respond(_Response(pending, ElicitationApprovalScopes.Always))).resolves.toEqual({ outcome: "invalid_response" });
		expect(await _DATABASE.toolApprovalScope.count({ where: { siloId: pending.fixture.siloId } })).toBe(0);
		expect(await _DATABASE.elicitationResponseAttempt.count({ where: { requestId: pending.requestId } })).toBe(0);
	});

	it("allows withdrawal after Invoke is lost and preserves exact retry without restoring grants", async function _WithdrawAfterLosingInvoke()
	{
		const pending = await _PendingApproval();
		const scope = await _ApproveAlways(pending);
		const invoke = __ProductAuthorizationCapability(ProductAuthorizationResourceKinds.AgentService, ProductAuthorizationActions.Invoke)!;
		const lost = await _DATABASE.authorizationGrant.updateMany({ where: { siloId: pending.fixture.siloId, subjectPrincipalId: pending.fixture.requesterPrincipalId, resourceKind: ProductAuthorizationResourceKinds.AgentService, capabilityId: invoke.capabilityId, revokedAt: null }, data: { revokedAt: new Date() } });
		expect(lost.count).toBe(1);
		const key = randomUUID();
		await expect(pending.authority.revoke(pending.caller, scope.id, key, new Date())).resolves.toMatchObject({ outcome: "revoked", idempotent: false, scope: { id: scope.id, state: ToolApprovalScopeStates.Revoked } });
		const saved = await _DATABASE.toolApprovalScope.findUniqueOrThrow({ where: { id: scope.id } });
		expect(saved).toMatchObject({ state: ToolApprovalScopeState.Revoked, revision: scope.revision + 1, revokedByPrincipalId: pending.fixture.requesterPrincipalId });
		const grants = await _DATABASE.authorizationGrant.findMany({ where: { siloId: pending.fixture.siloId, resourceKind: ProductAuthorizationResourceKinds.ToolApprovalScope, resourceId: scope.id }, orderBy: { id: "asc" } });
		expect(grants.filter(grant => grant.revokedAt === null).map(grant => grant.capabilityId)).toEqual([__ProductAuthorizationCapability(ProductAuthorizationResourceKinds.ToolApprovalScope, ProductAuthorizationActions.Read)!.capabilityId]);
		await expect(new PrismaToolApprovalScopeUnitOfWork(_SECOND).revoke(pending.caller, scope.id, key, new Date())).resolves.toMatchObject({ outcome: "revoked", idempotent: true });
		await expect(pending.authority.revoke(pending.caller, scope.id, randomUUID(), new Date())).resolves.toEqual({ outcome: "conflict" });
		await expect(pending.elicitation.respond(_Response(pending, ElicitationApprovalScopes.Always))).resolves.toMatchObject({ outcome: "accepted", projection: { idempotent: true } });
		expect(await _DATABASE.toolApprovalScope.findUniqueOrThrow({ where: { id: scope.id } })).toEqual(saved);
		expect(await _DATABASE.authorizationGrant.findMany({ where: { siloId: pending.fixture.siloId, resourceKind: ProductAuthorizationResourceKinds.ToolApprovalScope, resourceId: scope.id }, orderBy: { id: "asc" } })).toEqual(grants);
	});

	it("concurrent identical withdrawals preserve one revocation and the same retry receipt", async function _ConcurrentWithdrawal()
	{
		const pending = await _PendingApproval();
		const scope = await _ApproveAlways(pending);
		const key = randomUUID();
		const outcomes = await Promise.all([
			pending.authority.revoke(pending.caller, scope.id, key, new Date()),
			new PrismaToolApprovalScopeUnitOfWork(_SECOND).revoke(pending.caller, scope.id, key, new Date()),
		]);
		expect(outcomes).toEqual(expect.arrayContaining([
			expect.objectContaining({ outcome: "revoked", idempotent: false }),
			expect.objectContaining({ outcome: "revoked", idempotent: true }),
		]));
		expect(await _DATABASE.toolApprovalScope.findUniqueOrThrow({ where: { id: scope.id } })).toMatchObject({ state: ToolApprovalScopeState.Revoked, revision: scope.revision + 1, activeIdentityDigest: null });
		const revoke = __ProductAuthorizationCapability(ProductAuthorizationResourceKinds.ToolApprovalScope, ProductAuthorizationActions.Revoke)!;
		expect(await _DATABASE.authorizationGrant.count({ where: { siloId: pending.fixture.siloId, resourceKind: ProductAuthorizationResourceKinds.ToolApprovalScope, resourceId: scope.id, capabilityId: revoke.capabilityId, revokedAt: null } })).toBe(0);
	});

	it("does not disclose or revoke another requester's scope", async function _ScopeIsolation()
	{
		const owner = await _PendingApproval();
		const stranger = await _PendingApproval();
		const scope = await _ApproveAlways(owner);
		await expect(owner.authority.list(stranger.caller, null, new Date())).resolves.toEqual({ scopes: [] });
		await expect(owner.authority.revoke(stranger.caller, scope.id, randomUUID(), new Date())).resolves.toEqual({ outcome: "not_found" });
		await expect(owner.authority.revoke({ ...owner.caller, subjectId: stranger.caller.subjectId }, scope.id, randomUUID(), new Date())).resolves.toEqual({ outcome: "not_found" });
		expect(await _DATABASE.toolApprovalScope.findUniqueOrThrow({ where: { id: scope.id } })).toEqual(scope);
	});

	it("honors current Read and Revoke independently without recreating either grant", async function _MetadataRevocation()
	{
		const pending = await _PendingApproval();
		const scope = await _ApproveAlways(pending);
		const read = __ProductAuthorizationCapability(ProductAuthorizationResourceKinds.ToolApprovalScope, ProductAuthorizationActions.Read)!;
		await _DATABASE.authorizationGrant.updateMany({ where: { siloId: pending.fixture.siloId, resourceKind: ProductAuthorizationResourceKinds.ToolApprovalScope, resourceId: scope.id, capabilityId: read.capabilityId, revokedAt: null }, data: { revokedAt: new Date() } });
		await expect(pending.authority.list(pending.caller, null, new Date())).resolves.toEqual({ scopes: [] });
		const revoke = __ProductAuthorizationCapability(ProductAuthorizationResourceKinds.ToolApprovalScope, ProductAuthorizationActions.Revoke)!;
		await _DATABASE.authorizationGrant.updateMany({ where: { siloId: pending.fixture.siloId, resourceKind: ProductAuthorizationResourceKinds.ToolApprovalScope, resourceId: scope.id, capabilityId: revoke.capabilityId, revokedAt: null }, data: { revokedAt: new Date() } });
		await expect(pending.authority.revoke(pending.caller, scope.id, randomUUID(), new Date())).resolves.toEqual({ outcome: "forbidden" });
		expect(await _DATABASE.authorizationGrant.count({ where: { siloId: pending.fixture.siloId, resourceKind: ProductAuthorizationResourceKinds.ToolApprovalScope, resourceId: scope.id, revokedAt: null } })).toBe(0);
		expect(await _DATABASE.toolApprovalScope.findUniqueOrThrow({ where: { id: scope.id } })).toEqual(scope);
	});

	it("rejects direct widening or reactivation of a saved human consent", async function _ImmutableScope()
	{
		const pending = await _PendingApproval();
		const scope = await _ApproveAlways(pending);
		const changed = { query: "another record never reviewed" };
		await expect(_DATABASE.toolApprovalScope.update({ where: { id: scope.id }, data: { reviewedArguments: changed, argumentsDigest: ___DigestCanonicalJson(changed) } })).rejects.toThrow();
		expect(await _DATABASE.toolApprovalScope.findUniqueOrThrow({ where: { id: scope.id } })).toEqual(scope);
		await expect(pending.authority.revoke(pending.caller, scope.id, randomUUID(), new Date())).resolves.toMatchObject({ outcome: "revoked" });
		const revoked = await _DATABASE.toolApprovalScope.findUniqueOrThrow({ where: { id: scope.id } });
		await expect(_DATABASE.toolApprovalScope.update({ where: { id: scope.id }, data: { state: ToolApprovalScopeState.Active, revision: scope.revision, revokedAt: null, revokedByPrincipalId: null, revocationIdempotencyDigest: null, revocationCommandDigest: null } })).rejects.toThrow();
		await expect(_DATABASE.toolApprovalScope.delete({ where: { id: scope.id } })).rejects.toThrow();
		expect(await _DATABASE.toolApprovalScope.findUniqueOrThrow({ where: { id: scope.id } })).toEqual(revoked);
	});

	it("rejects standing evidence attached to a different silo's invocation", async function _AdmissionIsolation()
	{
		const owner = await _PendingApproval();
		const stranger = await _PendingApproval();
		const scope = await _ApproveAlways(owner);
		const invocation = await _DATABASE.toolInvocation.findFirstOrThrow({ where: { runId: stranger.fixture.runId } });
		await expect(_DATABASE.toolApprovalAdmission.create({ data: { scopeId: scope.id, scopeRevision: scope.revision, toolInvocationId: invocation.id, argumentsDigest: invocation.argumentsDigest } })).rejects.toThrow();
		expect(await _DATABASE.toolApprovalAdmission.count({ where: { scopeId: scope.id } })).toBe(0);
	});

	it("consumes a later matching effect's standing admission with its real dispatch claim", async function _StandingDispatch()
	{
		const pending = await _PendingApproval(AgentServiceKind.Managed, McpExecutionTransport.OciImage, false, 2);
		const scope = await _ApproveAlways(pending);
		const future = await _FutureProposal(pending);
		expect(future.invocation).toMatchObject({ approvalRequired: true, state: "Ready" });
		const admission = await _DATABASE.toolApprovalAdmission.findUniqueOrThrow({ where: { toolInvocationId: future.invocation.id } });
		expect(admission).toMatchObject({ scopeId: scope.id, scopeRevision: scope.revision, origin: "StandingConsent", consumedAt: null, consumedClaimFence: null });
		expect(await _DATABASE.approvalRequest.count({ where: { runId: pending.fixture.runId } })).toBe(1);
		expect(await _DATABASE.elicitationResponseAttempt.count({ where: { requestId: pending.requestId } })).toBe(1);
		const registered = await pending.runtime.register();
		if (registered === null)
			throw new Error("The matching protected invocation must have an executor");
		const claimed = await pending.runtime.authority.claimCompanion(registered.identity, registered.executionReference);
		if (claimed === null || typeof claimed === "string" || claimed.command.kind !== "invocation")
			throw new Error("The matching standing consent must permit its first dispatch claim");
		const claimedInvocation = await _DATABASE.toolInvocation.findUniqueOrThrow({ where: { id: future.invocation.id } });
		expect(claimedInvocation).toMatchObject({ state: "Claimed", claimFence: future.invocation.claimFence + 1 });
		expect(await _DATABASE.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: claimed.command.executionId } })).toMatchObject({ toolInvocationId: future.invocation.id, toolInvocationClaimFence: claimedInvocation.claimFence, companionClaimFence: claimed.command.claimFence });
		const consumed = await _DATABASE.toolApprovalAdmission.findUniqueOrThrow({ where: { id: admission.id } });
		expect(consumed).toMatchObject({ consumedAt: expect.any(Date), consumedClaimFence: claimedInvocation.claimFence });
		await expect(_DATABASE.toolApprovalAdmission.update({ where: { id: admission.id }, data: { consumedAt: null, consumedClaimFence: null } })).rejects.toThrow();
		expect(await _DATABASE.toolApprovalAdmission.findUniqueOrThrow({ where: { id: admission.id } })).toEqual(consumed);
		expect(await _DATABASE.toolInvocation.findUniqueOrThrow({ where: { id: future.invocation.id } })).toEqual(claimedInvocation);
	});

	it("revocation after matching preparation prevents the later dispatch claim", async function _RevokeBeforeClaim()
	{
		const pending = await _PendingApproval(AgentServiceKind.Managed, McpExecutionTransport.OciImage, false, 2);
		const scope = await _ApproveAlways(pending);
		const future = await _FutureProposal(pending);
		await expect(pending.authority.revoke(pending.caller, scope.id, randomUUID(), new Date())).resolves.toMatchObject({ outcome: "revoked" });
		const registered = await pending.runtime.register();
		if (registered === null)
			throw new Error("The prepared invocation must have a controller assignment");
		const result = await pending.runtime.authority.claimCompanion(registered.identity, registered.executionReference);
		expect(result === null || typeof result === "string").toBe(true);
		expect(await _DATABASE.toolInvocation.findUniqueOrThrow({ where: { id: future.invocation.id } })).toMatchObject({ state: "Failed" });
		expect(await _DATABASE.toolApprovalAdmission.findUniqueOrThrow({ where: { toolInvocationId: future.invocation.id } })).toMatchObject({ consumedAt: null, consumedClaimFence: null });
	});

	it("a changed argument requires a fresh human approval despite an active scope", async function _ChangedArguments()
	{
		const pending = await _PendingApproval(AgentServiceKind.Managed, McpExecutionTransport.OciImage, false, 2);
		await _ApproveAlways(pending);
		const future = await _FutureProposal(pending, { query: "a different reviewed record" });
		expect(future.invocation).toMatchObject({ approvalRequired: true, state: "AwaitingApproval" });
		expect(await _DATABASE.toolApprovalAdmission.findUnique({ where: { toolInvocationId: future.invocation.id } })).toBeNull();
		expect(await _DATABASE.approvalRequest.count({ where: { runId: pending.fixture.runId, state: "Pending" } })).toBe(1);
	});

	it("fresh human consent creates a new active scope without reopening revoked history", async function _ApproveAgainAfterRevocation()
	{
		const pending = await _PendingApproval(AgentServiceKind.Managed, McpExecutionTransport.OciImage, false, 2);
		const scope = await _ApproveAlways(pending);
		await pending.authority.revoke(pending.caller, scope.id, randomUUID(), new Date());
		const revoked = await _DATABASE.toolApprovalScope.findUniqueOrThrow({ where: { id: scope.id } });
		const future = await _FutureProposal(pending);
		expect(future.invocation.state).toBe("AwaitingApproval");
		const approval = await _DATABASE.approvalRequest.findFirstOrThrow({ where: { toolInvocationRowId: future.invocation.id } });
		if (approval.elicitationRequestId === null)
			throw new Error("Renewing revoked consent must ask the human again");
		const response = _Response({ ...pending, approval, requestId: approval.elicitationRequestId }, ElicitationApprovalScopes.Always);
		await expect(pending.elicitation.respond(response)).resolves.toMatchObject({ outcome: "accepted", projection: { idempotent: false } });
		const active = await _DATABASE.toolApprovalScope.findFirstOrThrow({ where: { siloId: pending.fixture.siloId, state: ToolApprovalScopeState.Active } });
		expect(active.id).not.toBe(scope.id);
		expect(active.sourceApprovalRequestId).toBe(approval.id);
		expect(await _DATABASE.toolApprovalScope.findUniqueOrThrow({ where: { id: scope.id } })).toEqual(revoked);
	});
});

/** Use real admission and response owners without starting a provider or a workflow runner. */
async function _PendingApproval(agentKind: AgentServiceKind = AgentServiceKind.Managed, transport: McpExecutionTransport = McpExecutionTransport.OciImage, secretArguments = false, maximumToolInvocations = 1)
{
	const fixture = await _SeedConversationToolProposalSqlFixture({ agentKind, transport, approvalRequired: true, secretArguments, maximumToolInvocations });
	const runtime = _ToolHandoffSqlRuntime(_DATABASE, fixture);
	const owner = new PrismaConversationToolProposalUnitOfWork(_DATABASE, fixture.dependencies, runtime.admission, async function _Expire(transaction, command) { await new PrismaElicitationRepository(transaction as never).expireDue(command); });
	await owner.admit(fixture.turn, fixture.candidate, fixture.proposal, _WORKLOAD);
	const approval = await _DATABASE.approvalRequest.findFirstOrThrow({ where: { runId: fixture.runId } });
	if (approval.elicitationRequestId === null)
		throw new Error("The first protected effect must open its human approval");
	return { fixture, approval, requestId: approval.elicitationRequestId, elicitation: new PrismaElicitationUnitOfWork(_DATABASE), authority: new PrismaToolApprovalScopeUnitOfWork(_DATABASE), caller: { siloId: fixture.siloId, subjectId: fixture.requesterPrincipalId }, owner, runtime };
}

/** Admit a synthetic second model proposal under the original snapshot's pre-reserved budget. */
async function _FutureProposal(pending: Awaited<ReturnType<typeof _PendingApproval>>, argumentsValue = pending.fixture.proposal.arguments)
{
	const current = pending.fixture.turn.protocol.steps[0];
	if (current === undefined)
		throw new Error("The fixture needs its original model reservation");
	const turn = { ...pending.fixture.turn, protocol: { ...pending.fixture.turn.protocol, steps: [{ ...current, reservation: { ...current.reservation, ordinal: 2, invocationFence: randomUUID() } }] } };
	const candidate = { ...pending.fixture.candidate, protocol: turn.protocol };
	const receipt = await pending.owner.admit(turn, candidate, { ...pending.fixture.proposal, arguments: argumentsValue }, _WORKLOAD);
	const invocation = await _DATABASE.toolInvocation.findUniqueOrThrow({ where: { runId_attempt_toolInvocationId: { runId: pending.fixture.runId, attempt: 1, toolInvocationId: receipt.proposalId } } });
	return { invocation, turn, candidate };
}

function _Response(pending: Awaited<ReturnType<typeof _PendingApproval>>, scope: ElicitationApprovalScopes)
{
	return { siloId: pending.fixture.siloId, conversationId: pending.fixture.turn.binding.conversationId, requestId: pending.requestId, subjectId: pending.fixture.requesterPrincipalId, verifiedStepUpAt: new Date(), submission: { idempotencyKey: `standing-${pending.fixture.runId}`, response: { kind: ElicitationBodyKinds.Approval, approved: true, scope } as const }, now: new Date() };
}

async function _ApproveAlways(pending: Awaited<ReturnType<typeof _PendingApproval>>)
{
	await expect(pending.elicitation.respond(_Response(pending, ElicitationApprovalScopes.Always))).resolves.toMatchObject({ outcome: "accepted", projection: { idempotent: false } });
	return _DATABASE.toolApprovalScope.findFirstOrThrow({ where: { siloId: pending.fixture.siloId } });
}
