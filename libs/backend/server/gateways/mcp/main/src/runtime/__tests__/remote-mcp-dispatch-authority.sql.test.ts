import { randomUUID } from "node:crypto";

import { ExternalActionClaimKind, ExternalActionRecoveryMode, McpApprovalStatus, McpConnectionCredentialKind, McpConnectionState, McpConnectionStatus, McpCredentialRequirement as PrismaMcpCredentialRequirement, McpExecutionTransport, McpExecutorCommandState, McpInstallState, McpRuntimeExecutionKind, McpServerStatus, McpServerTransport, McpTaskState, OrgRole, PrincipalProvenance, Prisma, PrismaClient, ToolInvocationState } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { __CreatePrismaMcpToolInvocationParticipantFactory, PrismaAuthorizationAuthority, PrismaManagedAuthorizationGrantRepository, ToolInvocationRunRecoveryEnterResults } from "@opencrane/backend/server/iam/authorization";
import { MCP_PROTOCOL_VERSION, MCP_SERVER_PROJECTED_TOKEN_AUDIENCE, McpConnectionCredentialKinds, McpCredentialRequirement } from "@opencrane/contracts";
import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationSubjectKinds, ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { McpRemoteRevisionFinalizationOutcomes, type McpRemoteRevisionFinalizationCommand } from "../../connections/discovery/mcp-authenticated-connection-discovery.types";
import { PrismaMcpRemoteRevisionFinalizationRepository } from "../../connections/discovery/prisma-mcp-remote-revision-finalizer";
import { __McpConnectionEndpointDigest, __McpConnectionGrantManagerId } from "../../connections/mcp-connection-digests";
import { McpConnectionStates, type McpConnectionRecord } from "../../connections/mcp-connection.types";
import { PrismaMcpTaskToolInvocationLifecycleRepository } from "../../mcp-tasks/prisma-mcp-task-tool-invocation-lifecycle";
import { PrismaMcpRuntimeControllerRepository } from "../prisma-mcp-runtime-controller-repository";
import { PrismaRemoteMcpDispatchUnitOfWork } from "../prisma-remote-mcp-dispatch-unit-of-work";
import type { McpInvocationResultParticipantFactory } from "../mcp-invocation-result.types";
import { McpInvocationOwnerKinds, RemoteMcpDispatchClaimOutcomes, type McpInvocationDispatchTarget } from "../remote-mcp-invocation.types";

const _Client = new PrismaClient();
const _LEASE_MILLISECONDS = 30_000;
/** Strict remote result accepted by the shared completion participant seam. */
const _RESULT = { isError: false, content: [{ type: "text" as const, text: "remote SQL result" }] };

/** Build the real ToolInvocation participant; run-only collaborators must remain unused. */
function _Participants()
{
	return __CreatePrismaMcpToolInvocationParticipantFactory(
		{ async appendInTransaction(): Promise<boolean> { throw new Error("remote task SQL proof attempted a run event"); } },
		{ async appendInTransaction(): Promise<boolean> { throw new Error("remote task SQL proof attempted a recovery event"); } },
		{ async enterRecoveryRequiredInTransaction() { return ToolInvocationRunRecoveryEnterResults.Conflict; }, async resumeRunningInTransaction(): Promise<boolean> { throw new Error("remote task SQL proof attempted run recovery"); } },
		{ async admitUntilInTransaction(): Promise<number | null> { throw new Error("remote task SQL proof attempted run dispatch admission"); } },
	);
}

/** Preserve ordinary SQL fixture results through the production completion participant seam. */
function _InvocationResults(): McpInvocationResultParticipantFactory
{
	return { __ForTransaction: function _ForTransaction()
	{
		return { prepare: async function _Prepare(command) { return command.result; } };
	} };
}

/** Seed and activate one credentialless remote connection through its production finalizer. */
async function _ConnectionFixture()
{
	const siloId = `mcp-remote-runtime-${randomUUID()}`;
	const principalId = randomUUID();
	const otherPrincipalId = randomUUID();
	const serverId = randomUUID();
	const installId = randomUUID();
	const connectionId = randomUUID();
	const endpoint = "https://mcp.example.test/stream";
	const endpointDigest = __McpConnectionEndpointDigest(endpoint);
	const taskId = randomUUID();
	const taskKey = `mcp-connection-activate-${connectionId}`;
	const record: McpConnectionRecord = {
		id: connectionId, siloId, installId, serverId, ownerPrincipalId: principalId, actorPrincipalId: principalId, agentServiceId: null, generation: 1,
		credentialRequirement: McpCredentialRequirement.Credentialless, credentialKind: McpConnectionCredentialKinds.None, endpointDigest, state: McpConnectionStates.Activating,
		requestKeyDigest: ___DigestCanonicalJson({ connectionId, kind: "request" }), commandDigest: ___DigestCanonicalJson({ connectionId, kind: "command" }), materialVerifier: null, materialVerifierKeyId: null,
		authorizationDecisionDigest: ___DigestCanonicalJson({ connectionId, kind: "admission" }), secretRef: null, secretUid: null, secretResourceVersion: null, credentialCustodiedAt: null,
		task: { taskId, taskName: "mcp-connection.activate/v1", taskKey }, revokeKeyDigest: null, revokeDecisionDigest: null, revokeTask: null,
		failureCode: null, activatedAt: null, revokedAt: null, cleanupCompletedAt: null,
	};
	await _Client.$transaction(async function _Seed(transaction)
	{
		const clock = await transaction.mcpRuntimeClock.findUniqueOrThrow({ where: { singleton: 1 } });
		await transaction.principal.createMany({ data: [
			{ id: principalId, siloId, issuer: "https://mcp-runtime.example", subject: principalId, provenance: PrincipalProvenance.External },
			{ id: otherPrincipalId, siloId, issuer: "https://mcp-runtime.example", subject: otherPrincipalId, provenance: PrincipalProvenance.External },
		] });
		await transaction.orgMembership.create({ data: { clusterTenant: siloId, subject: principalId, role: OrgRole.Member } });
		await transaction.mcpServer.create({ data: { id: serverId, siloId, name: serverId, endpoint, transport: McpServerTransport.StreamableHttp, credentialRequirement: PrismaMcpCredentialRequirement.Credentialless, status: McpServerStatus.Active, approvalStatus: McpApprovalStatus.Published } });
		await transaction.mcpServerInstall.create({ data: { id: installId, mcpServerId: serverId, principalId, lifecycleState: McpInstallState.Installed, connectionStatus: McpConnectionStatus.Activating } });
		await transaction.mcpConnection.create({ data: {
			id: connectionId, siloId, mcpServerInstallId: installId, mcpServerId: serverId, ownerPrincipalId: principalId, actorPrincipalId: principalId,
			generation: 1, credentialRequirement: PrismaMcpCredentialRequirement.Credentialless, credentialKind: McpConnectionCredentialKind.None, endpointDigest, state: McpConnectionState.Activating,
			requestKeyDigest: record.requestKeyDigest, commandDigest: record.commandDigest, authorizationDecisionDigest: record.authorizationDecisionDigest, taskId, taskName: record.task.taskName, taskKey,
		} });
		const resource = { kind: ProductAuthorizationResourceKinds.ProviderConnection, id: connectionId } as const;
		const capability = __ProductAuthorizationCapability(resource.kind, ProductAuthorizationActions.Use);
		if (capability === null)
			throw new Error("remote runtime SQL proof requires ProviderConnection Use");
		const grants = new PrismaManagedAuthorizationGrantRepository(transaction);
		await grants.reconcileManagedResourceGrants({ siloId, managerId: __McpConnectionGrantManagerId(connectionId), resource, grants: [{ subject: { kind: AuthorizationSubjectKinds.Principal, principalId }, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability, resource, priority: 100, createdByPrincipalId: principalId }], now: clock.now });
	}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	const command: McpRemoteRevisionFinalizationCommand = {
		record,
		task: { taskId, taskName: record.task.taskName, idempotencyKey: taskKey },
		protocolVersion: MCP_PROTOCOL_VERSION,
		discoveryEvidenceDigest: ___DigestCanonicalJson({ connectionId, kind: "discover" }),
		discoveryDigest: ___DigestCanonicalJson({ connectionId, kind: "tools" }),
		tools: [{ name: "records.read", description: "Read records", inputSchema: { type: "object", properties: {}, additionalProperties: false } }],
	};
	const finalized = await _Client.$transaction(async function _Finalize(transaction)
	{
		const finalizer = new PrismaMcpRemoteRevisionFinalizationRepository(transaction, new PrismaAuthorizationAuthority(transaction), new PrismaManagedAuthorizationGrantRepository(transaction));
		return finalizer.finalize(command);
	}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	if (finalized.outcome !== McpRemoteRevisionFinalizationOutcomes.Completed || finalized.serverRevisionId === undefined)
		throw new Error("remote runtime SQL proof could not activate its connection revision");
	const tool = await _Client.mcpToolRevision.findFirstOrThrow({ where: { siloId, serverRevisionId: finalized.serverRevisionId, name: "records.read" } });
	return { siloId, principalId, otherPrincipalId, serverId, installId, connectionId, endpointDigest, serverRevisionId: finalized.serverRevisionId, toolRevisionId: tool.id };
}

/** Add one Ready task-owned ToolInvocation without creating its runtime row. */
async function _InvocationFixture()
{
	const connection = await _ConnectionFixture();
	const mcpTaskId = randomUUID();
	const invocationId = randomUUID();
	const publicInvocationId = `mcp-task-call:${mcpTaskId}`;
	const argumentsValue = {};
	const argumentsDigest = ___DigestCanonicalJson(argumentsValue);
	const coordinate = { resource: { kind: ProductAuthorizationResourceKinds.McpToolRevision, id: connection.toolRevisionId }, action: ProductAuthorizationActions.Invoke };
	const decisionDigest = ___DigestCanonicalJson({ mcpTaskId, decision: "allow" });
	const requestIdentity = { runtimeInstanceId: `mcp-task:${mcpTaskId}`, commandId: mcpTaskId, candidateId: mcpTaskId };
	await _Client.$transaction(async function _SeedInvocation(transaction)
	{
		const clock = await transaction.mcpRuntimeClock.findUniqueOrThrow({ where: { singleton: 1 } });
		await transaction.mcpTask.create({ data: {
			id: mcpTaskId, siloId: connection.siloId, principalId: connection.principalId, requestKeyDigest: ___DigestCanonicalJson({ mcpTaskId, kind: "request" }), callDigest: ___DigestCanonicalJson({ mcpTaskId, kind: "call" }),
			serverRevisionId: connection.serverRevisionId, toolRevisionId: connection.toolRevisionId, protocolVersion: MCP_PROTOCOL_VERSION, transport: McpExecutionTransport.RemoteHttp,
			connectionId: connection.connectionId, connectionGeneration: 1, connectionOwnerPrincipalId: connection.principalId, endpointDigest: connection.endpointDigest,
			arguments: argumentsValue, state: McpTaskState.Working,
		} });
		await transaction.toolInvocation.create({ data: {
			id: invocationId, siloId: connection.siloId, mcpTaskId, principalId: connection.principalId, authorizationCoordinates: [coordinate], authorizationDecisionDigests: [decisionDigest],
			authorizationEvidenceDigest: ___DigestCanonicalJson({ mcpTaskId, principalId: connection.principalId, coordinate, decisionDigest }), runtimeInstanceId: requestIdentity.runtimeInstanceId,
			commandId: requestIdentity.commandId, candidateId: requestIdentity.candidateId, toolRevisionId: connection.toolRevisionId, toolInvocationId: publicInvocationId,
			arguments: argumentsValue, argumentsDigest, effectiveArguments: argumentsValue, effectiveArgumentsDigest: argumentsDigest, requestFingerprint: ___DigestCanonicalJson([mcpTaskId, argumentsDigest]),
			requestIdentity, approvalRequired: false, recoveryMode: ExternalActionRecoveryMode.Manual, state: ToolInvocationState.Preparing, createdAt: clock.now, retryDeadlineAt: new Date(clock.now.getTime() + 300_000), nextPreparationAttemptAt: clock.now,
		} });
		await transaction.toolInvocation.update({ where: { id: invocationId }, data: { state: ToolInvocationState.Ready, preparationAttempt: { increment: 1 }, revision: { increment: 1 } } });
		await transaction.mcpTask.update({ where: { id: mcpTaskId }, data: { state: McpTaskState.Queued } });
	});
	const target: McpInvocationDispatchTarget = { ownerKind: McpInvocationOwnerKinds.McpTask, siloId: connection.siloId, mcpTaskId, toolInvocationId: publicInvocationId };
	return { ...connection, mcpTaskId, invocationId, publicInvocationId, target };
}

/** Build one valid unused remote execution tied to an exact connection generation. */
function _RuntimeData(fixture: Awaited<ReturnType<typeof _InvocationFixture>>)
{
	const executionId = randomUUID();
	return {
		id: executionId,
		siloId: fixture.siloId,
		serverRevisionId: fixture.serverRevisionId,
		toolInvocationId: fixture.invocationId,
		kind: McpRuntimeExecutionKind.Invocation,
		transport: McpExecutionTransport.RemoteHttp,
		connectionId: fixture.connectionId,
		connectionGeneration: 1,
		connectionOwnerPrincipalId: fixture.principalId,
		endpointDigest: fixture.endpointDigest,
		credentialSecretUid: null,
		credentialSecretResourceVersion: null,
		workloadState: null,
		profileName: null,
		idempotencyKey: `mcp-remote-invocation:${executionId}`,
		executionReference: `mcp-remote-v1_${randomUUID()}`,
	} satisfies Prisma.McpRuntimeExecutionUncheckedCreateInput;
}

/** Insert the valid Pending runtime required by production dispatch. */
async function _CreateRuntime(fixture: Awaited<ReturnType<typeof _InvocationFixture>>): Promise<string>
{
	const data = _RuntimeData(fixture);
	await _Client.mcpRuntimeExecution.create({ data });
	return data.id;
}

/** Construct the production remote dispatch transaction owner. */
function _Dispatch(client: PrismaClient = _Client): PrismaRemoteMcpDispatchUnitOfWork
{
	return new PrismaRemoteMcpDispatchUnitOfWork(client, _Participants(), _InvocationResults(), _LEASE_MILLISECONDS);
}

/** Verified server identity used only as authorization evidence in this disposable proof. */
const _WORKLOAD = {
	audience: MCP_SERVER_PROJECTED_TOKEN_AUDIENCE,
	namespace: "opencrane",
	serviceAccountName: "opencrane-server",
	workloadKind: "pod",
	workloadUid: "opencrane-server-pod",
	podUid: "opencrane-server-pod",
} as const;

describe("remote MCP dispatch authority on the fresh PostgreSQL baseline", function _Suite()
{
	beforeAll(async function _Connect()
	{
		if (!process.env.DATABASE_URL)
			throw new Error("remote MCP runtime SQL proof requires DATABASE_URL and the proposed fresh target baseline");
		await _Client.$connect();
	});
	afterAll(async function _Disconnect() { await _Client.$disconnect(); });

	it("rejects null and stale task or runtime connection coordinates", async function _RejectsInvalidIdentity()
	{
		const fixture = await _InvocationFixture();
		await expect(_Client.mcpServerRevision.create({ data: {
			siloId: fixture.siloId, mcpServerId: fixture.serverId, revision: 2, transport: McpExecutionTransport.RemoteHttp,
			connectionId: null, connectionGeneration: 1, connectionOwnerPrincipalId: fixture.principalId, endpointDigest: fixture.endpointDigest,
			discoveryEvidenceDigest: ___DigestCanonicalJson({ missing: "connection" }), discoveryDigest: ___DigestCanonicalJson({ revision: 2 }),
		} })).rejects.toThrow(/mcp_server_revisions_transport_identity_check/u);
		await expect(_Client.mcpServerRevision.create({ data: {
			siloId: fixture.siloId, mcpServerId: fixture.serverId, revision: 2, transport: McpExecutionTransport.RemoteHttp,
			connectionId: fixture.connectionId, connectionGeneration: 1, connectionOwnerPrincipalId: fixture.principalId, endpointDigest: fixture.endpointDigest,
			discoveryEvidenceDigest: null, discoveryDigest: ___DigestCanonicalJson({ revision: 2 }),
		} })).rejects.toThrow(/mcp_server_revisions_transport_identity_check/u);
		await expect(_Client.mcpServerRevision.create({ data: {
			siloId: fixture.siloId, mcpServerId: fixture.serverId, revision: 2, transport: McpExecutionTransport.RemoteHttp,
			connectionId: fixture.connectionId, connectionGeneration: 1, connectionOwnerPrincipalId: fixture.principalId, endpointDigest: fixture.endpointDigest,
			discoveryEvidenceDigest: ___DigestCanonicalJson({ revision: 2 }), discoveryDigest: null,
		} })).rejects.toThrow(/mcp_server_revisions_transport_identity_check/u);
		const taskId = randomUUID();
		await expect(_Client.mcpTask.create({ data: {
			id: taskId, siloId: fixture.siloId, principalId: fixture.principalId, requestKeyDigest: ___DigestCanonicalJson({ taskId, kind: "request" }), callDigest: ___DigestCanonicalJson({ taskId, kind: "call" }),
			serverRevisionId: fixture.serverRevisionId, toolRevisionId: fixture.toolRevisionId, protocolVersion: MCP_PROTOCOL_VERSION, transport: McpExecutionTransport.RemoteHttp,
			connectionId: null, connectionGeneration: 1, connectionOwnerPrincipalId: fixture.principalId, endpointDigest: fixture.endpointDigest, arguments: {},
		} })).rejects.toThrow(/mcp_tasks_transport_identity_check/u);

		const runtime = _RuntimeData(fixture);
		await expect(_Client.mcpRuntimeExecution.create({ data: { ...runtime, connectionId: null } })).rejects.toThrow(/mcp_runtime_executions_transport_identity_check/u);
		await expect(_Client.mcpRuntimeExecution.create({ data: { ...runtime, credentialSecretUid: "stale-uid", credentialSecretResourceVersion: null } })).rejects.toThrow(/mcp_runtime_executions_transport_identity_check/u);
		await expect(_Client.mcpRuntimeExecution.create({ data: { ...runtime, id: randomUUID(), idempotencyKey: `stale-owner-${randomUUID()}`, executionReference: `mcp-remote-v1_${randomUUID()}`, connectionOwnerPrincipalId: fixture.otherPrincipalId } })).rejects.toThrow();
		await expect(_Client.mcpRuntimeExecution.create({ data: { ...runtime, id: randomUUID(), idempotencyKey: `stale-generation-${randomUUID()}`, executionReference: `mcp-remote-v1_${randomUUID()}`, connectionGeneration: 2 } })).rejects.toThrow();
		await expect(_Client.mcpRuntimeExecution.create({ data: { ...runtime, id: randomUUID(), idempotencyKey: `stale-secret-${randomUUID()}`, executionReference: `mcp-remote-v1_${randomUUID()}`, credentialSecretUid: "stale-uid", credentialSecretResourceVersion: "stale-version" } })).rejects.toThrow(/exact Active connection/u);
	});

	it("uses the database clock for a remote claim and prevents a live restart claim", async function _ClaimsOnce()
	{
		const fixture = await _InvocationFixture();
		const executionId = await _CreateRuntime(fixture);
		const before = await _Client.mcpRuntimeClock.findUniqueOrThrow({ where: { singleton: 1 } });
		const first = await _Dispatch().claim({ target: fixture.target, workload: _WORKLOAD });
		const after = await _Client.mcpRuntimeClock.findUniqueOrThrow({ where: { singleton: 1 } });

		expect(first.outcome).toBe(RemoteMcpDispatchClaimOutcomes.Claimed);
		const execution = await _Client.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: executionId } });
		expect(execution).toMatchObject({ commandState: McpExecutorCommandState.Claimed, claimedAt: null, claimExpiresAt: null, deliveryCount: 0, workloadState: null, profileName: null });
		expect(execution.remoteClaimExpiresAt?.getTime()).toBeGreaterThanOrEqual(before.now.getTime() + _LEASE_MILLISECONDS);
		expect(execution.remoteClaimExpiresAt?.getTime()).toBeLessThanOrEqual(after.now.getTime() + _LEASE_MILLISECONDS);
		await expect(_Dispatch().claim({ target: fixture.target, workload: _WORKLOAD })).resolves.toEqual({ outcome: RemoteMcpDispatchClaimOutcomes.Unavailable });
		await expect(_Client.toolInvocation.findUniqueOrThrow({ where: { id: fixture.invocationId } })).resolves.toMatchObject({ state: ToolInvocationState.Claimed, claimKind: ExternalActionClaimKind.Dispatch });
	});

	it("denies new work while Removing and still settles a claim that won first", async function _FencesRemovalRace()
	{
		const denied = await _InvocationFixture();
		const deniedExecutionId = await _CreateRuntime(denied);
		await _Client.mcpServerInstall.update({ where: { id: denied.installId }, data: { lifecycleState: McpInstallState.Removing } });

		await expect(_Dispatch().claim({ target: denied.target, workload: _WORKLOAD })).resolves.toEqual({ outcome: RemoteMcpDispatchClaimOutcomes.Denied });
		await expect(_Client.toolInvocation.findUniqueOrThrow({ where: { id: denied.invocationId } })).resolves.toMatchObject({ state: ToolInvocationState.Failed, claimKind: null });
		await expect(_Client.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: deniedExecutionId } })).resolves.toMatchObject({ commandState: McpExecutorCommandState.Failed, remoteClaimFence: null });

		const settling = await _InvocationFixture();
		const settlingExecutionId = await _CreateRuntime(settling);
		const claimed = await _Dispatch().claim({ target: settling.target, workload: _WORKLOAD });
		if (claimed.outcome !== RemoteMcpDispatchClaimOutcomes.Claimed || claimed.claim === undefined)
			throw new Error("remote removal race proof did not obtain its dispatch claim");
		await _Client.mcpServerInstall.update({ where: { id: settling.installId }, data: { lifecycleState: McpInstallState.Removing } });

		await expect(_Dispatch().completeSucceeded(claimed.claim, _RESULT)).resolves.toBe(true);
		await expect(_Client.toolInvocation.findUniqueOrThrow({ where: { id: settling.invocationId } })).resolves.toMatchObject({ state: ToolInvocationState.Succeeded, claimKind: ExternalActionClaimKind.Dispatch });
		await expect(_Client.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: settlingExecutionId } })).resolves.toMatchObject({ commandState: McpExecutorCommandState.Succeeded, remoteClaimFence: claimed.claim.remoteClaimFence });
	});

	it("rejects a null terminal digest and rolls back when the runtime terminal CAS loses", async function _RollsBackTerminalWrites()
	{
		const fixture = await _InvocationFixture();
		const executionId = await _CreateRuntime(fixture);
		const claimed = await _Dispatch().claim({ target: fixture.target, workload: _WORKLOAD });
		if (claimed.outcome !== RemoteMcpDispatchClaimOutcomes.Claimed || claimed.claim === undefined)
			throw new Error("remote runtime SQL proof did not obtain its dispatch claim");
		const claim = claimed.claim;
		await expect(_Client.$transaction(async function _RejectNullDigest(transaction)
		{
			const clock = await transaction.mcpRuntimeClock.findUniqueOrThrow({ where: { singleton: 1 } });
			const tasks = new PrismaMcpTaskToolInvocationLifecycleRepository(transaction);
			const participant = _Participants().__ForTransaction(transaction, tasks);
			await participant.completeSucceeded(claim.toolInvocationClaim, { ok: true }, clock.now);
			await transaction.mcpRuntimeExecution.update({ where: { id: executionId }, data: { commandState: McpExecutorCommandState.Succeeded, terminalOutcome: "succeeded", terminalPayloadDigest: null, completedAt: clock.now } });
		})).rejects.toThrow(/terminal evidence/u);
		await expect(_Client.toolInvocation.findUniqueOrThrow({ where: { id: fixture.invocationId } })).resolves.toMatchObject({ state: ToolInvocationState.Claimed, result: null, completedAt: null });
		const extension = Prisma.defineExtension({ query: { mcpRuntimeExecution: { async updateMany()
		{
			return { count: 0 };
		} } } });
		const losingClient = _Client.$extends(extension) as unknown as PrismaClient;

		await expect(_Dispatch(losingClient).completeSucceeded(claim, _RESULT)).rejects.toThrow("remote MCP success lost its runtime transition");

		await expect(_Client.toolInvocation.findUniqueOrThrow({ where: { id: fixture.invocationId } })).resolves.toMatchObject({ state: ToolInvocationState.Claimed, result: null, completedAt: null });
		await expect(_Client.mcpTask.findUniqueOrThrow({ where: { id: fixture.mcpTaskId } })).resolves.toMatchObject({ state: McpTaskState.Running, result: null, completedAt: null });
		await expect(_Client.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: executionId } })).resolves.toMatchObject({ commandState: McpExecutorCommandState.Claimed, terminalOutcome: null, completedAt: null });
	});

	it("closes exhausted unused work without any dispatch fence", async function _ExhaustsUnused()
	{
		const fixture = await _InvocationFixture();
		const executionId = await _CreateRuntime(fixture);

		await expect(_Dispatch().settleExhausted(fixture.target)).resolves.toBe(true);

		await expect(_Client.toolInvocation.findUniqueOrThrow({ where: { id: fixture.invocationId } })).resolves.toMatchObject({ state: ToolInvocationState.Failed, claimKind: null, failureCode: "workflow_attempts_exhausted" });
		await expect(_Client.mcpTask.findUniqueOrThrow({ where: { id: fixture.mcpTaskId } })).resolves.toMatchObject({ state: McpTaskState.Failed, failureCode: "workflow_attempts_exhausted" });
		await expect(_Client.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: executionId } })).resolves.toMatchObject({ commandState: McpExecutorCommandState.Failed, remoteClaimFence: null, toolInvocationClaimFence: null, terminalOutcome: "workflow_attempts_exhausted", terminalPayloadDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u), completedAt: expect.any(Date) });
	});

	it("preserves an exhausted claimed effect as RecoveryRequired", async function _ExhaustsClaimed()
	{
		const fixture = await _InvocationFixture();
		const executionId = await _CreateRuntime(fixture);
		await expect(_Dispatch().claim({ target: fixture.target, workload: _WORKLOAD })).resolves.toMatchObject({ outcome: RemoteMcpDispatchClaimOutcomes.Claimed });

		await expect(_Dispatch().settleExhausted(fixture.target)).resolves.toBe(true);

		await expect(_Client.toolInvocation.findUniqueOrThrow({ where: { id: fixture.invocationId } })).resolves.toMatchObject({ state: ToolInvocationState.RecoveryRequired, claimKind: ExternalActionClaimKind.Dispatch });
		await expect(_Client.mcpTask.findUniqueOrThrow({ where: { id: fixture.mcpTaskId } })).resolves.toMatchObject({ state: McpTaskState.RecoveryRequired, failureCode: "provider_outcome_ambiguous" });
		await expect(_Client.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: executionId } })).resolves.toMatchObject({ commandState: McpExecutorCommandState.RecoveryRequired, remoteClaimFence: expect.any(String), terminalOutcome: "workflow_attempts_exhausted", terminalPayloadDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u), completedAt: expect.any(Date) });
	});

	it("keeps remote executions out of the OCI controller selector", async function _ExcludesRemoteFromOci()
	{
		const fixture = await _InvocationFixture();
		const executionId = await _CreateRuntime(fixture);
		const selected = await _Client.$queryRaw<Array<{ readonly id: string }>>(Prisma.sql`SELECT "id" FROM "select_mcp_runtime_claim_candidate"() WHERE "id" = ${executionId}`);
		expect(selected).toEqual([]);
		const options = { siloId: fixture.siloId, executorNamespace: "mcp-executors", executorServiceAccountName: "mcp-executor-default", profileName: "mcp-default", controllerClaimLeaseMilliseconds: 30_000, companionClaimLeaseMilliseconds: 60_000, log: { info(): void {} } as never };
		await expect(_Client.$transaction(async function _ClaimOci(transaction)
		{
			const controller = new PrismaMcpRuntimeControllerRepository(transaction, options);
			return controller.claimNext();
		})).resolves.toBeNull();
	});
});
