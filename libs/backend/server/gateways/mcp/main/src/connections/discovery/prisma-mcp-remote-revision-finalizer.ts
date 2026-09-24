import { McpApprovalStatus, McpConnectionCredentialKind as PrismaMcpConnectionCredentialKind, McpConnectionState, McpConnectionStatus, McpCredentialRequirement as PrismaMcpCredentialRequirement, McpExecutionTransport, McpInstallState, McpServerRevisionState, McpServerStatus, McpServerTransport, type Prisma } from "@prisma/client";

import type { AuthorizationAuthority, ManagedAuthorizationGrantRepository, ManagedAuthorizationGrantSpec } from "@opencrane/backend/server/iam/authorization";
import { MCP_PROTOCOL_VERSION, McpConnectionCredentialKinds, McpCredentialRequirement } from "@opencrane/contracts";
import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationDecisionOutcomes, AuthorizationSubjectKinds, ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { McpRemoteRevisionFinalizationOutcomes } from "./mcp-authenticated-connection-discovery.types";
import type { McpRemoteRevisionFinalizationCommand, McpRemoteRevisionFinalizationRepository, McpRemoteRevisionFinalizationResult } from "./mcp-authenticated-connection-discovery.types";
import { __McpConnectionEndpointDigest, __McpConnectionGrantManagerId } from "../mcp-connection-digests";
import { __PlanMcpConnectionLifecycle, McpConnectionLifecycleActions, McpConnectionLifecycleEvents } from "../mcp-connection-lifecycle";
import { McpConnectionStates } from "../mcp-connection.types";

/** Map the public credential requirement into Prisma's generated enum. */
const _PRISMA_REQUIREMENT: Readonly<Record<McpCredentialRequirement, PrismaMcpCredentialRequirement>> = {
	[McpCredentialRequirement.Credentialless]: PrismaMcpCredentialRequirement.Credentialless,
	[McpCredentialRequirement.PrincipalCredential]: PrismaMcpCredentialRequirement.PrincipalCredential,
	[McpCredentialRequirement.SharedCredential]: PrismaMcpCredentialRequirement.SharedCredential,
};

/** Map the write-only credential kind into Prisma's generated enum. */
const _PRISMA_CREDENTIAL_KIND: Readonly<Record<McpConnectionCredentialKinds, PrismaMcpConnectionCredentialKind>> = {
	[McpConnectionCredentialKinds.None]: PrismaMcpConnectionCredentialKind.None,
	[McpConnectionCredentialKinds.Bearer]: PrismaMcpConnectionCredentialKind.Bearer,
};

/** Fields needed to compare a replayed remote revision with the requested discovery result. */
const _REVISION_SELECT = {
	id: true,
	transport: true,
	connectionId: true,
	connectionGeneration: true,
	connectionOwnerPrincipalId: true,
	endpointDigest: true,
	discoveryEvidenceDigest: true,
	discoveryDigest: true,
	protocolVersion: true,
	state: true,
	tools: { orderBy: { name: "asc" }, select: { name: true, description: true, inputSchemaDigest: true } },
} as const satisfies Prisma.McpServerRevisionSelect;

/** Transaction-scoped finalizer for a connection-bound MCP server revision. */
export class PrismaMcpRemoteRevisionFinalizationRepository implements McpRemoteRevisionFinalizationRepository
{
	/** Prisma client bound to the caller's serializable transaction. */
	private readonly _transaction: Prisma.TransactionClient;
	/** Central current-grant authority evaluated after the install lock. */
	private readonly _authorization: AuthorizationAuthority;
	/** Central managed-grant writer for the discovered tools. */
	private readonly _grants: ManagedAuthorizationGrantRepository;

	/** Bind all reads, writes, decisions, and grants to the same transaction. */
	constructor(transaction: Prisma.TransactionClient, authorization: AuthorizationAuthority, grants: ManagedAuthorizationGrantRepository)
	{
		this._transaction = transaction;
		this._authorization = authorization;
		this._grants = grants;
	}

	/** @inheritdoc */
	async finalize(command: McpRemoteRevisionFinalizationCommand): Promise<McpRemoteRevisionFinalizationResult>
	{
		const record = command.record;
		const taskMatches = command.task.taskId === record.task.taskId && command.task.taskName === record.task.taskName && command.task.idempotencyKey === record.task.taskKey;
		if (!taskMatches || command.protocolVersion !== MCP_PROTOCOL_VERSION || !_ToolsAreValid(command.tools))
			return { outcome: McpRemoteRevisionFinalizationOutcomes.Denied };
		const tools = command.tools.toSorted(_ByToolName);
		const clock = await this._transaction.mcpRuntimeClock.findUnique({ where: { singleton: 1 } });
		if (clock === null)
			throw new Error("MCP authority clock is unavailable");
		const now = clock.now;

		// The install lock makes uninstall and activation choose one database winner.
		const install = await this._transaction.mcpServerInstall.updateMany({ where: { id: record.installId, mcpServerId: record.serverId, principalId: record.ownerPrincipalId, lifecycleState: McpInstallState.Installed, connectionStatus: { in: [McpConnectionStatus.Activating, McpConnectionStatus.Active] } }, data: { updatedAt: now } });
		if (install.count !== 1)
			return { outcome: McpRemoteRevisionFinalizationOutcomes.Denied };
		const server = await this._transaction.mcpServer.findFirst({ where: { id: record.serverId, siloId: record.siloId, status: McpServerStatus.Active, approvalStatus: McpApprovalStatus.Published, transport: McpServerTransport.StreamableHttp }, select: { endpoint: true } });
		if (server === null || __McpConnectionEndpointDigest(server.endpoint) !== record.endpointDigest)
			return { outcome: McpRemoteRevisionFinalizationOutcomes.Denied };
		const connection = await this._transaction.mcpConnection.findFirst({
			where: {
				id: record.id,
				siloId: record.siloId,
				mcpServerInstallId: record.installId,
				mcpServerId: record.serverId,
				ownerPrincipalId: record.ownerPrincipalId,
				actorPrincipalId: record.actorPrincipalId,
				agentServiceId: record.agentServiceId,
				generation: record.generation,
				credentialRequirement: _PRISMA_REQUIREMENT[record.credentialRequirement],
				credentialKind: _PRISMA_CREDENTIAL_KIND[record.credentialKind],
				endpointDigest: record.endpointDigest,
				requestKeyDigest: record.requestKeyDigest,
				commandDigest: record.commandDigest,
				materialVerifier: record.materialVerifier,
				materialVerifierKeyId: record.materialVerifierKeyId,
				authorizationDecisionDigest: record.authorizationDecisionDigest,
				credentialSecretRef: record.secretRef,
				credentialSecretUid: record.secretUid,
				credentialSecretResourceVersion: record.secretResourceVersion,
				credentialCustodiedAt: record.credentialCustodiedAt,
				taskId: record.task.taskId,
				taskName: record.task.taskName,
				taskKey: record.task.taskKey,
				state: { in: [McpConnectionState.Activating, McpConnectionState.Active] },
			},
			select: { state: true },
		});
		if (connection === null)
			return { outcome: McpRemoteRevisionFinalizationOutcomes.Denied };
		const decision = await this._authorization.decide({ siloId: record.siloId, principalId: record.ownerPrincipalId, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId: record.ownerPrincipalId }, resource: { kind: ProductAuthorizationResourceKinds.ProviderConnection, id: record.id }, action: ProductAuthorizationActions.Use, nowEpochMs: now.getTime() });
		if (decision.outcome !== AuthorizationDecisionOutcomes.Allow)
			return { outcome: McpRemoteRevisionFinalizationOutcomes.Denied };

		const existing = await this._transaction.mcpServerRevision.findUnique({ where: { connectionId_connectionGeneration: { connectionId: record.id, connectionGeneration: record.generation } }, select: _REVISION_SELECT });
		if (existing !== null)
			return _Replay(existing, command, connection.state);
		const lifecycle = __PlanMcpConnectionLifecycle(_ConnectionState(connection.state), McpConnectionLifecycleEvents.DiscoveryCompleted);
		if (lifecycle.action !== McpConnectionLifecycleActions.Advance || lifecycle.state !== McpConnectionStates.Active)
			return { outcome: McpRemoteRevisionFinalizationOutcomes.Conflict };

		// Updating the server clock serializes revision numbers across OCI and remote writers.
		const lockedServer = await this._transaction.mcpServer.updateMany({ where: { id: record.serverId, siloId: record.siloId, status: McpServerStatus.Active, approvalStatus: McpApprovalStatus.Published, transport: McpServerTransport.StreamableHttp }, data: { updatedAt: now } });
		if (lockedServer.count !== 1)
			return { outcome: McpRemoteRevisionFinalizationOutcomes.Denied };
		const latest = await this._transaction.mcpServerRevision.findFirst({ where: { mcpServerId: record.serverId, siloId: record.siloId }, orderBy: { revision: "desc" }, select: { revision: true } });
		const revision = await this._transaction.mcpServerRevision.create({ data: { siloId: record.siloId, mcpServerId: record.serverId, revision: (latest?.revision ?? 0) + 1, transport: McpExecutionTransport.RemoteHttp, connectionId: record.id, connectionGeneration: record.generation, connectionOwnerPrincipalId: record.ownerPrincipalId, endpointDigest: record.endpointDigest, discoveryEvidenceDigest: command.discoveryEvidenceDigest, discoveryDigest: command.discoveryDigest, state: McpServerRevisionState.Discovering }, select: { id: true } });
		for (const tool of tools)
		{
			const inputSchemaDigest = ___DigestCanonicalJson(tool.inputSchema);
			const stored = await this._transaction.mcpToolRevision.create({ data: { siloId: record.siloId, serverRevisionId: revision.id, name: tool.name, description: tool.description, inputSchema: tool.inputSchema as Prisma.InputJsonValue, inputSchemaDigest }, select: { id: true } });
			await this._GrantOwner(record.siloId, record.ownerPrincipalId, record.actorPrincipalId, record.id, stored.id, now);
		}
		const ready = await this._transaction.mcpServerRevision.updateMany({ where: { id: revision.id, siloId: record.siloId, state: McpServerRevisionState.Discovering, discoveryDigest: command.discoveryDigest }, data: { state: McpServerRevisionState.Ready, protocolVersion: command.protocolVersion, completedAt: now } });
		const activated = await this._transaction.mcpConnection.updateMany({ where: { id: record.id, siloId: record.siloId, generation: record.generation, state: McpConnectionState.Activating }, data: { state: McpConnectionState.Active, activatedAt: now, completedAt: now } });
		const projected = await this._transaction.mcpServerInstall.updateMany({ where: { id: record.installId, mcpServerId: record.serverId, principalId: record.ownerPrincipalId, lifecycleState: McpInstallState.Installed, connectionStatus: McpConnectionStatus.Activating }, data: { connectionStatus: McpConnectionStatus.Active, updatedAt: now } });
		if (ready.count !== 1 || activated.count !== 1 || projected.count !== 1)
			throw new Error("MCP remote revision finalization lost its transaction fence");
		return { outcome: McpRemoteRevisionFinalizationOutcomes.Completed, serverRevisionId: revision.id };
	}

	/** Grant only the connection owner Read and Invoke access to one discovered tool. */
	private async _GrantOwner(siloId: string, ownerPrincipalId: string, actorPrincipalId: string, connectionId: string, toolRevisionId: string, now: Date): Promise<void>
	{
		const resource = { kind: ProductAuthorizationResourceKinds.McpToolRevision, id: toolRevisionId } as const;
		const actions = [ProductAuthorizationActions.Read, ProductAuthorizationActions.Invoke] as const;
		const grants = actions.map(function _Grant(action): ManagedAuthorizationGrantSpec
		{
			const capability = __ProductAuthorizationCapability(resource.kind, action);
			if (capability === null)
				throw new Error("MCP tool owner capability is unavailable");
			return { subject: { kind: AuthorizationSubjectKinds.Principal, principalId: ownerPrincipalId }, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId: ownerPrincipalId }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability, resource, priority: 0, createdByPrincipalId: actorPrincipalId };
		});
		await this._grants.reconcileManagedResourceGrants({ siloId, managerId: __McpConnectionGrantManagerId(connectionId), resource, grants, now });
	}
}

/** Compare an existing winner with every durable discovery coordinate. */
function _Replay(existing: Prisma.McpServerRevisionGetPayload<{ select: typeof _REVISION_SELECT }>, command: McpRemoteRevisionFinalizationCommand, connectionState: McpConnectionState): McpRemoteRevisionFinalizationResult
{
	const record = command.record;
	const storedTools = existing.tools.toSorted(_ByToolName);
	const expectedTools = command.tools.toSorted(_ByToolName).map(function _Tool(tool) { return { name: tool.name, description: tool.description, inputSchemaDigest: ___DigestCanonicalJson(tool.inputSchema as JsonValue) }; });
	const matches = connectionState === McpConnectionState.Active
		&& existing.transport === McpExecutionTransport.RemoteHttp
		&& existing.connectionId === record.id
		&& existing.connectionGeneration === record.generation
		&& existing.connectionOwnerPrincipalId === record.ownerPrincipalId
		&& existing.endpointDigest === record.endpointDigest
		&& existing.discoveryEvidenceDigest === command.discoveryEvidenceDigest
		&& existing.discoveryDigest === command.discoveryDigest
		&& existing.protocolVersion === command.protocolVersion
		&& existing.state === McpServerRevisionState.Ready
		&& ___DigestCanonicalJson(storedTools as unknown as JsonValue) === ___DigestCanonicalJson(expectedTools as unknown as JsonValue);
	return matches ? { outcome: McpRemoteRevisionFinalizationOutcomes.Replayed, serverRevisionId: existing.id } : { outcome: McpRemoteRevisionFinalizationOutcomes.Conflict };
}

/** Compare protocol names by Unicode code unit so database collation cannot alter replay. */
function _ByToolName(first: { readonly name: string }, second: { readonly name: string }): number
{
	if (first.name < second.name)
		return -1;
	if (first.name > second.name)
		return 1;
	return 0;
}

/** Refuse partial, duplicate, or unexpectedly large tool sets at the transaction boundary. */
function _ToolsAreValid(tools: McpRemoteRevisionFinalizationCommand["tools"]): boolean
{
	if (tools.length > 512)
		return false;
	return new Set(tools.map(function _Name(tool) { return tool.name; })).size === tools.length;
}

/** Map the two states selected by finalization into the shared lifecycle policy. */
function _ConnectionState(state: McpConnectionState): McpConnectionStates
{
	return state === McpConnectionState.Activating ? McpConnectionStates.Activating : McpConnectionStates.Active;
}
