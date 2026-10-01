import { McpApprovalStatus, McpConnectionCredentialKind as PrismaCredentialKind, McpConnectionState as PrismaConnectionState, McpConnectionStatus as PrismaConnectionStatus, McpCredentialRequirement as PrismaCredentialRequirement, McpEraProbeStatus, McpInstallState, McpServerRevisionState, McpServerStatus, McpServerTransport, Prisma } from "@prisma/client";

import { McpConnectionCredentialKinds, McpConnectionFailureCodes, McpConnectionStatus, McpCredentialRequirement, McpInstallStates, type McpConnectionProjection } from "@opencrane/contracts";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { McpConnectionStates } from "./mcp-connection.types";
import type { McpConnectionInstallTarget, McpConnectionRecord, McpConnectionRemovalTarget, McpConnectionRepository, McpConnectionSecretIdentity, McpConnectionTaskBinding } from "./mcp-connection.types";
import type { McpConnectionActivationTaskInput, McpConnectionRevocationTaskInput } from "./mcp-connection.types";
import type { McpConnectionCredentialReadCommand } from "./mcp-connection-credential-reader.types";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

const _SELECT = {
	id: true,
	siloId: true,
	mcpServerInstallId: true,
	mcpServerId: true,
	ownerPrincipalId: true,
	actorPrincipalId: true,
	agentServiceId: true,
	generation: true,
	credentialRequirement: true,
	credentialKind: true,
	endpointDigest: true,
	state: true,
	requestKeyDigest: true,
	commandDigest: true,
	materialVerifier: true,
	materialVerifierKeyId: true,
	authorizationDecisionDigest: true,
	credentialSecretRef: true,
	credentialSecretUid: true,
	credentialSecretResourceVersion: true,
	credentialCustodiedAt: true,
	taskId: true,
	taskName: true,
	taskKey: true,
	revokeKeyDigest: true,
	revokeDecisionDigest: true,
	revokeTaskId: true,
	revokeTaskName: true,
	revokeTaskKey: true,
	failureCode: true,
	activatedAt: true,
	revokedAt: true,
	cleanupCompletedAt: true,
} as const satisfies Prisma.McpConnectionSelect;

type _Connection = Prisma.McpConnectionGetPayload<{ select: typeof _SELECT }>;

const _STATE_FROM_PRISMA: Readonly<Record<PrismaConnectionState, McpConnectionStates>> = {
	[PrismaConnectionState.AwaitingMaterial]: McpConnectionStates.AwaitingMaterial,
	[PrismaConnectionState.Activating]: McpConnectionStates.Activating,
	[PrismaConnectionState.Active]: McpConnectionStates.Active,
	[PrismaConnectionState.Revoked]: McpConnectionStates.Revoked,
	[PrismaConnectionState.Failed]: McpConnectionStates.Failed,
	[PrismaConnectionState.RecoveryRequired]: McpConnectionStates.RecoveryRequired,
};

const _STATE_TO_PRISMA: Readonly<Record<McpConnectionStates, PrismaConnectionState>> = {
	[McpConnectionStates.AwaitingMaterial]: PrismaConnectionState.AwaitingMaterial,
	[McpConnectionStates.Activating]: PrismaConnectionState.Activating,
	[McpConnectionStates.Active]: PrismaConnectionState.Active,
	[McpConnectionStates.Revoked]: PrismaConnectionState.Revoked,
	[McpConnectionStates.Failed]: PrismaConnectionState.Failed,
	[McpConnectionStates.RecoveryRequired]: PrismaConnectionState.RecoveryRequired,
};

const _REQUIREMENT_FROM_PRISMA: Readonly<Record<PrismaCredentialRequirement, McpCredentialRequirement>> = {
	[PrismaCredentialRequirement.Credentialless]: McpCredentialRequirement.Credentialless,
	[PrismaCredentialRequirement.PrincipalCredential]: McpCredentialRequirement.PrincipalCredential,
	[PrismaCredentialRequirement.SharedCredential]: McpCredentialRequirement.SharedCredential,
};

const _REQUIREMENT_TO_PRISMA: Readonly<Record<McpCredentialRequirement, PrismaCredentialRequirement>> = {
	[McpCredentialRequirement.Credentialless]: PrismaCredentialRequirement.Credentialless,
	[McpCredentialRequirement.PrincipalCredential]: PrismaCredentialRequirement.PrincipalCredential,
	[McpCredentialRequirement.SharedCredential]: PrismaCredentialRequirement.SharedCredential,
};

const _KIND_FROM_PRISMA: Readonly<Record<PrismaCredentialKind, McpConnectionCredentialKinds>> = {
	[PrismaCredentialKind.None]: McpConnectionCredentialKinds.None,
	[PrismaCredentialKind.Bearer]: McpConnectionCredentialKinds.Bearer,
};

const _KIND_TO_PRISMA: Readonly<Record<McpConnectionCredentialKinds, PrismaCredentialKind>> = {
	[McpConnectionCredentialKinds.None]: PrismaCredentialKind.None,
	[McpConnectionCredentialKinds.Bearer]: PrismaCredentialKind.Bearer,
};

const _STATUS_TO_PRISMA: Readonly<Record<McpConnectionStatus, PrismaConnectionStatus>> = {
	[McpConnectionStatus.NeedsCredential]: PrismaConnectionStatus.NeedsCredential,
	[McpConnectionStatus.Credentialless]: PrismaConnectionStatus.Credentialless,
	[McpConnectionStatus.Activating]: PrismaConnectionStatus.Activating,
	[McpConnectionStatus.Active]: PrismaConnectionStatus.Active,
	[McpConnectionStatus.RecoveryRequired]: PrismaConnectionStatus.RecoveryRequired,
};

const _INSTALL_STATE_FROM_PRISMA: Readonly<Record<McpInstallState, McpInstallStates>> = {
	[McpInstallState.Installed]: McpInstallStates.Installed,
	[McpInstallState.Removing]: McpInstallStates.Removing,
	[McpInstallState.Removed]: McpInstallStates.Removed,
};

/** Prisma adapter for one transaction's MCP connection rows and install projection. */
export class PrismaMcpConnectionRepository implements McpConnectionRepository
{
	constructor(private readonly _transaction: Prisma.TransactionClient) {}

	async lockInstall(siloId: string, serverId: string, ownerPrincipalId: string): Promise<McpConnectionInstallTarget | null>
	{
		await this._Lock(siloId, serverId, ownerPrincipalId);
		const server = await this._transaction.mcpServer.findFirst({
			where: { id: serverId, siloId, status: McpServerStatus.Active, approvalStatus: McpApprovalStatus.Published, transport: McpServerTransport.StreamableHttp, eraProbeStatus: McpEraProbeStatus.Accepted },
			select: { id: true, endpoint: true, credentialRequirement: true, installs: { where: { principalId: ownerPrincipalId, lifecycleState: McpInstallState.Installed }, take: 1, select: { id: true, connectionStatus: true } } },
		});
		if (!server)
			return null;
		const install = server.installs[0];
		if (install)
		{
			const locked = await this._transaction.mcpServerInstall.updateMany({ where: { id: install.id, mcpServerId: server.id, principalId: ownerPrincipalId, lifecycleState: McpInstallState.Installed, connectionStatus: install.connectionStatus }, data: { connectionStatus: install.connectionStatus } });
			if (locked.count !== 1)
				return null;
		}
		return { installId: install?.id ?? null, serverId: server.id, ownerPrincipalId, endpoint: server.endpoint, credentialRequirement: _REQUIREMENT_FROM_PRISMA[server.credentialRequirement] };
	}

	async lockInstallForRevocation(siloId: string, serverId: string, ownerPrincipalId: string): Promise<McpConnectionInstallTarget | null>
	{
		await this._Lock(siloId, serverId, ownerPrincipalId);
		const install = await this._transaction.mcpServerInstall.findFirst({
			where: { mcpServerId: serverId, principalId: ownerPrincipalId, lifecycleState: McpInstallState.Installed, mcpServer: { is: { siloId } } },
			select: { id: true, mcpServerId: true, principalId: true, connectionStatus: true, mcpServer: { select: { endpoint: true, credentialRequirement: true } } },
		});
		if (!install)
			return null;
		const locked = await this._transaction.mcpServerInstall.updateMany({ where: { id: install.id, mcpServerId: install.mcpServerId, principalId: install.principalId, lifecycleState: McpInstallState.Installed, connectionStatus: install.connectionStatus }, data: { connectionStatus: install.connectionStatus } });
		if (locked.count !== 1)
			return null;
		return { installId: install.id, serverId: install.mcpServerId, ownerPrincipalId: install.principalId, endpoint: install.mcpServer.endpoint, credentialRequirement: _REQUIREMENT_FROM_PRISMA[install.mcpServer.credentialRequirement] };
	}

	async lockInstallForRemoval(siloId: string, serverId: string, ownerPrincipalId: string): Promise<McpConnectionRemovalTarget | null>
	{
		await this._Lock(siloId, serverId, ownerPrincipalId);
		const install = await this._transaction.mcpServerInstall.findFirst({ where: { mcpServerId: serverId, principalId: ownerPrincipalId, mcpServer: { is: { siloId } } }, select: { id: true, mcpServerId: true, principalId: true, lifecycleState: true, connectionStatus: true } });
		if (!install)
			return null;
		const locked = await this._transaction.mcpServerInstall.updateMany({ where: { id: install.id, mcpServerId: install.mcpServerId, principalId: install.principalId, lifecycleState: install.lifecycleState, connectionStatus: install.connectionStatus }, data: { connectionStatus: install.connectionStatus } });
		if (locked.count !== 1)
			return null;
		return { installId: install.id, serverId: install.mcpServerId, ownerPrincipalId: install.principalId, lifecycleState: _INSTALL_STATE_FROM_PRISMA[install.lifecycleState] };
	}

	async createManagedInstall(target: McpConnectionInstallTarget): Promise<McpConnectionInstallTarget | null>
	{
		if (target.installId !== null)
			return target;
		const install = await this._transaction.mcpServerInstall.upsert({
			where: { mcpServerId_principalId: { mcpServerId: target.serverId, principalId: target.ownerPrincipalId } },
			create: { mcpServerId: target.serverId, principalId: target.ownerPrincipalId, lifecycleState: McpInstallState.Installed, connectionStatus: PrismaConnectionStatus.NeedsCredential },
			update: {},
			select: { id: true, lifecycleState: true },
		});
		if (install.lifecycleState !== McpInstallState.Installed)
			return null;
		return { ...target, installId: install.id };
	}

	async findByRequestKey(siloId: string, installId: string, requestKeyDigest: `sha256:${string}`): Promise<McpConnectionRecord | null>
	{
		const row = await this._transaction.mcpConnection.findUnique({ where: { siloId_mcpServerInstallId_requestKeyDigest: { siloId, mcpServerInstallId: installId, requestKeyDigest } }, select: _SELECT });
		return row ? _Record(row) : null;
	}

	async findByRevokeKey(siloId: string, installId: string, revokeKeyDigest: `sha256:${string}`): Promise<McpConnectionRecord | null>
	{
		const row = await this._transaction.mcpConnection.findUnique({ where: { siloId_mcpServerInstallId_revokeKeyDigest: { siloId, mcpServerInstallId: installId, revokeKeyDigest } }, select: _SELECT });
		return row ? _Record(row) : null;
	}

	async lockCurrent(siloId: string, installId: string): Promise<McpConnectionRecord | null>
	{
		const row = await this._transaction.mcpConnection.findFirst({ where: { siloId, mcpServerInstallId: installId }, orderBy: { generation: "desc" }, select: _SELECT });
		if (!row)
			return null;
		const locked = await this._transaction.mcpConnection.updateMany({ where: { id: row.id, siloId, mcpServerInstallId: installId, generation: row.generation, state: row.state }, data: { state: row.state } });
		return locked.count === 1 ? this._Read(row.id, siloId) : null;
	}

	async loadActivationTarget(input: McpConnectionActivationTaskInput, task: IWorkflowTaskReceipt): Promise<{ readonly record: McpConnectionRecord; readonly endpoint: string } | null>
	{
		const row = await this._transaction.mcpConnection.findFirst({
			where: {
				id: input.connectionId,
				siloId: input.siloId,
				generation: input.generation,
				commandDigest: input.commandDigest,
				state: PrismaConnectionState.Activating,
				taskId: task.taskId,
				taskName: task.taskName,
				taskKey: task.idempotencyKey,
				install: { is: { lifecycleState: McpInstallState.Installed, principalId: { not: "" } } },
				server: { is: { status: McpServerStatus.Active, approvalStatus: McpApprovalStatus.Published, transport: McpServerTransport.StreamableHttp, eraProbeStatus: McpEraProbeStatus.Accepted } },
			},
			select: { ..._SELECT, server: { select: { endpoint: true } } },
		});
		if (!row)
			return null;
		const { server, ...connection } = row;
		return { record: _Record(connection), endpoint: server.endpoint };
	}

	async loadActivationRecord(input: McpConnectionActivationTaskInput, task: IWorkflowTaskReceipt): Promise<McpConnectionRecord | null>
	{
		const row = await this._transaction.mcpConnection.findFirst({
			where: { id: input.connectionId, siloId: input.siloId, generation: input.generation, commandDigest: input.commandDigest, taskId: task.taskId, taskName: task.taskName, taskKey: task.idempotencyKey },
			select: _SELECT,
		});
		return row ? _Record(row) : null;
	}

	async loadRevocationTarget(input: McpConnectionRevocationTaskInput, task: IWorkflowTaskReceipt): Promise<McpConnectionRecord | null>
	{
		const row = await this._transaction.mcpConnection.findFirst({
			where: { id: input.connectionId, siloId: input.siloId, generation: input.generation, state: PrismaConnectionState.Revoked, revokeTaskId: task.taskId, revokeTaskName: task.taskName, revokeTaskKey: task.idempotencyKey },
			select: _SELECT,
		});
		return row ? _Record(row) : null;
	}

	async readExecutionCredential(command: McpConnectionCredentialReadCommand): Promise<McpConnectionRecord | null>
	{
		const row = await this._transaction.mcpConnection.findFirst({
			where: {
				id: command.connectionId,
				siloId: command.siloId,
				generation: command.generation,
				ownerPrincipalId: command.ownerPrincipalId,
				mcpServerId: command.serverId,
				state: { in: [PrismaConnectionState.Active, PrismaConnectionState.Revoked] },
				cleanupCompletedAt: null,
				revisions: { some: { id: command.serverRevisionId, state: McpServerRevisionState.Ready } },
			},
			select: _SELECT,
		});
		return row ? _Record(row) : null;
	}

	async create(record: Omit<McpConnectionRecord, "secretRef" | "secretUid" | "secretResourceVersion" | "credentialCustodiedAt" | "revokeKeyDigest" | "revokeDecisionDigest" | "revokeTask" | "failureCode" | "activatedAt" | "revokedAt" | "cleanupCompletedAt">): Promise<McpConnectionRecord>
	{
		const row = await this._transaction.mcpConnection.create({
			data: {
				id: record.id,
				siloId: record.siloId,
				mcpServerInstallId: record.installId,
				mcpServerId: record.serverId,
				ownerPrincipalId: record.ownerPrincipalId,
				actorPrincipalId: record.actorPrincipalId,
				agentServiceId: record.agentServiceId,
				generation: record.generation,
				credentialRequirement: _REQUIREMENT_TO_PRISMA[record.credentialRequirement],
				credentialKind: _KIND_TO_PRISMA[record.credentialKind],
				endpointDigest: record.endpointDigest,
				state: _STATE_TO_PRISMA[record.state],
				requestKeyDigest: record.requestKeyDigest,
				commandDigest: record.commandDigest,
				materialVerifier: record.materialVerifier,
				materialVerifierKeyId: record.materialVerifierKeyId,
				authorizationDecisionDigest: record.authorizationDecisionDigest,
				taskId: record.task.taskId,
				taskName: record.task.taskName,
				taskKey: record.task.taskKey,
			},
			select: _SELECT,
		});
		return _Record(row);
	}

	async markRevoked(record: McpConnectionRecord, command: { readonly actorPrincipalId: string; readonly revokeKeyDigest: `sha256:${string}`; readonly revokeDecisionDigest: `sha256:${string}`; readonly task: McpConnectionTaskBinding; readonly now: Date }): Promise<McpConnectionRecord | null>
	{
		const changed = await this._transaction.mcpConnection.updateMany({
			where: { id: record.id, siloId: record.siloId, generation: record.generation, state: _STATE_TO_PRISMA[record.state], revokeKeyDigest: null },
			data: { state: PrismaConnectionState.Revoked, revokeKeyDigest: command.revokeKeyDigest, revokeDecisionDigest: command.revokeDecisionDigest, revokeTaskId: command.task.taskId, revokeTaskName: command.task.taskName, revokeTaskKey: command.task.taskKey, revokedByPrincipalId: command.actorPrincipalId, revokedAt: command.now, completedAt: command.now },
		});
		if (changed.count !== 1)
			return null;
		return this._Read(record.id, record.siloId);
	}

	async bindCustody(record: McpConnectionRecord, binding: McpConnectionSecretIdentity | null, now: Date): Promise<McpConnectionRecord | null>
	{
		const changed = await this._transaction.mcpConnection.updateMany({
			where: { id: record.id, siloId: record.siloId, generation: record.generation, state: PrismaConnectionState.AwaitingMaterial, commandDigest: record.commandDigest },
			data: {
				state: PrismaConnectionState.Activating,
				credentialSecretRef: binding?.secretRef ?? null,
				credentialSecretUid: binding?.secretUid ?? null,
				credentialSecretResourceVersion: binding?.secretResourceVersion ?? null,
				credentialCustodiedAt: binding ? now : null,
			},
		});
		if (changed.count === 0)
		{
			const current = await this._Read(record.id, record.siloId);
			return current && _CustodyMatches(current, binding) ? current : null;
		}
		return this._Read(record.id, record.siloId);
	}

	async markRecoveryRequired(record: McpConnectionRecord, failureCode: McpConnectionFailureCodes, now: Date): Promise<McpConnectionRecord | null>
	{
		const changed = await this._transaction.mcpConnection.updateMany({
			where: { id: record.id, siloId: record.siloId, generation: record.generation, state: { in: [PrismaConnectionState.AwaitingMaterial, PrismaConnectionState.Activating] } },
			data: { state: PrismaConnectionState.RecoveryRequired, failureCode, completedAt: now },
		});
		if (changed.count === 0)
		{
			const current = await this._Read(record.id, record.siloId);
			return current?.state === McpConnectionStates.RecoveryRequired && current.failureCode === failureCode ? current : null;
		}
		return this._Read(record.id, record.siloId);
	}

	async markActivationFailed(record: McpConnectionRecord, failureCode: McpConnectionFailureCodes, now: Date): Promise<McpConnectionRecord | null>
	{
		const changed = await this._transaction.mcpConnection.updateMany({ where: { id: record.id, siloId: record.siloId, generation: record.generation, state: PrismaConnectionState.Activating }, data: { state: PrismaConnectionState.Failed, failureCode, completedAt: now } });
		if (changed.count === 0)
		{
			const current = await this._Read(record.id, record.siloId);
			return current?.state === McpConnectionStates.Failed && current.failureCode === failureCode ? current : null;
		}
		return this._Read(record.id, record.siloId);
	}

	async markCleanupFailed(record: McpConnectionRecord, failureCode: McpConnectionFailureCodes, now: Date): Promise<McpConnectionRecord | null>
	{
		const changed = await this._transaction.mcpConnection.updateMany({ where: { id: record.id, siloId: record.siloId, generation: record.generation, state: PrismaConnectionState.Revoked, cleanupCompletedAt: null }, data: { failureCode, completedAt: now } });
		if (changed.count === 0)
		{
			const current = await this._Read(record.id, record.siloId);
			return current?.state === McpConnectionStates.Revoked && current.failureCode === failureCode ? current : null;
		}
		return this._Read(record.id, record.siloId);
	}

	async markCleanupComplete(record: McpConnectionRecord, now: Date): Promise<McpConnectionRecord | null>
	{
		const changed = await this._transaction.mcpConnection.updateMany({ where: { id: record.id, siloId: record.siloId, generation: record.generation, state: PrismaConnectionState.Revoked, cleanupCompletedAt: null }, data: { cleanupCompletedAt: now } });
		if (changed.count === 0)
		{
			const current = await this._Read(record.id, record.siloId);
			return current?.cleanupCompletedAt ? current : null;
		}
		return this._Read(record.id, record.siloId);
	}

	async setInstallProjection(installId: string, projection: McpConnectionProjection): Promise<void>
	{
		await this._transaction.mcpServerInstall.updateMany({ where: { id: installId, lifecycleState: McpInstallState.Installed }, data: { connectionStatus: _STATUS_TO_PRISMA[projection.connectionStatus] } });
	}

	private async _Read(id: string, siloId: string): Promise<McpConnectionRecord | null>
	{
		const row = await this._transaction.mcpConnection.findFirst({ where: { id, siloId }, select: _SELECT });
		return row ? _Record(row) : null;
	}

	private async _Lock(siloId: string, serverId: string, ownerPrincipalId: string): Promise<void>
	{
		const identityDigest = ___DigestCanonicalJson({ siloId, serverId, ownerPrincipalId } as JsonValue);
		await this._transaction.mcpConnectionAdmissionClaim.upsert({
			where: { siloId_identityDigest: { siloId, identityDigest } },
			create: { siloId, identityDigest },
			update: { touchedAt: new Date() },
			select: { identityDigest: true },
		});
	}
}

function _Record(row: _Connection): McpConnectionRecord
{
	const task = { taskId: row.taskId, taskName: row.taskName, taskKey: row.taskKey };
	const revokeTask = _OptionalTask(row.revokeTaskId, row.revokeTaskName, row.revokeTaskKey);
	const failureCode = row.failureCode === null ? null : _FailureCode(row.failureCode);
	return {
		id: row.id,
		siloId: row.siloId,
		installId: row.mcpServerInstallId,
		serverId: row.mcpServerId,
		ownerPrincipalId: row.ownerPrincipalId,
		actorPrincipalId: row.actorPrincipalId,
		agentServiceId: row.agentServiceId,
		generation: row.generation,
		credentialRequirement: _REQUIREMENT_FROM_PRISMA[row.credentialRequirement],
		credentialKind: _KIND_FROM_PRISMA[row.credentialKind],
		endpointDigest: _Sha256(row.endpointDigest),
		state: _STATE_FROM_PRISMA[row.state],
		requestKeyDigest: _Sha256(row.requestKeyDigest),
		commandDigest: _Sha256(row.commandDigest),
		materialVerifier: _Verifier(row.materialVerifier),
		materialVerifierKeyId: row.materialVerifierKeyId,
		authorizationDecisionDigest: _Sha256(row.authorizationDecisionDigest),
		secretRef: row.credentialSecretRef,
		secretUid: row.credentialSecretUid,
		secretResourceVersion: row.credentialSecretResourceVersion,
		credentialCustodiedAt: row.credentialCustodiedAt,
		task,
		revokeKeyDigest: row.revokeKeyDigest === null ? null : _Sha256(row.revokeKeyDigest),
		revokeDecisionDigest: row.revokeDecisionDigest === null ? null : _Sha256(row.revokeDecisionDigest),
		revokeTask,
		failureCode,
		activatedAt: row.activatedAt,
		revokedAt: row.revokedAt,
		cleanupCompletedAt: row.cleanupCompletedAt,
	};
}

function _OptionalTask(id: string | null, name: string | null, key: string | null): McpConnectionTaskBinding | null
{
	if (id === null && name === null && key === null)
		return null;
	if (id === null || name === null || key === null)
		throw new Error("MCP connection has an incomplete revocation task binding.");
	return { taskId: id, taskName: name, taskKey: key };
}

function _FailureCode(value: string): McpConnectionFailureCodes
{
	if (Object.values(McpConnectionFailureCodes).includes(value as McpConnectionFailureCodes))
		return value as McpConnectionFailureCodes;
	throw new Error("MCP connection has an unknown failure code.");
}

function _Sha256(value: string): `sha256:${string}`
{
	if (!/^sha256:[a-f0-9]{64}$/u.test(value))
		throw new Error("MCP connection has an invalid SHA-256 digest.");
	return value as `sha256:${string}`;
}

function _Verifier(value: string | null): `hmac-sha256:${string}` | null
{
	if (value === null)
		return null;
	if (!/^hmac-sha256:[a-f0-9]{64}$/u.test(value))
		throw new Error("MCP connection has an invalid material verifier.");
	return value as `hmac-sha256:${string}`;
}

function _CustodyMatches(record: McpConnectionRecord, binding: McpConnectionSecretIdentity | null): boolean
{
	if (record.state !== McpConnectionStates.Activating && record.state !== McpConnectionStates.Active)
		return false;
	if (binding === null)
		return record.secretRef === null && record.secretUid === null && record.secretResourceVersion === null;
	return record.secretRef === binding.secretRef && record.secretUid === binding.secretUid && record.secretResourceVersion === binding.secretResourceVersion;
}
