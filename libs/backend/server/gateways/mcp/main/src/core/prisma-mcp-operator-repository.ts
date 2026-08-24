import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";
import type { McpEraProbeStatus } from "@prisma/client";

import { McpEraProbeDecisions, McpEraProbeStates } from "../era-probe/mcp-era-probe.types";
import type { McpEraProbeTaskResult } from "../era-probe/mcp-era-probe.types";
import type { IMcpOperatorRepository, McpEraProbeRetryResult, McpEraProbeTargetRecord, McpEraProbeWriteResult, McpOperatorAuditActor, McpOperatorInstallRecord, McpOperatorPrincipalRecord, McpOperatorServerRecord, McpRemoteServerCreateResult, McpRemoteServerRegistrationRecord } from "./mcp-operator-repository.types";

/** Fields shared by public catalogue mapping and era-probe state transitions. */
const _SERVER_SELECT = { id: true, name: true, description: true, publisher: true, glyph: true, serverType: true, approvalStatus: true, credentialSchema: true, entitlementSummary: true, endpoint: true, registrationKeyDigest: true, registrationDigest: true, eraProbeStatus: true, eraProtocolVersion: true, eraProbeEvidenceDigest: true, eraProbeFailureCode: true, eraProbeAttempts: true } as const satisfies Prisma.McpServerSelect;

/** Fields loaded by a worker before it makes an external request. */
const _ERA_PROBE_TARGET_SELECT = { endpoint: true, registrationDigest: true, eraProbeStatus: true, eraProtocolVersion: true, eraProbeEvidenceDigest: true, eraProbeFailureCode: true, eraProbeAttempts: true } as const satisfies Prisma.McpServerSelect;

/** Prisma projection returned for the complete MCP server selection. */
type _ServerProjection = Prisma.McpServerGetPayload<{ select: typeof _SERVER_SELECT }>;

/** Prisma projection returned when a protocol-check worker loads its target. */
type _EraProbeTargetProjection = Prisma.McpServerGetPayload<{ select: typeof _ERA_PROBE_TARGET_SELECT }>;

/** Derive a fixed-width claim identity without retaining a server name or client key. */
function _ClaimDigest(kind: "key" | "name", value: string): string
{
	return `sha256:${createHash("sha256").update(`${kind}:${value}`).digest("hex")}`;
}

/** Translate Prisma's enum before a stored protocol-check state reaches domain code. */
function _EraProbeState(value: McpEraProbeStatus): McpEraProbeStates
{
	if (value === "NotRequired")
		return McpEraProbeStates.NotRequired;
	if (value === "Pending")
		return McpEraProbeStates.Pending;
	if (value === "Accepted")
		return McpEraProbeStates.Accepted;
	if (value === "Rejected")
		return McpEraProbeStates.Rejected;
	throw new Error("MCP server has an unknown protocol-check state.");
}

/** Translate one Prisma server projection into the MCP repository contract. */
function _ServerRecord(server: _ServerProjection): McpOperatorServerRecord
{
	return { ...server, eraProbeStatus: _EraProbeState(server.eraProbeStatus) };
}

/** Translate one Prisma worker target into the MCP repository contract. */
function _EraProbeTargetRecord(target: _EraProbeTargetProjection): Omit<McpEraProbeTargetRecord, "registrationDigest"> & { readonly registrationDigest: string | null }
{
	return { ...target, eraProbeStatus: _EraProbeState(target.eraProbeStatus) };
}

/** Transaction-scoped Prisma adapter for MCP product authority. */
export class PrismaMcpOperatorRepository implements IMcpOperatorRepository
{
	private readonly _transaction: Prisma.TransactionClient;

	constructor(transaction: Prisma.TransactionClient) { this._transaction = transaction; }

	async listPublishedServers(siloId: string): Promise<readonly McpOperatorServerRecord[]>
	{
		return (await this._transaction.mcpServer.findMany({ where: { siloId, approvalStatus: "Published" }, orderBy: { createdAt: "desc" }, select: _SERVER_SELECT })).map(_ServerRecord);
	}

	async listAllServers(siloId: string): Promise<readonly McpOperatorServerRecord[]>
	{
		return (await this._transaction.mcpServer.findMany({ where: { siloId }, orderBy: { createdAt: "desc" }, select: _SERVER_SELECT })).map(_ServerRecord);
	}

	async findServer(siloId: string, serverId: string): Promise<McpOperatorServerRecord | null>
	{
		const server = await this._transaction.mcpServer.findFirst({ where: { id: serverId, siloId }, select: _SERVER_SELECT });
		return server ? _ServerRecord(server) : null;
	}

	async listInstalls(principalId: string): Promise<readonly McpOperatorInstallRecord[]>
	{
		return this._transaction.mcpServerInstall.findMany({ where: { principalId }, orderBy: { createdAt: "asc" }, select: { mcpServerId: true, connectionStatus: true, lastUsedAt: true } });
	}

	async upsertInstall(serverId: string, principalId: string, connectionStatus: string): Promise<McpOperatorInstallRecord>
	{
		return this._transaction.mcpServerInstall.upsert({ where: { mcpServerId_principalId: { mcpServerId: serverId, principalId } }, create: { mcpServerId: serverId, principalId, connectionStatus: connectionStatus as Prisma.McpServerInstallCreateInput["connectionStatus"] }, update: {}, select: { mcpServerId: true, connectionStatus: true, lastUsedAt: true } });
	}

	async deleteInstall(serverId: string, principalId: string): Promise<boolean>
	{
		const result = await this._transaction.mcpServerInstall.deleteMany({ where: { mcpServerId: serverId, principalId } });
		return result.count > 0;
	}

	async setApprovalStatus(siloId: string, serverId: string, approvalStatus: string, requiredEraProbeStatuses?: readonly McpEraProbeStates[], requiredApprovalStatus?: string): Promise<McpOperatorServerRecord | null>
	{
		const where: Prisma.McpServerWhereInput = { id: serverId, siloId };
		if (requiredEraProbeStatuses)
			where.eraProbeStatus = { in: [...requiredEraProbeStatuses] as McpEraProbeStatus[] };
		if (requiredApprovalStatus)
			where.approvalStatus = requiredApprovalStatus as Prisma.McpServerWhereInput["approvalStatus"];
		const changed = await this._transaction.mcpServer.updateMany({ where, data: { approvalStatus: approvalStatus as Prisma.McpServerUpdateInput["approvalStatus"] } });
		if (changed.count !== 1)
			return null;
		const server = await this._transaction.mcpServer.findFirst({ where: { id: serverId, siloId }, select: _SERVER_SELECT });
		return server ? _ServerRecord(server) : null;
	}

	/** Create a draft server or return the row admitted by the same registration key. */
	async createOrFindRemoteServer(registration: McpRemoteServerRegistrationRecord): Promise<McpRemoteServerCreateResult | null>
	{
		const claimDigests = [
			_ClaimDigest("key", registration.registrationKeyDigest),
			_ClaimDigest("name", registration.name),
		].sort();
		for (const identityDigest of claimDigests)
		{
			await this._transaction.mcpRegistrationClaim.upsert({
				where: { siloId_identityDigest: { siloId: registration.siloId, identityDigest } },
				create: { siloId: registration.siloId, identityDigest },
				update: { touchedAt: new Date() },
				select: { identityDigest: true },
			});
		}

		const existingByKey = await this._transaction.mcpServer.findUnique({
			where: { siloId_registrationKeyDigest: { siloId: registration.siloId, registrationKeyDigest: registration.registrationKeyDigest } },
			select: _SERVER_SELECT,
		});
		if (existingByKey)
			return { created: false, server: _ServerRecord(existingByKey) };

		const existingByName = await this._transaction.mcpServer.findUnique({
			where: { siloId_name: { siloId: registration.siloId, name: registration.name } },
			select: { id: true },
		});
		if (existingByName)
			return null;

		const server = await this._transaction.mcpServer.create({ data: { ...registration, transport: "StreamableHttp", eraProbeStatus: McpEraProbeStates.Pending }, select: _SERVER_SELECT });
		return { created: true, server: _ServerRecord(server) };
	}

	/** Load the stored endpoint only when the task still names its owning silo and server. */
	async loadEraProbeTarget(siloId: string, serverId: string): Promise<McpEraProbeTargetRecord | null>
	{
		const stored = await this._transaction.mcpServer.findFirst({ where: { id: serverId, siloId }, select: _ERA_PROBE_TARGET_SELECT });
		const target = stored ? _EraProbeTargetRecord(stored) : null;
		if (!target?.registrationDigest)
			return null;
		return { ...target, registrationDigest: target.registrationDigest };
	}

	/** Move a pending probe to its stored decision, or confirm that the same result already won. */
	async recordEraProbeResult(siloId: string, serverId: string, registrationDigest: string, result: McpEraProbeTaskResult): Promise<McpEraProbeWriteResult | null>
	{
		const eraProbeStatus = result.decision === McpEraProbeDecisions.Accepted ? McpEraProbeStates.Accepted : McpEraProbeStates.Rejected;
		const status = result.decision === McpEraProbeDecisions.Accepted ? "Active" : "Degraded";
		const approvalStatus = result.decision === McpEraProbeDecisions.Accepted ? "PendingReview" : "Disabled";
		const changed = await this._transaction.mcpServer.updateMany({
			where: { id: serverId, siloId, registrationDigest, eraProbeStatus: McpEraProbeStates.Pending },
			data: { eraProbeStatus, eraProtocolVersion: result.protocolVersion ?? null, eraProbeEvidenceDigest: result.evidenceDigest, eraProbeFailureCode: result.failureCode ?? null, eraProbeAttempts: { increment: 1 }, eraProbedAt: new Date(), status, approvalStatus },
		});
		const server = await this._transaction.mcpServer.findFirst({ where: { id: serverId, siloId, registrationDigest }, select: _SERVER_SELECT });
		if (!server)
			return null;
		return { changed: changed.count === 1, server: _ServerRecord(server) };
	}

	/** Count a temporary failure and store rejection evidence when it consumes the last attempt. */
	async recordEraProbeRetry(siloId: string, serverId: string, registrationDigest: string, attempt: number, maximumAttempts: number, exhaustedResult: McpEraProbeTaskResult): Promise<McpEraProbeRetryResult | null>
	{
		const storedTarget = await this._transaction.mcpServer.findFirst({ where: { id: serverId, siloId, registrationDigest }, select: _ERA_PROBE_TARGET_SELECT });
		if (!storedTarget)
			return null;
		const target = _EraProbeTargetRecord(storedTarget);
		const nextAttempt = Math.max(target.eraProbeAttempts + 1, attempt);
		const exhausted = nextAttempt >= maximumAttempts;
		const data: Prisma.McpServerUpdateManyMutationInput = exhausted
			? { eraProbeStatus: McpEraProbeStates.Rejected, eraProtocolVersion: null, eraProbeEvidenceDigest: exhaustedResult.evidenceDigest, eraProbeFailureCode: exhaustedResult.failureCode, eraProbeAttempts: nextAttempt, eraProbedAt: new Date(), status: "Degraded", approvalStatus: "Disabled" }
			: { eraProbeAttempts: nextAttempt };
		const changed = await this._transaction.mcpServer.updateMany({ where: { id: serverId, siloId, registrationDigest, eraProbeStatus: McpEraProbeStates.Pending, eraProbeAttempts: target.eraProbeAttempts }, data });
		const server = await this._transaction.mcpServer.findFirst({ where: { id: serverId, siloId, registrationDigest }, select: _SERVER_SELECT });
		if (!server)
			return null;
		const record = _ServerRecord(server);
		return { changed: changed.count === 1, exhausted: record.eraProbeStatus === McpEraProbeStates.Rejected && record.eraProbeFailureCode === exhaustedResult.failureCode, server: record };
	}

	async listGroups(siloId: string, groupIds?: readonly string[])
	{
		return this._transaction.group.findMany({ where: { siloId, ...(groupIds ? { id: { in: [...groupIds] } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } });
	}

	async listPrincipals(siloId: string, principalIds?: readonly string[]): Promise<readonly McpOperatorPrincipalRecord[]>
	{
		return this._transaction.principal.findMany({ where: { siloId, ...(principalIds ? { id: { in: [...principalIds] } } : {}) }, select: { id: true, email: true, displayName: true }, orderBy: { id: "asc" } });
	}

	async appendAudit(action: string, resource: string, message: string, actor?: McpOperatorAuditActor): Promise<void>
	{
		await this._transaction.auditEntry.create({ data: { action, resource, message, ...(actor ? { metadata: { siloId: actor.siloId, actorPrincipalId: actor.actorPrincipalId } } : {}) } });
	}
}
