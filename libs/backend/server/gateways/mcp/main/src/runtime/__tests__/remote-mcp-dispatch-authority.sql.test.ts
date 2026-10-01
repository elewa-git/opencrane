import { randomUUID } from "node:crypto";

import { ExternalActionClaimKind, ExternalActionRecoveryMode, McpApprovalStatus, McpConnectionCredentialKind, McpConnectionState, McpConnectionStatus, McpCredentialRequirement as PrismaMcpCredentialRequirement, McpExecutionTransport, McpExecutorCommandState, McpExecutorWorkloadState, McpInstallState, McpRuntimeExecutionKind, McpServerStatus, McpServerTransport, McpTaskState, OrgRole, PrincipalProvenance, Prisma, PrismaClient, ToolInvocationState } from "@prisma/client";
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
import { _RemoteMcpClaimLeaseMilliseconds } from "../remote-mcp-invocation-executor";
import type { McpInvocationResultParticipantFactory } from "../mcp-invocation-result.types";
import { McpInvocationOwnerKinds, RemoteMcpDispatchClaimOutcomes, type McpInvocationDispatchTarget } from "../remote-mcp-invocation.types";

const _Client = new PrismaClient();
const _REQUEST_TIMEOUT_MILLISECONDS = 30_000;
const _LEASE_MILLISECONDS = _RemoteMcpClaimLeaseMilliseconds(_REQUEST_TIMEOUT_MILLISECONDS);
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

/** Seed a connection that has not yet saved its discovered revision. */
async function _ActivatingConnectionFixture()
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
	return { siloId, principalId, otherPrincipalId, serverId, installId, connectionId, endpointDigest, record };
}

/** Activate a seeded connection through the production discovery finalizer. */
async function _ConnectionFixture()
{
	const fixture = await _ActivatingConnectionFixture();
	const { siloId, principalId, otherPrincipalId, serverId, installId, connectionId, endpointDigest, record } = fixture;
	const command: McpRemoteRevisionFinalizationCommand = {
		record,
		task: { taskId: record.task.taskId, taskName: record.task.taskName, idempotencyKey: record.task.taskKey },
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

/** Build discovery evidence while its connection is still allowed to create a revision. */
function _RemoteRevisionData(fixture: Awaited<ReturnType<typeof _ActivatingConnectionFixture>>)
{
	return {
		siloId: fixture.siloId, mcpServerId: fixture.serverId, revision: 1, transport: McpExecutionTransport.RemoteHttp,
		connectionId: fixture.connectionId, connectionGeneration: 1, connectionOwnerPrincipalId: fixture.principalId, endpointDigest: fixture.endpointDigest,
		discoveryEvidenceDigest: ___DigestCanonicalJson({ connectionId: fixture.connectionId, kind: "discover" }), discoveryDigest: ___DigestCanonicalJson({ connectionId: fixture.connectionId, kind: "tools" }),
	} satisfies Prisma.McpServerRevisionUncheckedCreateInput;
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
	return new PrismaRemoteMcpDispatchUnitOfWork(client, _Participants(), _InvocationResults(), _REQUEST_TIMEOUT_MILLISECONDS);
}

/** Obtain both claim records through the production transaction before testing later writes. */
async function _ClaimedRuntimeFixture(remoteLeaseMilliseconds?: number)
{
	const fixture = await _InvocationFixture();
	const executionId = await _CreateRuntime(fixture);
	const client = remoteLeaseMilliseconds === undefined ? _Client : _Client.$extends({ query: { mcpRuntimeExecution: { async updateMany({ args, query })
	{
		if (args.data.commandState === McpExecutorCommandState.Claimed)
			args.data.remoteClaimExpiresAt = new Date(remoteLeaseMilliseconds);
		return query(args);
	} } } }) as unknown as PrismaClient;
	const claimed = await _Dispatch(client).claim({ target: fixture.target, workload: _WORKLOAD });
	if (claimed.outcome !== RemoteMcpDispatchClaimOutcomes.Claimed || claimed.claim === undefined)
		throw new Error("remote runtime SQL proof did not obtain its dispatch claim");
	return { fixture, executionId, claim: claimed.claim };
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

	it("rejects an absent revision connection before the shape constraint runs", async function _RejectsMissingRevisionConnection()
	{
		const fixture = await _ActivatingConnectionFixture();
		await expect(_Client.mcpServerRevision.create({ data: { ..._RemoteRevisionData(fixture), connectionId: null } })).rejects.toThrow(/Remote McpServerRevision requires its current activating connection and published server/u);
		expect(await _Client.mcpServerRevision.count({ where: { mcpServerId: fixture.serverId } })).toBe(0);
	});

	it.each(["discoveryEvidenceDigest", "discoveryDigest"] as const)("rejects a null %s even when revision creation is currently authorized", async function _RejectsMissingDiscoveryDigest(field)
	{
		const fixture = await _ActivatingConnectionFixture();
		await expect(_Client.mcpServerRevision.create({ data: { ..._RemoteRevisionData(fixture), [field]: null } })).rejects.toThrow(/mcp_server_revisions_transport_identity_check/u);
		expect(await _Client.mcpServerRevision.count({ where: { mcpServerId: fixture.serverId } })).toBe(0);
		await expect(_Client.mcpConnection.findUniqueOrThrow({ where: { id: fixture.connectionId } })).resolves.toMatchObject({ state: McpConnectionState.Activating });
	});

	it("does not create another discovered revision from an already Active connection", async function _RejectsActiveRevisionAdmission()
	{
		const fixture = await _ConnectionFixture();
		await expect(_Client.mcpServerRevision.create({ data: {
			siloId: fixture.siloId, mcpServerId: fixture.serverId, revision: 2, transport: McpExecutionTransport.RemoteHttp,
			connectionId: fixture.connectionId, connectionGeneration: 1, connectionOwnerPrincipalId: fixture.principalId, endpointDigest: fixture.endpointDigest,
			discoveryEvidenceDigest: ___DigestCanonicalJson({ connectionId: fixture.connectionId, revision: 2 }), discoveryDigest: ___DigestCanonicalJson({ connectionId: fixture.connectionId, tools: 2 }),
		} })).rejects.toThrow(/Remote McpServerRevision requires its current activating connection and published server/u);
		expect(await _Client.mcpServerRevision.count({ where: { mcpServerId: fixture.serverId } })).toBe(1);
	});

	it("rejects null and stale task or runtime connection coordinates", async function _RejectsInvalidIdentity()
	{
		const fixture = await _InvocationFixture();
		const taskId = randomUUID();
		await expect(_Client.mcpTask.create({ data: {
			id: taskId, siloId: fixture.siloId, principalId: fixture.principalId, requestKeyDigest: ___DigestCanonicalJson({ taskId, kind: "request" }), callDigest: ___DigestCanonicalJson({ taskId, kind: "call" }),
			serverRevisionId: fixture.serverRevisionId, toolRevisionId: fixture.toolRevisionId, protocolVersion: MCP_PROTOCOL_VERSION, transport: McpExecutionTransport.RemoteHttp,
			connectionId: null, connectionGeneration: 1, connectionOwnerPrincipalId: fixture.principalId, endpointDigest: fixture.endpointDigest, arguments: {},
		} })).rejects.toThrow(/Remote McpTask requires its exact Active connection, installed owner, and selected Ready tool/u);

		const runtime = _RuntimeData(fixture);
		await expect(_Client.mcpRuntimeExecution.create({ data: { ...runtime, connectionId: null } })).rejects.toThrow(/Remote McpRuntimeExecution requires its exact Active connection, installed owner, and Ready revision/u);
		await expect(_Client.mcpRuntimeExecution.create({ data: { ...runtime, credentialSecretUid: "stale-uid", credentialSecretResourceVersion: null } })).rejects.toThrow(/Remote McpRuntimeExecution requires its exact Active connection, installed owner, and Ready revision/u);
		await expect(_Client.mcpRuntimeExecution.create({ data: { ...runtime, id: randomUUID(), idempotencyKey: `stale-owner-${randomUUID()}`, executionReference: `mcp-remote-v1_${randomUUID()}`, connectionOwnerPrincipalId: fixture.otherPrincipalId } })).rejects.toThrow();
		await expect(_Client.mcpRuntimeExecution.create({ data: { ...runtime, id: randomUUID(), idempotencyKey: `stale-generation-${randomUUID()}`, executionReference: `mcp-remote-v1_${randomUUID()}`, connectionGeneration: 2 } })).rejects.toThrow();
		await expect(_Client.mcpRuntimeExecution.create({ data: { ...runtime, id: randomUUID(), idempotencyKey: `stale-secret-${randomUUID()}`, executionReference: `mcp-remote-v1_${randomUUID()}`, credentialSecretUid: "stale-uid", credentialSecretResourceVersion: "stale-version" } })).rejects.toThrow(/exact Active connection/u);
	});

	it.each([
		["transport", { transport: McpExecutionTransport.OciImage }],
		["missing connection", { connectionId: null }],
		["missing owner", { connectionOwnerPrincipalId: null }],
		["missing generation", { connectionGeneration: null }],
		["missing endpoint", { endpointDigest: null }],
		["credential identity", { credentialSecretUid: "substituted-uid", credentialSecretResourceVersion: "substituted-version" }],
	] as const)("rejects a raw %s change without changing the saved runtime", async function _RejectsRuntimeIdentityChange(_label, data)
	{
		const fixture = await _InvocationFixture();
		const executionId = await _CreateRuntime(fixture);
		const before = await _Client.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: executionId } });
		await expect(_Client.mcpRuntimeExecution.update({ where: { id: executionId }, data })).rejects.toThrow();
		expect(await _Client.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: executionId } })).toEqual(before);
	});

	it.each([
		["controller profile", { profileName: "mcp-default" }],
		["pending workload", { workloadState: McpExecutorWorkloadState.Pending }],
		["assigned Job", { workloadUid: "fabricated-job", assignedAt: new Date("2026-09-01T00:00:00.000Z") }],
		["registered Pod", { podUid: "fabricated-pod" }],
		["controller delivery", { deliveryCount: 1, claimedAt: new Date(0), claimExpiresAt: new Date(_LEASE_MILLISECONDS) }],
		["companion fence", { companionClaimFence: "fabricated-companion", companionClaimExpiresAt: new Date(_LEASE_MILLISECONDS) }],
	] as const)("rejects remote insertion with OCI %s evidence", async function _RejectsOciEvidence(_label, data)
	{
		const fixture = await _InvocationFixture();
		const runtime = _RuntimeData(fixture);
		await expect(_Client.mcpRuntimeExecution.create({ data: { ...runtime, ...data } })).rejects.toThrow();
		expect(await _Client.mcpRuntimeExecution.findUnique({ where: { id: runtime.id } })).toBeNull();
	});

	it("rejects a fabricated remote claim while its ToolInvocation is still Ready", async function _RejectsUnpairedClaim()
	{
		const fixture = await _InvocationFixture();
		const executionId = await _CreateRuntime(fixture);
		await expect(_Client.mcpRuntimeExecution.update({ where: { id: executionId }, data: {
			commandState: McpExecutorCommandState.Claimed, remoteClaimFence: randomUUID(), remoteClaimExpiresAt: new Date(_LEASE_MILLISECONDS), toolInvocationClaimFence: 1, toolInvocationClaimRevision: 2,
		} })).rejects.toThrow();
		await expect(_Client.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: executionId } })).resolves.toMatchObject({ commandState: McpExecutorCommandState.Pending, remoteClaimFence: null, remoteClaimExpiresAt: null, toolInvocationClaimFence: null, toolInvocationClaimRevision: null });
		await expect(_Client.toolInvocation.findUniqueOrThrow({ where: { id: fixture.invocationId } })).resolves.toMatchObject({ state: ToolInvocationState.Ready, claimFence: 0, claimKind: null });
	});

	it.each([0, 999, 300_001])("rejects a %i ms SQL lease proposal and rolls back its paired invocation claim", async function _RejectsInvalidLease(leaseMilliseconds)
	{
		const fixture = await _InvocationFixture();
		const executionId = await _CreateRuntime(fixture);
		const extension = Prisma.defineExtension({ query: { mcpRuntimeExecution: { async updateMany({ args, query })
		{
			return query({ ...args, data: { ...args.data, remoteClaimExpiresAt: new Date(leaseMilliseconds) } });
		} } } });
		const invalidLeaseClient = _Client.$extends(extension) as unknown as PrismaClient;
		await expect(_Dispatch(invalidLeaseClient).claim({ target: fixture.target, workload: _WORKLOAD })).rejects.toThrow();
		await expect(_Client.toolInvocation.findUniqueOrThrow({ where: { id: fixture.invocationId } })).resolves.toMatchObject({ state: ToolInvocationState.Ready, claimFence: 0, claimKind: null, revision: 1 });
		await expect(_Client.mcpTask.findUniqueOrThrow({ where: { id: fixture.mcpTaskId } })).resolves.toMatchObject({ state: McpTaskState.Queued });
		await expect(_Client.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: executionId } })).resolves.toMatchObject({ commandState: McpExecutorCommandState.Pending, remoteClaimFence: null, remoteClaimExpiresAt: null });
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
		const invocation = await _Client.toolInvocation.findUniqueOrThrow({ where: { id: fixture.invocationId } });
		expect(execution.remoteClaimExpiresAt?.getTime()).toBeLessThanOrEqual(invocation.claimExpiresAt!.getTime());
		await expect(_Dispatch().claim({ target: fixture.target, workload: _WORKLOAD })).resolves.toEqual({ outcome: RemoteMcpDispatchClaimOutcomes.Unavailable });
		await expect(_Client.toolInvocation.findUniqueOrThrow({ where: { id: fixture.invocationId } })).resolves.toMatchObject({ state: ToolInvocationState.Claimed, claimKind: ExternalActionClaimKind.Dispatch });
	});

	it.each([
		["remote fence", { remoteClaimFence: "replacement-claim" }],
		["remote deadline", { remoteClaimExpiresAt: new Date("2099-01-01T00:00:00.000Z") }],
		["invocation fence", { toolInvocationClaimFence: 99 }],
		["invocation revision", { toolInvocationClaimRevision: 99 }],
	] as const)("cannot rewrite a saved %s after dispatch admission", async function _RejectsClaimMutation(_label, data)
	{
		const { executionId } = await _ClaimedRuntimeFixture();
		const before = await _Client.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: executionId } });
		await expect(_Client.mcpRuntimeExecution.update({ where: { id: executionId }, data })).rejects.toThrow();
		expect(await _Client.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: executionId } })).toEqual(before);
	});

	it("rejects a raw runtime success while its paired invocation is still Claimed", async function _RejectsUnpairedCompletion()
	{
		const { fixture, executionId } = await _ClaimedRuntimeFixture();
		const clock = await _Client.mcpRuntimeClock.findUniqueOrThrow({ where: { singleton: 1 } });
		await expect(_Client.mcpRuntimeExecution.update({ where: { id: executionId }, data: {
			commandState: McpExecutorCommandState.Succeeded, terminalOutcome: "succeeded", terminalPayloadDigest: ___DigestCanonicalJson(_RESULT), completedAt: clock.now,
		} })).rejects.toThrow();
		await expect(_Client.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: executionId } })).resolves.toMatchObject({ commandState: McpExecutorCommandState.Claimed, terminalOutcome: null, terminalPayloadDigest: null, completedAt: null });
		await expect(_Client.toolInvocation.findUniqueOrThrow({ where: { id: fixture.invocationId } })).resolves.toMatchObject({ state: ToolInvocationState.Claimed, result: null, completedAt: null });
	});

	it("keeps saved success and claim evidence immutable", async function _RejectsTerminalMutation()
	{
		const { fixture, executionId, claim } = await _ClaimedRuntimeFixture();
		await expect(_Dispatch().completeSucceeded(claim, _RESULT)).resolves.toBe(true);
		const before = await _Client.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: executionId } });
		for (const data of [
			{ commandState: McpExecutorCommandState.Pending },
			{ remoteClaimFence: "replacement-terminal-fence" },
			{ remoteClaimExpiresAt: new Date("2099-01-01T00:00:00.000Z") },
			{ terminalPayloadDigest: ___DigestCanonicalJson({ replaced: true }) },
			{ terminalOutcome: "replaced" },
			{ completedAt: new Date("2099-01-01T00:00:00.000Z") },
		] as const)
		{
			await expect(_Client.mcpRuntimeExecution.update({ where: { id: executionId }, data })).rejects.toThrow();
			expect(await _Client.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: executionId } })).toEqual(before);
		}
		await expect(_Client.toolInvocation.findUniqueOrThrow({ where: { id: fixture.invocationId } })).resolves.toMatchObject({ state: ToolInvocationState.Succeeded, claimKind: null, claimExpiresAt: null, claimFence: claim.toolInvocationClaim.fence, revision: claim.toolInvocationClaim.revision + 1 });
		await expect(_Dispatch().claim({ target: fixture.target, workload: _WORKLOAD })).resolves.toEqual({ outcome: RemoteMcpDispatchClaimOutcomes.Terminal });
	});

	it("recovers an expired claim without accepting a late success or issuing another claim", async function _RecoversExpiredClaim()
	{
		const { fixture, executionId, claim } = await _ClaimedRuntimeFixture(1_000);
		const claimed = await _Client.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: executionId } });
		await _Client.$queryRaw(Prisma.sql`SELECT 1 AS waited FROM pg_sleep(1.1)`);
		await expect(_Dispatch().completeSucceeded(claim, _RESULT)).resolves.toBe(false);
		await expect(_Dispatch().claim({ target: fixture.target, workload: _WORKLOAD })).resolves.toEqual({ outcome: RemoteMcpDispatchClaimOutcomes.Terminal });
		await expect(_Client.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: executionId } })).resolves.toMatchObject({
			commandState: McpExecutorCommandState.RecoveryRequired, remoteClaimFence: claimed.remoteClaimFence, remoteClaimExpiresAt: claimed.remoteClaimExpiresAt,
			toolInvocationClaimFence: claim.toolInvocationClaim.fence, toolInvocationClaimRevision: claim.toolInvocationClaim.revision,
			terminalOutcome: "mcp_remote_dispatch_interrupted", terminalPayloadDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u), completedAt: expect.any(Date),
		});
		await expect(_Client.toolInvocation.findUniqueOrThrow({ where: { id: fixture.invocationId } })).resolves.toMatchObject({ state: ToolInvocationState.RecoveryRequired, claimKind: null, claimExpiresAt: null, claimFence: claim.toolInvocationClaim.fence, revision: claim.toolInvocationClaim.revision + 1 });
		await expect(_Client.mcpTask.findUniqueOrThrow({ where: { id: fixture.mcpTaskId } })).resolves.toMatchObject({ state: McpTaskState.RecoveryRequired, failureCode: "provider_outcome_ambiguous" });
		const recovered = await _Client.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: executionId } });
		await expect(_Dispatch().claim({ target: fixture.target, workload: _WORKLOAD })).resolves.toEqual({ outcome: RemoteMcpDispatchClaimOutcomes.Terminal });
		expect(await _Client.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: executionId } })).toEqual(recovered);
	});

	it("rolls back success when the runtime lease expires after the final completion clock read", async function _RejectsCompletionWriteAfterExpiry()
	{
		const { fixture, executionId, claim } = await _ClaimedRuntimeFixture(1_000);
		const beforeInvocation = await _Client.toolInvocation.findUniqueOrThrow({ where: { id: fixture.invocationId } });
		const beforeExecution = await _Client.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: executionId } });
		const beforeTask = await _Client.mcpTask.findUniqueOrThrow({ where: { id: fixture.mcpTaskId } });
		let delayed = false;
		const client = _Client.$extends({ query: { toolInvocation: { async updateMany({ args, query })
		{
			if (args.data.state === ToolInvocationState.Succeeded)
			{
				delayed = true;
				await _Client.$queryRaw(Prisma.sql`SELECT 1 AS waited FROM pg_sleep(1.1)`);
			}
			return query(args);
		} } } }) as unknown as PrismaClient;
		await expect(_Dispatch(client).completeSucceeded(claim, _RESULT)).rejects.toThrow();
		expect(delayed).toBe(true);
		expect(await _Client.toolInvocation.findUniqueOrThrow({ where: { id: fixture.invocationId } })).toEqual(beforeInvocation);
		expect(await _Client.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: executionId } })).toEqual(beforeExecution);
		expect(await _Client.mcpTask.findUniqueOrThrow({ where: { id: fixture.mcpTaskId } })).toEqual(beforeTask);
		await expect(_Dispatch().claim({ target: fixture.target, workload: _WORKLOAD })).resolves.toEqual({ outcome: RemoteMcpDispatchClaimOutcomes.Terminal });
		await expect(_Client.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: executionId } })).resolves.toMatchObject({ commandState: McpExecutorCommandState.RecoveryRequired, remoteClaimFence: claim.remoteClaimFence });
		await expect(_Client.toolInvocation.findUniqueOrThrow({ where: { id: fixture.invocationId } })).resolves.toMatchObject({ state: ToolInvocationState.RecoveryRequired, claimFence: claim.toolInvocationClaim.fence });
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
		await expect(_Client.toolInvocation.findUniqueOrThrow({ where: { id: settling.invocationId } })).resolves.toMatchObject({ state: ToolInvocationState.Succeeded, claimKind: null, claimExpiresAt: null, claimFence: claimed.claim.toolInvocationClaim.fence, revision: claimed.claim.toolInvocationClaim.revision + 1 });
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

		await expect(_Client.toolInvocation.findUniqueOrThrow({ where: { id: fixture.invocationId } })).resolves.toMatchObject({ state: ToolInvocationState.RecoveryRequired, claimKind: null, claimExpiresAt: null, claimFence: 1, revision: 3 });
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
