import { McpConnectionState, McpConnectionStatus, McpInstallState, McpServerRevisionState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { AuthorizationAuthority, ManagedAuthorizationGrantRepository } from "@opencrane/backend/server/iam/authorization";
import { McpConnectionCredentialKinds, McpCredentialRequirement } from "@opencrane/contracts";
import { AuthorizationDecisionOutcomes } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { McpRemoteRevisionFinalizationOutcomes, type McpRemoteRevisionFinalizationCommand } from "../mcp-authenticated-connection-discovery.types";
import { PrismaMcpRemoteRevisionFinalizationRepository } from "../prisma-mcp-remote-revision-finalizer";
import { __McpConnectionEndpointDigest } from "../../mcp-connection-digests";
import { McpConnectionStates, type McpConnectionRecord } from "../../mcp-connection.types";

const _NOW = new Date("2026-09-12T08:00:00.000Z");
const _ENDPOINT = "https://mcp.example.test/stream";

/** Build one saved credentialless generation for repository tests. */
function _Record(changes: Partial<McpConnectionRecord> = {}): McpConnectionRecord
{
	return {
		id: "connection-1", siloId: "silo-1", installId: "install-1", serverId: "server-1", ownerPrincipalId: "principal-1", actorPrincipalId: "principal-1", agentServiceId: null, generation: 2,
		credentialRequirement: McpCredentialRequirement.Credentialless, credentialKind: McpConnectionCredentialKinds.None, endpointDigest: __McpConnectionEndpointDigest(_ENDPOINT), state: McpConnectionStates.Activating,
		requestKeyDigest: `sha256:${"a".repeat(64)}`, commandDigest: `sha256:${"b".repeat(64)}`, materialVerifier: null, materialVerifierKeyId: null, authorizationDecisionDigest: `sha256:${"c".repeat(64)}`,
		secretRef: null, secretUid: null, secretResourceVersion: null, credentialCustodiedAt: null, task: { taskId: "task-1", taskName: "mcp-connection-activation", taskKey: "task-key-1" },
		revokeKeyDigest: null, revokeDecisionDigest: null, revokeTask: null, failureCode: null, activatedAt: null, revokedAt: null, cleanupCompletedAt: null,
		...changes,
	};
}

/** Build the complete remote discovery command. */
function _Command(record = _Record()): McpRemoteRevisionFinalizationCommand
{
	return {
		record,
		task: { taskId: record.task.taskId, taskName: record.task.taskName, idempotencyKey: record.task.taskKey },
		protocolVersion: "2026-07-28",
		discoveryEvidenceDigest: `sha256:${"d".repeat(64)}`,
		discoveryDigest: `sha256:${"e".repeat(64)}`,
		tools: [
			{ name: "zeta.read", description: null, inputSchema: { type: "object" } },
			{ name: "alpha.read", description: "Alpha", inputSchema: { type: "object" } },
		],
	};
}

/** Return the selected row matching `_Record`. */
function _Connection(state: McpConnectionState = McpConnectionState.Activating): { readonly state: McpConnectionState }
{
	return { state };
}

/** Build a transaction double that records every finalization stage. */
function _Transaction()
{
	return {
		mcpRuntimeClock: { findUnique: vi.fn().mockResolvedValue({ singleton: 1, now: _NOW }) },
		mcpServerInstall: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		mcpServer: {
			findFirst: vi.fn().mockResolvedValue({ endpoint: _ENDPOINT }),
			updateMany: vi.fn().mockResolvedValue({ count: 1 }),
		},
		mcpConnection: {
			findFirst: vi.fn().mockResolvedValue(_Connection()),
			updateMany: vi.fn().mockResolvedValue({ count: 1 }),
		},
		mcpServerRevision: {
			findUnique: vi.fn().mockResolvedValue(null),
			findFirst: vi.fn().mockResolvedValue({ revision: 4 }),
			create: vi.fn().mockResolvedValue({ id: "revision-5" }),
			updateMany: vi.fn().mockResolvedValue({ count: 1 }),
		},
		mcpToolRevision: { create: vi.fn().mockImplementation(async function _Create(command: { readonly data: { readonly name: string } }) { return { id: `tool-${command.data.name}` }; }) },
	};
}

/** Permit current connection use through the central authority. */
function _Authorization(outcome = AuthorizationDecisionOutcomes.Allow): AuthorizationAuthority
{
	const result = outcome === AuthorizationDecisionOutcomes.Allow
		? { outcome, reason: "winning_allow", grantIds: ["grant-1"], evidence: { decisionDigest: `sha256:${"1".repeat(64)}`, policyRevisionHash: `sha256:${"2".repeat(64)}`, effectiveAuthorizationDigest: `sha256:${"3".repeat(64)}` } }
		: { outcome, reason: "no_matching_grant", grantIds: [], evidence: null };
	return { decide: vi.fn().mockResolvedValue(result) } as unknown as AuthorizationAuthority;
}

/** Record managed tool grants without a database. */
function _Grants(): ManagedAuthorizationGrantRepository
{
	return { reconcileManagedResourceGrants: vi.fn().mockResolvedValue(2) };
}

describe("Prisma remote MCP revision finalization", function _Suite()
{
	it("creates one sorted Ready revision, owner grants, and active projections", async function _Finalizes()
	{
		const transaction = _Transaction();
		const grants = _Grants();
		const repository = new PrismaMcpRemoteRevisionFinalizationRepository(transaction as never, _Authorization(), grants);

		await expect(repository.finalize(_Command())).resolves.toEqual({ outcome: McpRemoteRevisionFinalizationOutcomes.Completed, serverRevisionId: "revision-5" });

		expect(transaction.mcpServerRevision.create).toHaveBeenCalledWith({ data: expect.not.objectContaining({ protocolVersion: expect.anything() }), select: { id: true } });
		expect(transaction.mcpServerRevision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ revision: 5, connectionId: "connection-1", connectionGeneration: 2, discoveryEvidenceDigest: `sha256:${"d".repeat(64)}`, discoveryDigest: `sha256:${"e".repeat(64)}`, state: McpServerRevisionState.Discovering }), select: { id: true } });
		expect(transaction.mcpServerRevision.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: McpServerRevisionState.Ready, protocolVersion: "2026-07-28" }) }));
		expect(transaction.mcpConnection.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ requestKeyDigest: `sha256:${"a".repeat(64)}`, commandDigest: `sha256:${"b".repeat(64)}`, authorizationDecisionDigest: `sha256:${"c".repeat(64)}`, credentialSecretRef: null }) }));
		expect(transaction.mcpToolRevision.create.mock.calls.map(function _Name(call) { return call[0].data.name; })).toEqual(["alpha.read", "zeta.read"]);
		expect(grants.reconcileManagedResourceGrants).toHaveBeenCalledTimes(2);
		expect(grants.reconcileManagedResourceGrants).toHaveBeenCalledWith(expect.objectContaining({ managerId: "mcp-connection:connection-1", grants: expect.arrayContaining([expect.objectContaining({ capability: expect.objectContaining({ capabilityId: "mcp-tool-revision:read" }) }), expect.objectContaining({ capability: expect.objectContaining({ capabilityId: "mcp-tool-revision:invoke" }) })]) }));
		expect(transaction.mcpConnection.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: McpConnectionState.Active }) }));
		expect(transaction.mcpServerInstall.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ lifecycleState: McpInstallState.Installed }), data: expect.objectContaining({ connectionStatus: McpConnectionStatus.Active }) }));
	});

	it("recovers only an exact Ready winner without creating tools or grants", async function _Replays()
	{
		const transaction = _Transaction();
		const command = _Command();
		transaction.mcpConnection.findFirst.mockResolvedValue(_Connection(McpConnectionState.Active));
		const expected = command.tools.toSorted(function _ByName(first, second) { return first.name.localeCompare(second.name); });
		transaction.mcpServerRevision.findUnique.mockResolvedValueOnce({
			id: "revision-5", transport: "RemoteHttp", connectionId: command.record.id, connectionGeneration: command.record.generation, connectionOwnerPrincipalId: command.record.ownerPrincipalId, endpointDigest: command.record.endpointDigest,
			discoveryEvidenceDigest: command.discoveryEvidenceDigest, discoveryDigest: command.discoveryDigest, protocolVersion: command.protocolVersion, state: McpServerRevisionState.Ready,
			tools: expected.map(function _Tool(tool) { return { name: tool.name, description: tool.description, inputSchemaDigest: ___DigestCanonicalJson(tool.inputSchema) }; }),
		});

		const repository = new PrismaMcpRemoteRevisionFinalizationRepository(transaction as never, _Authorization(), _Grants());
		await expect(repository.finalize(command)).resolves.toEqual({ outcome: McpRemoteRevisionFinalizationOutcomes.Replayed, serverRevisionId: "revision-5" });
		expect(transaction.mcpToolRevision.create).not.toHaveBeenCalled();
	});

	it("replays punctuation and mixed-case tool names independently of database ordering", async function _ReplaysNamesByCanonicalOrder()
	{
		const transaction = _Transaction();
		const record = _Record({ state: McpConnectionStates.Active });
		const command = {
			..._Command(record),
			tools: [
				{ name: "a_b", description: null, inputSchema: { type: "object" } },
				{ name: "A.read", description: "Upper", inputSchema: { type: "object" } },
				{ name: "a-b", description: null, inputSchema: { type: "object" } },
				{ name: "a.b", description: "Dot", inputSchema: { type: "object" } },
			],
		};
		transaction.mcpConnection.findFirst.mockResolvedValue(_Connection(McpConnectionState.Active));
		transaction.mcpServerRevision.findUnique.mockResolvedValueOnce({
			id: "revision-5", transport: "RemoteHttp", connectionId: record.id, connectionGeneration: record.generation, connectionOwnerPrincipalId: record.ownerPrincipalId, endpointDigest: record.endpointDigest,
			discoveryEvidenceDigest: command.discoveryEvidenceDigest, discoveryDigest: command.discoveryDigest, protocolVersion: command.protocolVersion, state: McpServerRevisionState.Ready,
			tools: [...command.tools].reverse().map(function _Tool(tool) { return { name: tool.name, description: tool.description, inputSchemaDigest: ___DigestCanonicalJson(tool.inputSchema) }; }),
		});

		const repository = new PrismaMcpRemoteRevisionFinalizationRepository(transaction as never, _Authorization(), _Grants());
		await expect(repository.finalize(command)).resolves.toEqual({ outcome: McpRemoteRevisionFinalizationOutcomes.Replayed, serverRevisionId: "revision-5" });
		expect(transaction.mcpToolRevision.create).not.toHaveBeenCalled();
	});

	it("reports different discovery evidence for the same generation as a conflict", async function _Conflicts()
	{
		const transaction = _Transaction();
		const command = _Command();
		transaction.mcpConnection.findFirst.mockResolvedValue(_Connection(McpConnectionState.Active));
		transaction.mcpServerRevision.findUnique.mockResolvedValue({
			id: "revision-5", transport: "RemoteHttp", connectionId: command.record.id, connectionGeneration: command.record.generation, connectionOwnerPrincipalId: command.record.ownerPrincipalId, endpointDigest: command.record.endpointDigest,
			discoveryEvidenceDigest: `sha256:${"f".repeat(64)}`, discoveryDigest: command.discoveryDigest, protocolVersion: command.protocolVersion, state: McpServerRevisionState.Ready, tools: [],
		});
		const repository = new PrismaMcpRemoteRevisionFinalizationRepository(transaction as never, _Authorization(), _Grants());

		await expect(repository.finalize(command)).resolves.toEqual({ outcome: McpRemoteRevisionFinalizationOutcomes.Conflict });
		expect(transaction.mcpToolRevision.create).not.toHaveBeenCalled();
	});

	it("denies stale task and duplicate tools before authority or writes", async function _RejectsInvalidCommand()
	{
		const transaction = _Transaction();
		const authorization = _Authorization();
		const repository = new PrismaMcpRemoteRevisionFinalizationRepository(transaction as never, authorization, _Grants());
		const command = _Command();
		const duplicate = { ...command, tools: [command.tools[0], command.tools[0]] };

		await expect(repository.finalize(duplicate)).resolves.toEqual({ outcome: McpRemoteRevisionFinalizationOutcomes.Denied });
		expect(transaction.mcpRuntimeClock.findUnique).not.toHaveBeenCalled();
		expect(transaction.mcpServerInstall.updateMany).not.toHaveBeenCalled();
		expect(authorization.decide).not.toHaveBeenCalled();
	});

	it("denies revoked current Use authority before saving a revision", async function _RejectsRevokedAuthority()
	{
		const transaction = _Transaction();
		const repository = new PrismaMcpRemoteRevisionFinalizationRepository(transaction as never, _Authorization(AuthorizationDecisionOutcomes.Deny), _Grants());

		await expect(repository.finalize(_Command())).resolves.toEqual({ outcome: McpRemoteRevisionFinalizationOutcomes.Denied });
		expect(transaction.mcpServerRevision.findUnique).not.toHaveBeenCalled();
		expect(transaction.mcpServerRevision.create).not.toHaveBeenCalled();
	});

	it.each([McpInstallState.Removing, McpInstallState.Removed])("denies finalization after the install becomes %s", async function _RejectsUnavailableInstall()
	{
		const transaction = _Transaction();
		transaction.mcpServerInstall.updateMany.mockResolvedValueOnce({ count: 0 });
		const authorization = _Authorization();
		const repository = new PrismaMcpRemoteRevisionFinalizationRepository(transaction as never, authorization, _Grants());

		await expect(repository.finalize(_Command())).resolves.toEqual({ outcome: McpRemoteRevisionFinalizationOutcomes.Denied });
		expect(transaction.mcpServerInstall.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ lifecycleState: McpInstallState.Installed }) }));
		expect(authorization.decide).not.toHaveBeenCalled();
		expect(transaction.mcpServerRevision.create).not.toHaveBeenCalled();
	});
});
