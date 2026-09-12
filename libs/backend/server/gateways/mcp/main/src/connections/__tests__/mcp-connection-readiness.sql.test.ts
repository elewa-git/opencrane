import { randomUUID } from "node:crypto";

import { ExternalActionClaimKind, ExternalActionRecoveryMode, McpApprovalStatus, McpConnectionStatus, McpCredentialRequirement, McpExecutorCommandState, McpExecutorWorkloadState, McpRuntimeExecutionKind, McpServerRevisionState, McpServerStatus, McpServerTransport, McpTaskState, OciImageValidationState, PrincipalProvenance, Prisma, PrismaClient, ToolInvocationState } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { __CreatePrismaMcpToolInvocationParticipantFactory, ToolInvocationRunRecoveryEnterResults } from "@opencrane/backend/server/iam/authorization";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { PrismaMcpTaskToolInvocationLifecycleRepository } from "../../mcp-tasks/prisma-mcp-task-tool-invocation-lifecycle";
import { PrismaMcpRuntimeCompanionRepository } from "../../runtime/prisma-mcp-runtime-companion-repository";
import { PrismaMcpRuntimeControllerRepository } from "../../runtime/prisma-mcp-runtime-controller-repository";
import { PrismaMcpConnectionReadinessRepository } from "../prisma-mcp-connection-readiness-repository";

const _First = new PrismaClient();
const _Second = new PrismaClient();
const _Observer = new PrismaClient();

/** Runtime policy for the isolated SQL execution. */
function _Options(siloId: string)
{
	return { siloId, executorNamespace: "mcp-executors", executorServiceAccountName: "mcp-executor-default", profileName: "mcp-default", controllerClaimLeaseMilliseconds: 30_000, companionClaimLeaseMilliseconds: 60_000, log: { info(): void {} } as never };
}

/** Build the production participant; run-only collaborators must remain unused in task cases. */
function _Participants()
{
	return __CreatePrismaMcpToolInvocationParticipantFactory(
		{ async appendInTransaction(): Promise<boolean> { throw new Error("task readiness proof attempted a run event"); } },
		{ async appendInTransaction(): Promise<boolean> { throw new Error("task readiness proof attempted a recovery event"); } },
		{ async enterRecoveryRequiredInTransaction() { return ToolInvocationRunRecoveryEnterResults.Conflict; }, async resumeRunningInTransaction(): Promise<boolean> { throw new Error("task readiness proof attempted run recovery"); } },
		{ async admitUntilInTransaction(): Promise<number | null> { throw new Error("task readiness proof attempted run dispatch"); } },
	);
}

/** Seed one trigger-valid credentialless server, tool, Principal, and installation. */
async function _Fixture()
{
	const siloId = `mcp-readiness-sql-${randomUUID()}`;
	return _First.$transaction(async function _Seed(transaction)
	{
		const principalId = randomUUID();
		const otherPrincipalId = randomUUID();
		const serverId = randomUUID();
		const validationId = randomUUID();
		const serverRevisionId = randomUUID();
		const toolRevisionId = randomUUID();
		const taskId = randomUUID();
		const invocationId = randomUUID();
		const executionId = randomUUID();
		const executionReference = `mcp-execution-v1_${randomUUID()}`;
		const digest = ___DigestCanonicalJson({ siloId, serverId });
		const registryReference = `registry.example.test/readiness/image@${digest}`;
		const now = new Date();
		await transaction.principal.createMany({ data: [
			{ id: principalId, siloId, issuer: "https://mcp-readiness.example", subject: principalId, provenance: PrincipalProvenance.External },
			{ id: otherPrincipalId, siloId, issuer: "https://mcp-readiness.example", subject: otherPrincipalId, provenance: PrincipalProvenance.External },
		] });
		await transaction.mcpServer.create({ data: { id: serverId, siloId, name: serverId, endpoint: registryReference, transport: McpServerTransport.OciImage, credentialRequirement: McpCredentialRequirement.Credentialless, status: McpServerStatus.Active, approvalStatus: McpApprovalStatus.Published } });
		await transaction.ociImageValidation.create({ data: { id: validationId, siloId, artifactId: randomUUID(), artifactRevisionId: randomUUID(), contentAddress: digest, byteLength: 1, mediaType: "application/vnd.oci.image.layout.v1+tar", submissionKeyDigest: digest, submissionDigest: digest, state: OciImageValidationState.Imported, indexDigest: digest, imageManifestDigest: digest, configDigest: digest, registryReference, createdByPrincipalId: principalId, completedAt: now } });
		await transaction.mcpServerRevision.create({ data: { id: serverRevisionId, siloId, mcpServerId: serverId, ociImageValidationId: validationId, revision: 1, registryReference } });
		const inputSchema = { type: "object", properties: {}, additionalProperties: false };
		await transaction.mcpToolRevision.create({ data: { id: toolRevisionId, siloId, serverRevisionId, name: "records.read", inputSchema, inputSchemaDigest: ___DigestCanonicalJson(inputSchema) } });
		await transaction.mcpServerRevision.update({ where: { id: serverRevisionId }, data: { state: McpServerRevisionState.Ready, protocolVersion: "2026-07-28", completedAt: now } });
		await transaction.mcpServerInstall.create({ data: { mcpServerId: serverId, principalId, connectionStatus: McpConnectionStatus.Credentialless } });
		const argumentsValue = {};
		const argumentsDigest = ___DigestCanonicalJson(argumentsValue);
		const coordinate = { resource: { kind: "mcp-tool-revision", id: toolRevisionId }, action: "invoke" };
		const decisionDigest = ___DigestCanonicalJson({ taskId, decision: "allow" });
		const evidenceDigest = ___DigestCanonicalJson({ taskId, principalId, coordinate, decisionDigest });
		const requestIdentity = { runtimeInstanceId: `mcp-task:${taskId}`, commandId: taskId, candidateId: taskId };
		await transaction.mcpTask.create({ data: { id: taskId, siloId, principalId, requestKeyDigest: ___DigestCanonicalJson({ taskId, kind: "request" }), callDigest: ___DigestCanonicalJson({ taskId, kind: "call" }), serverRevisionId, toolRevisionId, protocolVersion: "2026-07-28", arguments: argumentsValue, state: McpTaskState.Working } });
		await transaction.toolInvocation.create({ data: { id: invocationId, siloId, mcpTaskId: taskId, principalId, authorizationCoordinates: [coordinate], authorizationDecisionDigests: [decisionDigest], authorizationEvidenceDigest: evidenceDigest, runtimeInstanceId: requestIdentity.runtimeInstanceId, commandId: requestIdentity.commandId, candidateId: requestIdentity.candidateId, toolRevisionId, toolInvocationId: `mcp-task-call:${taskId}`, arguments: argumentsValue, argumentsDigest, effectiveArguments: argumentsValue, effectiveArgumentsDigest: argumentsDigest, requestFingerprint: ___DigestCanonicalJson([taskId, argumentsDigest]), requestIdentity, approvalRequired: false, recoveryMode: ExternalActionRecoveryMode.Manual, state: ToolInvocationState.Preparing, retryDeadlineAt: new Date(now.getTime() + 300_000), nextPreparationAttemptAt: now, createdAt: now } });
		await transaction.toolInvocation.update({ where: { id: invocationId }, data: { state: ToolInvocationState.Ready, preparationAttempt: { increment: 1 }, revision: { increment: 1 } } });
		await transaction.mcpTask.update({ where: { id: taskId }, data: { state: McpTaskState.Queued } });
		await transaction.mcpRuntimeExecution.create({ data: { id: executionId, siloId, serverRevisionId, toolInvocationId: invocationId, kind: McpRuntimeExecutionKind.Invocation, idempotencyKey: `mcp-invocation:${invocationId}`, executionReference, profileName: "mcp-default" } });
		return { siloId, principalId, otherPrincipalId, serverId, serverRevisionId, toolRevisionId, taskId, invocationId, executionId, executionReference };
	}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Remove the mutable install; the disposable database retains immutable authority rows. */
async function _Cleanup(fixture: Awaited<ReturnType<typeof _Fixture>>): Promise<void>
{
	await _First.mcpServerInstall.deleteMany({ where: { mcpServerId: fixture.serverId } });
}

/** Move one executor row through the production controller fences to a registered Pod. */
async function _RegisterExecution(fixture: Awaited<ReturnType<typeof _Fixture>>): Promise<void>
{
	const options = _Options(fixture.siloId);
	const claimed = await _First.$transaction(async function _Claim(transaction) { return new PrismaMcpRuntimeControllerRepository(transaction, options).claimNext(); });
	if (claimed === null)
		throw new Error("MCP readiness SQL proof could not claim its execution");
	const binding = { claimId: claimed.claim.claimId, claimedAt: claimed.claim.claimedAt, deliveryCount: claimed.claim.deliveryCount, profileName: claimed.claim.profileName, workloadUid: `job-${fixture.executionId}` };
	await expect(_First.$transaction(async function _Assign(transaction) { return new PrismaMcpRuntimeControllerRepository(transaction, options).commitAssignment(binding); })).resolves.toBe("assigned");
	const release = await _First.$transaction(async function _ClaimRelease(transaction) { return new PrismaMcpRuntimeControllerRepository(transaction, options).claimNextRelease(); });
	if (release === null)
		throw new Error("MCP readiness SQL proof could not claim release");
	const releaseCommand = { workloadUid: binding.workloadUid, releaseClaimedAt: release.releaseClaimedAt, releaseDeliveryCount: release.releaseDeliveryCount };
	await expect(_First.$transaction(async function _Release(transaction) { return new PrismaMcpRuntimeControllerRepository(transaction, options).commitRelease(fixture.executionId, releaseCommand); })).resolves.toBe("released");
	await expect(_First.$transaction(async function _Register(transaction) { return new PrismaMcpRuntimeControllerRepository(transaction, options).registerFirstPod(fixture.executionId, { ...releaseCommand, podUid: `pod-${fixture.executionId}` }); })).resolves.toBe("registered");
}

/** Run the production task participant and companion in one serializable claim transaction. */
async function _ClaimCompanion(client: PrismaClient, fixture: Awaited<ReturnType<typeof _Fixture>>)
{
	const participants = _Participants();
	const options = _Options(fixture.siloId);
	return client.$transaction(async function _Claim(transaction)
	{
		const taskLifecycle = new PrismaMcpTaskToolInvocationLifecycleRepository(transaction);
		const participant = participants.__ForTransaction(transaction, taskLifecycle);
		const readiness = new PrismaMcpConnectionReadinessRepository(transaction);
		const companion = new PrismaMcpRuntimeCompanionRepository(transaction, participant, readiness, options);
		const identity = { subject: "system:serviceaccount:mcp-executors:mcp-executor-default", namespace: "mcp-executors", serviceAccountName: "mcp-executor-default", podUid: `pod-${fixture.executionId}` };
		return companion.claim(identity, fixture.executionReference);
	}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Observe the competing delete waiting on the install row lock held by the claim transaction. */
async function _WaitForUninstallLock(): Promise<void>
{
	for (let attempt = 0; attempt < 80; attempt += 1)
	{
		const rows = await _Observer.$queryRaw<Array<{ readonly wait_event_type: string | null }>>(Prisma.sql`SELECT wait_event_type FROM pg_stat_activity WHERE application_name = 'opencrane-mcp-readiness-uninstall' AND state = 'active'`);
		if (rows.some(function _Waits(row) { return row.wait_event_type === "Lock"; }))
			return;
		await new Promise(function _Yield(resolve) { setTimeout(resolve, 25); });
	}
	throw new Error("concurrent MCP uninstall did not reach the database lock wait");
}

describe("MCP connection readiness on the fresh PostgreSQL baseline", function _Suite()
{
	beforeAll(async function _Connect()
	{
		if (!process.env.DATABASE_URL)
			throw new Error("MCP readiness SQL proof requires DATABASE_URL and the fresh target baseline");
		await Promise.all([_First.$connect(), _Second.$connect(), _Observer.$connect()]);
	});
	afterAll(async function _Disconnect() { await Promise.all([_First.$disconnect(), _Second.$disconnect(), _Observer.$disconnect()]); });

	it("admits only the exact Principal installation and current credentialless state", async function _ExactOwner()
	{
		const fixture = await _Fixture();
		try
		{
			const command = { siloId: fixture.siloId, toolRevisionId: fixture.toolRevisionId, ownerPrincipalId: fixture.principalId };
			await _First.$transaction(async function _Read(transaction)
			{
				const repository = new PrismaMcpConnectionReadinessRepository(transaction);
				await expect(repository.isReady(command)).resolves.toBe(true);
				await expect(repository.isReady({ ...command, ownerPrincipalId: fixture.otherPrincipalId })).resolves.toBe(false);
			});
			await _First.mcpServerInstall.update({ where: { mcpServerId_principalId: { mcpServerId: fixture.serverId, principalId: fixture.principalId } }, data: { connectionStatus: McpConnectionStatus.NeedsCredential } });
			await _First.$transaction(async function _ReadChanged(transaction)
			{
				await expect(new PrismaMcpConnectionReadinessRepository(transaction).isReady(command)).resolves.toBe(false);
			});
			await _RegisterExecution(fixture);
			await expect(_ClaimCompanion(_First, fixture)).resolves.toBe("terminal");
		}
		finally
		{
			await _Cleanup(fixture);
		}
	});

	it("denies mismatched coordinates and unusable server or revision state", async function _DeniesUnusableCoordinates()
	{
		const fixture = await _Fixture();
		try
		{
			const command = { siloId: fixture.siloId, toolRevisionId: fixture.toolRevisionId, ownerPrincipalId: fixture.principalId };
			const readiness = async function _Ready(candidate: typeof command): Promise<boolean>
			{
				return _First.$transaction(async function _Read(transaction) { return new PrismaMcpConnectionReadinessRepository(transaction).isReady(candidate); });
			};
			await expect(readiness({ ...command, siloId: `${fixture.siloId}-other` })).resolves.toBe(false);
			await expect(readiness({ ...command, toolRevisionId: randomUUID() })).resolves.toBe(false);

			const unreadyToolRevisionId = randomUUID();
			await _First.$transaction(async function _SeedUnreadyRevision(transaction)
			{
				const contentAddress = ___DigestCanonicalJson({ serverId: fixture.serverId, revision: 2 });
				const registryReference = `registry.example.test/readiness/unready@${contentAddress}`;
				const validation = await transaction.ociImageValidation.create({ data: { siloId: fixture.siloId, artifactId: randomUUID(), artifactRevisionId: randomUUID(), contentAddress, byteLength: 1, mediaType: "application/vnd.oci.image.layout.v1+tar", submissionKeyDigest: contentAddress, submissionDigest: contentAddress, state: OciImageValidationState.Imported, indexDigest: contentAddress, imageManifestDigest: contentAddress, configDigest: contentAddress, registryReference, createdByPrincipalId: fixture.principalId, completedAt: new Date() } });
				const revision = await transaction.mcpServerRevision.create({ data: { siloId: fixture.siloId, mcpServerId: fixture.serverId, ociImageValidationId: validation.id, revision: 2, registryReference } });
				const inputSchema = { type: "object", properties: {}, additionalProperties: false };
				await transaction.mcpToolRevision.create({ data: { id: unreadyToolRevisionId, siloId: fixture.siloId, serverRevisionId: revision.id, name: "records.unready", inputSchema, inputSchemaDigest: ___DigestCanonicalJson(inputSchema) } });
			});
			await expect(readiness({ ...command, toolRevisionId: unreadyToolRevisionId })).resolves.toBe(false);

			await _First.mcpServer.update({ where: { id: fixture.serverId }, data: { approvalStatus: McpApprovalStatus.Approved } });
			await expect(readiness(command)).resolves.toBe(false);
			await _First.mcpServer.update({ where: { id: fixture.serverId }, data: { approvalStatus: McpApprovalStatus.Published, status: McpServerStatus.Degraded } });
			await expect(readiness(command)).resolves.toBe(false);
			await _First.mcpServer.update({ where: { id: fixture.serverId }, data: { status: McpServerStatus.Active } });
			await expect(readiness(command)).resolves.toBe(true);
			await _RegisterExecution(fixture);
			await _First.mcpServerInstall.deleteMany({ where: { mcpServerId: fixture.serverId, principalId: fixture.principalId } });
			await expect(_ClaimCompanion(_First, fixture)).resolves.toBe("terminal");
		}
		finally
		{
			await _Cleanup(fixture);
		}
	});

	it("rejects credentialless schemas and credentialed OCI servers at the database boundary", async function _RejectsInvalidCredentialCombinations()
	{
		const credentiallessId = randomUUID();
		await expect(_First.mcpServer.create({ data: { id: credentiallessId, siloId: `mcp-baseline-${randomUUID()}`, name: credentiallessId, endpoint: "https://mcp.example.test", transport: McpServerTransport.StreamableHttp, credentialRequirement: McpCredentialRequirement.Credentialless, credentialSchema: [{ name: "token" }] } })).rejects.toThrow(/mcp_servers_credentialless_schema_check/u);
		await expect(_First.mcpServer.findUnique({ where: { id: credentiallessId } })).resolves.toBeNull();

		const credentialedOciId = randomUUID();
		await expect(_First.mcpServer.create({ data: { id: credentialedOciId, siloId: `mcp-baseline-${randomUUID()}`, name: credentialedOciId, endpoint: `registry.example.test/readiness/image@${___DigestCanonicalJson({ credentialedOciId })}`, transport: McpServerTransport.OciImage, credentialRequirement: McpCredentialRequirement.PrincipalCredential } })).rejects.toThrow(/mcp_servers_oci_credential_requirement_check/u);
		await expect(_First.mcpServer.findUnique({ where: { id: credentialedOciId } })).resolves.toBeNull();
	});

	it("commits the ToolInvocation fence before a lock-waiting uninstall can win", async function _ClaimWins()
	{
		const fixture = await _Fixture();
		await _RegisterExecution(fixture);
		let releaseLock: (() => void) | undefined;
		const holdLock = new Promise<void>(function _Hold(resolve) { releaseLock = resolve; });
		let reportLocked: (() => void) | undefined;
		const locked = new Promise<void>(function _Locked(resolve) { reportLocked = resolve; });
		try
		{
			const extension = Prisma.defineExtension({ query: { mcpServerInstall: { async updateMany({ args, query })
			{
				const result = await query(args);
				reportLocked?.();
				await holdLock;
				return result;
			} } } });
			const client = _First.$extends(extension) as unknown as PrismaClient;
			const claim = _ClaimCompanion(client, fixture);
			await locked;
			const deletion = _Second.$transaction(async function _Delete(transaction)
			{
				await transaction.$queryRaw(Prisma.sql`SELECT set_config('application_name', 'opencrane-mcp-readiness-uninstall', true)`);
				return transaction.mcpServerInstall.deleteMany({ where: { mcpServerId: fixture.serverId, principalId: fixture.principalId } });
			});
			await _WaitForUninstallLock();
			releaseLock?.();
			await expect(claim).resolves.toMatchObject({ kind: "invocation" });
			await expect(deletion).resolves.toEqual({ count: 1 });
			await expect(_Second.toolInvocation.findUniqueOrThrow({ where: { id: fixture.invocationId } })).resolves.toMatchObject({ state: ToolInvocationState.Claimed, claimKind: ExternalActionClaimKind.Dispatch, claimFence: 1, revision: 2 });
			await expect(_Second.mcpTask.findUniqueOrThrow({ where: { id: fixture.taskId } })).resolves.toMatchObject({ state: McpTaskState.Running, failureCode: null });
			await expect(_Second.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: fixture.executionId } })).resolves.toMatchObject({ commandState: McpExecutorCommandState.Claimed, workloadState: McpExecutorWorkloadState.Registered });
		}
		finally
		{
			releaseLock?.();
			await _Cleanup(fixture);
		}
	});

	it("closes task, invocation, and execution when uninstall commits first", async function _UninstallWins()
	{
		const fixture = await _Fixture();
		try
		{
			await _RegisterExecution(fixture);
			await _Second.mcpServerInstall.deleteMany({ where: { mcpServerId: fixture.serverId, principalId: fixture.principalId } });
			await expect(_ClaimCompanion(_First, fixture)).resolves.toBe("terminal");
			await expect(_Second.toolInvocation.findUniqueOrThrow({ where: { id: fixture.invocationId } })).resolves.toMatchObject({ state: ToolInvocationState.Failed, failureCode: "mcp_connection_unavailable", revision: 2, claimFence: 0, claimKind: null });
			await expect(_Second.mcpTask.findUniqueOrThrow({ where: { id: fixture.taskId } })).resolves.toMatchObject({ state: McpTaskState.Failed, failureCode: "mcp_connection_unavailable" });
			await expect(_Second.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: fixture.executionId } })).resolves.toMatchObject({ commandState: McpExecutorCommandState.Failed, workloadState: McpExecutorWorkloadState.Closed, terminalOutcome: "tool_invocation_failed_before_dispatch", companionClaimFence: null });
		}
		finally
		{
			await _Cleanup(fixture);
		}
	});
});
