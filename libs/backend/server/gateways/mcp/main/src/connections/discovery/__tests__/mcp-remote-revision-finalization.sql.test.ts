import { randomUUID } from "node:crypto";

import { McpApprovalStatus, McpConnectionCredentialKind, McpConnectionState, McpConnectionStatus, McpCredentialRequirement as PrismaMcpCredentialRequirement, McpExecutionTransport, McpServerRevisionState, McpServerStatus, McpServerTransport, OrgRole, PrincipalProvenance, Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaAuthorizationAuthority, PrismaManagedAuthorizationGrantRepository } from "@opencrane/backend/server/iam/authorization";
import { MCP_PROTOCOL_VERSION, McpConnectionCredentialKinds, McpCredentialRequirement } from "@opencrane/contracts";
import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationSubjectKinds, ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { McpRemoteRevisionFinalizationOutcomes, type McpRemoteRevisionFinalizationCommand } from "../mcp-authenticated-connection-discovery.types";
import { PrismaMcpRemoteRevisionFinalizationRepository } from "../prisma-mcp-remote-revision-finalizer";
import { __McpConnectionEndpointDigest, __McpConnectionGrantManagerId } from "../../mcp-connection-digests";
import { McpConnectionStates, type McpConnectionRecord } from "../../mcp-connection.types";

const _Client = new PrismaClient();
const _NOW = new Date("2026-09-12T08:00:00.000Z");

/** Seed one current credentialless connection and its exact Use grant. */
async function _Fixture()
{
	return _Client.$transaction(async function _Seed(transaction)
	{
		const siloId = `mcp-remote-finalization-${randomUUID()}`;
		const principalId = randomUUID();
		const serverId = randomUUID();
		const installId = randomUUID();
		const connectionId = randomUUID();
		const endpoint = "https://mcp.example.test/stream";
		const endpointDigest = __McpConnectionEndpointDigest(endpoint);
		await transaction.principal.create({ data: { id: principalId, siloId, issuer: "https://mcp-finalization.example", subject: principalId, provenance: PrincipalProvenance.External } });
		await transaction.orgMembership.create({ data: { clusterTenant: siloId, subject: principalId, role: OrgRole.Member } });
		await transaction.mcpServer.create({ data: { id: serverId, siloId, name: serverId, endpoint, transport: McpServerTransport.StreamableHttp, credentialRequirement: PrismaMcpCredentialRequirement.Credentialless, status: McpServerStatus.Active, approvalStatus: McpApprovalStatus.Published } });
		await transaction.mcpServerInstall.create({ data: { id: installId, mcpServerId: serverId, principalId, connectionStatus: McpConnectionStatus.Activating } });
		const record: McpConnectionRecord = {
			id: connectionId, siloId, installId, serverId, ownerPrincipalId: principalId, actorPrincipalId: principalId, agentServiceId: null, generation: 1,
			credentialRequirement: McpCredentialRequirement.Credentialless, credentialKind: McpConnectionCredentialKinds.None, endpointDigest, state: McpConnectionStates.Activating,
			requestKeyDigest: ___DigestCanonicalJson({ connectionId, kind: "request" }), commandDigest: ___DigestCanonicalJson({ connectionId, kind: "command" }), materialVerifier: null, materialVerifierKeyId: null,
			authorizationDecisionDigest: ___DigestCanonicalJson({ connectionId, kind: "admission" }), secretRef: null, secretUid: null, secretResourceVersion: null, credentialCustodiedAt: null,
			task: { taskId: randomUUID(), taskName: "mcp-connection.activate/v1", taskKey: `mcp-connection-activate-${connectionId}` }, revokeKeyDigest: null, revokeDecisionDigest: null, revokeTask: null,
			failureCode: null, activatedAt: null, revokedAt: null, cleanupCompletedAt: null,
		};
		await transaction.mcpConnection.create({ data: {
			id: record.id, siloId: record.siloId, mcpServerInstallId: record.installId, mcpServerId: record.serverId, ownerPrincipalId: record.ownerPrincipalId, actorPrincipalId: record.actorPrincipalId,
			generation: record.generation, credentialRequirement: PrismaMcpCredentialRequirement.Credentialless, credentialKind: McpConnectionCredentialKind.None, endpointDigest: record.endpointDigest, state: McpConnectionState.Activating,
			requestKeyDigest: record.requestKeyDigest, commandDigest: record.commandDigest, authorizationDecisionDigest: record.authorizationDecisionDigest, taskId: record.task.taskId, taskName: record.task.taskName, taskKey: record.task.taskKey,
		} });
		const resource = { kind: ProductAuthorizationResourceKinds.ProviderConnection, id: connectionId } as const;
		const capability = __ProductAuthorizationCapability(resource.kind, ProductAuthorizationActions.Use);
		if (capability === null)
			throw new Error("Remote finalization proof requires ProviderConnection Use");
		await new PrismaManagedAuthorizationGrantRepository(transaction).reconcileManagedResourceGrants({ siloId, managerId: __McpConnectionGrantManagerId(connectionId), resource, grants: [{ subject: { kind: AuthorizationSubjectKinds.Principal, principalId }, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability, resource, priority: 100, createdByPrincipalId: principalId }], now: _NOW });
		const command: McpRemoteRevisionFinalizationCommand = {
			record,
			task: { taskId: record.task.taskId, taskName: record.task.taskName, idempotencyKey: record.task.taskKey },
			protocolVersion: MCP_PROTOCOL_VERSION,
			discoveryEvidenceDigest: ___DigestCanonicalJson({ connectionId, kind: "discover" }),
			discoveryDigest: ___DigestCanonicalJson({ connectionId, kind: "tools" }),
			tools: [{ name: "records.read", description: "Read records", inputSchema: { type: "object", properties: {}, additionalProperties: false } }],
		};
		return { siloId, principalId, serverId, installId, connectionId, command };
	}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Run the production finalizer with every authority owner on one transaction. */
function _Finalize(command: McpRemoteRevisionFinalizationCommand)
{
	return _Client.$transaction(async function _Transaction(transaction)
	{
		return new PrismaMcpRemoteRevisionFinalizationRepository(transaction, new PrismaAuthorizationAuthority(transaction), new PrismaManagedAuthorizationGrantRepository(transaction)).finalize(command);
	}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Revoke the connection manager's current grants through their central owner. */
function _RevokeConnectionGrants(fixture: Awaited<ReturnType<typeof _Fixture>>): Promise<void>
{
	return _Client.$transaction(async function _Revoke(transaction)
	{
		await new PrismaManagedAuthorizationGrantRepository(transaction).reconcileManagedResourceGrants({ siloId: fixture.siloId, managerId: __McpConnectionGrantManagerId(fixture.connectionId), resource: { kind: ProductAuthorizationResourceKinds.ProviderConnection, id: fixture.connectionId }, grants: [], now: _NOW });
	});
}

describe("remote MCP revision finalization on the fresh PostgreSQL baseline", function _Suite()
{
	beforeAll(async function _Connect()
	{
		if (!process.env.DATABASE_URL)
			throw new Error("Remote MCP finalization SQL proof requires DATABASE_URL and a fresh target baseline");
		await _Client.$connect();
	});
	afterAll(async function _Disconnect() { await _Client.$disconnect(); });

	it("commits and replays one connection-bound Ready revision with owner tool grants", async function _Finalizes()
	{
		const fixture = await _Fixture();
		const first = await _Finalize(fixture.command);
		const replay = await _Finalize(fixture.command);

		expect(first).toMatchObject({ outcome: McpRemoteRevisionFinalizationOutcomes.Completed });
		if (first.serverRevisionId === undefined)
			throw new Error("Remote finalization did not return its Ready revision");
		expect(replay).toEqual({ outcome: McpRemoteRevisionFinalizationOutcomes.Replayed, serverRevisionId: first.serverRevisionId });
		await expect(_Client.mcpServerRevision.findMany({ where: { connectionId: fixture.connectionId } })).resolves.toEqual([expect.objectContaining({ id: first.serverRevisionId, transport: McpExecutionTransport.RemoteHttp, state: McpServerRevisionState.Ready, discoveryEvidenceDigest: fixture.command.discoveryEvidenceDigest, discoveryDigest: fixture.command.discoveryDigest })]);
		await expect(_Client.mcpConnection.findUniqueOrThrow({ where: { id: fixture.connectionId } })).resolves.toMatchObject({ state: McpConnectionState.Active, activatedAt: expect.any(Date) });
		await expect(_Client.mcpServerInstall.findUniqueOrThrow({ where: { id: fixture.installId } })).resolves.toMatchObject({ connectionStatus: McpConnectionStatus.Active });
		await expect(_Client.mcpToolRevision.count({ where: { serverRevisionId: first.serverRevisionId } })).resolves.toBe(1);
		await expect(_Client.authorizationGrant.count({ where: { managerId: __McpConnectionGrantManagerId(fixture.connectionId), resourceKind: ProductAuthorizationResourceKinds.McpToolRevision, revokedAt: null } })).resolves.toBe(2);
	});

	it("denies stale authority and conflicts on changed discovery evidence", async function _FencesReplay()
	{
		const stale = await _Fixture();
		await _RevokeConnectionGrants(stale);
		await expect(_Finalize(stale.command)).resolves.toEqual({ outcome: McpRemoteRevisionFinalizationOutcomes.Denied });
		await expect(_Client.mcpServerRevision.count({ where: { connectionId: stale.connectionId } })).resolves.toBe(0);

		const conflict = await _Fixture();
		await expect(_Finalize(conflict.command)).resolves.toMatchObject({ outcome: McpRemoteRevisionFinalizationOutcomes.Completed });
		await expect(_Finalize({ ...conflict.command, discoveryDigest: ___DigestCanonicalJson({ changed: true }) })).resolves.toEqual({ outcome: McpRemoteRevisionFinalizationOutcomes.Conflict });
	});

	it("rejects mixed OCI and remote revision identities and immutable discovery rewrites", async function _RejectsMixedIdentity()
	{
		const fixture = await _Fixture();
		await expect(_Client.mcpServerRevision.create({ data: { siloId: fixture.siloId, mcpServerId: fixture.serverId, revision: 1, transport: McpExecutionTransport.RemoteHttp, connectionId: fixture.connectionId, connectionGeneration: 1, connectionOwnerPrincipalId: fixture.principalId, endpointDigest: fixture.command.record.endpointDigest, discoveryEvidenceDigest: fixture.command.discoveryEvidenceDigest, discoveryDigest: fixture.command.discoveryDigest, registryReference: `registry.example.test/mixed@${fixture.command.discoveryDigest}` } })).rejects.toThrow(/mcp_server_revisions_transport_identity_check/u);
		const finalized = await _Finalize(fixture.command);
		if (finalized.serverRevisionId === undefined)
			throw new Error("Remote finalization did not return its Ready revision");
		await expect(_Client.mcpServerRevision.update({ where: { id: finalized.serverRevisionId }, data: { discoveryDigest: ___DigestCanonicalJson({ changed: true }) } })).rejects.toThrow(/transport and discovery identity is immutable/u);
	});
});
