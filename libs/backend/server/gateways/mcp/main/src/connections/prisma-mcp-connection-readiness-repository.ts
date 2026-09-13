import { McpApprovalStatus, McpConnectionState, McpConnectionStatus, McpCredentialRequirement, McpExecutionTransport, McpInstallState, McpServerRevisionState, McpServerStatus, type Prisma } from "@prisma/client";

import { McpConnectionStatus as ContractConnectionStatus, McpCredentialRequirement as ContractCredentialRequirement } from "@opencrane/contracts";

import { MCP_ERA_PROTOCOL_VERSION } from "../era-probe/mcp-era-probe.types";
import { McpConnectionReadinessTransports, type McpConnectionReadiness, type McpConnectionReadinessCommand, type McpConnectionReadinessTarget } from "./mcp-connection-readiness.types";
import { McpConnectionStates } from "./mcp-connection.types";

const _STATUS_FROM_PRISMA: Readonly<Record<McpConnectionStatus, ContractConnectionStatus>> = {
	[McpConnectionStatus.NeedsCredential]: ContractConnectionStatus.NeedsCredential,
	[McpConnectionStatus.Credentialless]: ContractConnectionStatus.Credentialless,
	[McpConnectionStatus.Activating]: ContractConnectionStatus.Activating,
	[McpConnectionStatus.Active]: ContractConnectionStatus.Active,
	[McpConnectionStatus.RecoveryRequired]: ContractConnectionStatus.RecoveryRequired,
};

const _STATUS_TO_PRISMA: Readonly<Record<ContractConnectionStatus, McpConnectionStatus>> = {
	[ContractConnectionStatus.NeedsCredential]: McpConnectionStatus.NeedsCredential,
	[ContractConnectionStatus.Credentialless]: McpConnectionStatus.Credentialless,
	[ContractConnectionStatus.Activating]: McpConnectionStatus.Activating,
	[ContractConnectionStatus.Active]: McpConnectionStatus.Active,
	[ContractConnectionStatus.RecoveryRequired]: McpConnectionStatus.RecoveryRequired,
};

const _REQUIREMENT_FROM_PRISMA: Readonly<Record<McpCredentialRequirement, ContractCredentialRequirement>> = {
	[McpCredentialRequirement.Credentialless]: ContractCredentialRequirement.Credentialless,
	[McpCredentialRequirement.PrincipalCredential]: ContractCredentialRequirement.PrincipalCredential,
	[McpCredentialRequirement.SharedCredential]: ContractCredentialRequirement.SharedCredential,
};

const _TRANSPORT_FROM_PRISMA: Readonly<Record<McpExecutionTransport, McpConnectionReadinessTransports>> = {
	[McpExecutionTransport.OciImage]: McpConnectionReadinessTransports.OciImage,
	[McpExecutionTransport.RemoteHttp]: McpConnectionReadinessTransports.RemoteHttp,
};

const _STATE_FROM_PRISMA: Readonly<Record<McpConnectionState, McpConnectionStates>> = {
	[McpConnectionState.AwaitingMaterial]: McpConnectionStates.AwaitingMaterial,
	[McpConnectionState.Activating]: McpConnectionStates.Activating,
	[McpConnectionState.Active]: McpConnectionStates.Active,
	[McpConnectionState.Revoked]: McpConnectionStates.Revoked,
	[McpConnectionState.Failed]: McpConnectionStates.Failed,
	[McpConnectionState.RecoveryRequired]: McpConnectionStates.RecoveryRequired,
};

const _TARGET_SELECT = {
	id: true,
	mcpServerId: true,
	principalId: true,
	connectionStatus: true,
	mcpServer: {
		select: {
			credentialRequirement: true,
			revisions: {
				select: { transport: true, connectionId: true, connectionGeneration: true, connectionOwnerPrincipalId: true, endpointDigest: true, connection: { select: { id: true, mcpServerInstallId: true, ownerPrincipalId: true, generation: true, endpointDigest: true, state: true } } },
			},
		},
	},
} as const satisfies Prisma.McpServerInstallSelect;

type _PrismaReadinessTarget = Prisma.McpServerInstallGetPayload<{ select: typeof _TARGET_SELECT }>;

/** Owns the exact server, revision, installation and connection checks for an MCP effect. */
export class PrismaMcpConnectionReadinessRepository implements McpConnectionReadiness
{
	/** Prisma client for the caller's open transaction. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Bind every readiness read or claim to the transaction that admits the effect. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
	}

	/** @inheritdoc */
	async isReady(command: McpConnectionReadinessCommand): Promise<boolean>
	{
		return await this._ReadTarget(command) !== null;
	}

	/** @inheritdoc */
	async lockForDispatch(command: McpConnectionReadinessCommand): Promise<boolean>
	{
		const target = await this._ReadTarget(command);
		if (target === null)
			return false;
		const locked = await this._transaction.mcpServerInstall.updateMany({
			where: { id: target.id, mcpServerId: target.mcpServerId, principalId: target.principalId, lifecycleState: McpInstallState.Installed, connectionStatus: _STATUS_TO_PRISMA[target.connectionStatus] },
			data: { connectionStatus: _STATUS_TO_PRISMA[target.connectionStatus] },
		});
		if (locked.count !== 1)
			return false;
		const revision = target.mcpServer.revisions[0];
		if (!revision || revision.transport === McpConnectionReadinessTransports.OciImage)
			return revision?.transport === McpConnectionReadinessTransports.OciImage;
		const connection = revision.connection;
		if (!connection)
			return false;
		const connectionLocked = await this._transaction.mcpConnection.updateMany({
			where: { id: connection.id, mcpServerInstallId: connection.mcpServerInstallId, ownerPrincipalId: connection.ownerPrincipalId, generation: connection.generation, endpointDigest: connection.endpointDigest, state: McpConnectionState.Active },
			data: { state: McpConnectionState.Active },
		});
		return connectionLocked.count === 1;
	}

	private async _ReadTarget(command: McpConnectionReadinessCommand): Promise<McpConnectionReadinessTarget | null>
	{
		const target = await this._transaction.mcpServerInstall.findFirst({
			where: _ReadyInstall(command),
			select: { ..._TARGET_SELECT, mcpServer: { select: { ..._TARGET_SELECT.mcpServer.select, revisions: { ..._TARGET_SELECT.mcpServer.select.revisions, where: _ReadyRevision(command), take: 2 } } } },
		});
		if (target === null || target.mcpServer.revisions.length !== 1)
			return null;
		const mapped = _MapTarget(target);
		return _TargetIsReady(mapped, command.ownerPrincipalId) ? mapped : null;
	}
}

/** Bind an installation to the exact usable tool and server without inferring from presentation. */
function _ReadyInstall(command: McpConnectionReadinessCommand): Prisma.McpServerInstallWhereInput
{
	return {
		principalId: command.ownerPrincipalId,
		lifecycleState: McpInstallState.Installed,
		mcpServer: {
			is: {
				siloId: command.siloId,
				status: McpServerStatus.Active,
				approvalStatus: McpApprovalStatus.Published,
				revisions: { some: _ReadyRevision(command) },
			},
		},
	};
}

/** Select the one Ready server revision that owns the requested tool. */
function _ReadyRevision(command: McpConnectionReadinessCommand): Prisma.McpServerRevisionWhereInput
{
	return { state: McpServerRevisionState.Ready, protocolVersion: MCP_ERA_PROTOCOL_VERSION, tools: { some: { id: command.toolRevisionId, siloId: command.siloId } } };
}

/** Require the selected tool revision's one execution strategy to match its current owner. */
function _TargetIsReady(target: McpConnectionReadinessTarget, ownerPrincipalId: string): boolean
{
	const revision = target.mcpServer.revisions[0];
	if (!revision)
		return false;
	if (revision.transport === McpConnectionReadinessTransports.OciImage)
		return target.connectionStatus === ContractConnectionStatus.Credentialless
			&& target.mcpServer.credentialRequirement === ContractCredentialRequirement.Credentialless
			&& revision.connection === null;
	if (revision.transport !== McpConnectionReadinessTransports.RemoteHttp || target.connectionStatus !== ContractConnectionStatus.Active)
		return false;
	const connection = revision.connection;
	return connection !== null
		&& revision.connectionId === connection.id
		&& revision.connectionGeneration === connection.generation
		&& revision.connectionOwnerPrincipalId === ownerPrincipalId
		&& revision.endpointDigest === connection.endpointDigest
		&& connection.mcpServerInstallId === target.id
		&& connection.ownerPrincipalId === ownerPrincipalId
		&& connection.state === McpConnectionStates.Active;
}

function _MapTarget(target: _PrismaReadinessTarget): McpConnectionReadinessTarget
{
	return {
		id: target.id,
		mcpServerId: target.mcpServerId,
		principalId: target.principalId,
		connectionStatus: _STATUS_FROM_PRISMA[target.connectionStatus],
		mcpServer: {
			credentialRequirement: _REQUIREMENT_FROM_PRISMA[target.mcpServer.credentialRequirement],
			revisions: target.mcpServer.revisions.map(function _Revision(revision)
			{
				return {
					...revision,
					transport: _TRANSPORT_FROM_PRISMA[revision.transport],
					connection: revision.connection ? { ...revision.connection, state: _STATE_FROM_PRISMA[revision.connection.state] } : null,
				};
			}),
		},
	};
}
