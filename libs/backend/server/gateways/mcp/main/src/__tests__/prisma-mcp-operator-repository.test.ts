import { createHash } from "node:crypto";

import { McpConnectionState, McpConnectionStatus, McpInstallState, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { McpCredentialRequirement } from "@opencrane/contracts";

import { PrismaMcpOperatorRepository } from "../core/prisma-mcp-operator-repository";
import { McpOperatorInstallUpsertOutcomes, type McpOperatorServerRecord, type McpRemoteServerRegistrationRecord } from "../core/mcp-operator-repository.types";
import { McpEraProbeStates } from "../era-probe/mcp-era-probe.types";

/** Return the fixed registration used to prove typed claim ordering. */
function _Registration(): McpRemoteServerRegistrationRecord
{
	return {
		siloId: "silo-1",
		name: "Example MCP",
		description: "Public tools",
		endpoint: "https://mcp.example.test/",
		credentialRequirement: McpCredentialRequirement.SharedCredential,
		registrationKeyDigest: `sha256:${"a".repeat(64)}`,
		registrationDigest: `sha256:${"b".repeat(64)}`,
	};
}

/** Return the stored draft selected by registration operations. */
function _Server(registration: McpRemoteServerRegistrationRecord): McpOperatorServerRecord
{
	return { id: "server-1", name: registration.name, description: registration.description, publisher: null, glyph: null, serverType: "MultiUser", credentialRequirement: "SharedCredential", approvalStatus: "PendingReview", status: "Draft", supportsStandardInstall: true, requiresReadyRevisionForInstall: false, latestReadyRevision: null, credentialSchema: [], entitlementSummary: null, endpoint: registration.endpoint, registrationKeyDigest: registration.registrationKeyDigest, registrationDigest: registration.registrationDigest, eraProbeStatus: McpEraProbeStates.Pending, eraProtocolVersion: null, eraProbeEvidenceDigest: null, eraProbeFailureCode: null, eraProbeAttempts: 0 };
}

/** Derive the exact fixed-width claim identity expected from the adapter. */
function _ClaimDigest(kind: "key" | "name", value: string): string
{
	return `sha256:${createHash("sha256").update(`${kind}:${value}`).digest("hex")}`;
}

describe("Prisma MCP registration claims", function _RegistrationClaimsSuite()
{
	it("claims key and name in stable order before it creates a draft", async function _ClaimsBeforeCreate()
	{
		const registration = _Registration();
		const events: string[] = [];
		const claimUpsert = vi.fn().mockImplementation(function _Claim(input: { create: { identityDigest: string } })
		{
			events.push(`claim:${input.create.identityDigest}`);
			return Promise.resolve({ identityDigest: input.create.identityDigest });
		});
		const findUnique = vi.fn()
			.mockImplementationOnce(function _ByKey() { events.push("find:key"); return Promise.resolve(null); })
			.mockImplementationOnce(function _ByName() { events.push("find:name"); return Promise.resolve(null); });
		const create = vi.fn().mockImplementation(function _Create() { events.push("create"); return Promise.resolve({ ..._Server(registration), transport: "StreamableHttp" }); });
		const transaction = { mcpRegistrationClaim: { upsert: claimUpsert }, mcpServer: { findUnique, create } } as unknown as Prisma.TransactionClient;

		const result = await new PrismaMcpOperatorRepository(transaction).createOrFindRemoteServer(registration);

		const expectedClaims = [
			_ClaimDigest("key", registration.registrationKeyDigest),
			_ClaimDigest("name", registration.name),
		].sort();
		expect(events).toEqual([`claim:${expectedClaims[0]}`, `claim:${expectedClaims[1]}`, "find:key", "find:name", "create"]);
		expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ credentialRequirement: "SharedCredential", eraProbeStatus: "Pending" }) }));
		expect(result).toEqual({ created: true, server: _Server(registration) });
	});

	it("returns the existing key owner after taking both claims", async function _ReturnsExistingOwner()
	{
		const registration = _Registration();
		const server = _Server(registration);
		const storedServer = { ...server, transport: "StreamableHttp" };
		const claimUpsert = vi.fn().mockResolvedValue({ identityDigest: "claim" });
		const findUnique = vi.fn().mockResolvedValueOnce(storedServer);
		const create = vi.fn();
		const transaction = { mcpRegistrationClaim: { upsert: claimUpsert }, mcpServer: { findUnique, create } } as unknown as Prisma.TransactionClient;

		const result = await new PrismaMcpOperatorRepository(transaction).createOrFindRemoteServer(registration);

		expect(claimUpsert).toHaveBeenCalledTimes(2);
		expect(findUnique).toHaveBeenCalledTimes(1);
		expect(create).not.toHaveBeenCalled();
		expect(result).toEqual({ created: false, server });
	});
});

describe("Prisma MCP approval transitions", function _ApprovalTransitionsSuite()
{
	it("publishes only a server that is already approved and has accepted probe evidence", async function _RequiresApprovedSource()
	{
		const updateMany = vi.fn().mockResolvedValue({ count: 0 });
		const findFirst = vi.fn();
		const transaction = { mcpServer: { updateMany, findFirst } } as unknown as Prisma.TransactionClient;

		const result = await new PrismaMcpOperatorRepository(transaction).setApprovalStatus("silo-1", "server-1", "Published", [McpEraProbeStates.Accepted, McpEraProbeStates.NotRequired], "Approved");

		expect(result).toBeNull();
		expect(updateMany).toHaveBeenCalledWith({ where: { id: "server-1", siloId: "silo-1", eraProbeStatus: { in: ["Accepted", "NotRequired"] }, approvalStatus: "Approved" }, data: { approvalStatus: "Published" } });
		expect(findFirst).not.toHaveBeenCalled();
	});
});

describe("Prisma MCP authoring catalogue", function _AuthoringCatalogueSuite()
{
	it("includes accepted remote servers before discovery and scopes Ready tools to the caller's active connection", async function _FiltersExecutableServers()
	{
		const findMany = vi.fn().mockResolvedValue([]);
		const transaction = { mcpServer: { findMany } } as unknown as Prisma.TransactionClient;

		await new PrismaMcpOperatorRepository(transaction).listPublishedServers("silo-1", "principal-1");

		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
			where: {
				siloId: "silo-1",
				approvalStatus: "Published",
				status: "Active",
				OR: [
					{ transport: "StreamableHttp", eraProbeStatus: "Accepted" },
					{ transport: "OciImage", revisions: { some: { state: "Ready", transport: "OciImage" } } },
				],
			},
			select: expect.objectContaining({
				revisions: expect.objectContaining({
					where: {
						state: "Ready",
						OR: [
							{ transport: "OciImage" },
							{ transport: "RemoteHttp", connectionOwnerPrincipalId: "principal-1", connection: { is: { ownerPrincipalId: "principal-1", state: "Active", install: { is: { principalId: "principal-1", lifecycleState: "Installed", connectionStatus: "Active" } } } } },
						],
					},
				}),
			}),
		}));
	});

	it("selects the newest Ready revision and orders its tools deterministically", async function _SelectsLatestReadyRevision()
	{
		const findMany = vi.fn().mockResolvedValue([]);
		const transaction = { mcpServer: { findMany } } as unknown as Prisma.TransactionClient;

		await new PrismaMcpOperatorRepository(transaction).listAllServers("silo-1");

		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
			select: expect.objectContaining({
				revisions: {
					where: { state: "Ready" },
					orderBy: [{ revision: "desc" }, { id: "asc" }],
					take: 1,
					select: expect.objectContaining({ tools: expect.objectContaining({ orderBy: [{ name: "asc" }, { id: "asc" }] }) }),
				},
			}),
		}));
	});
});

describe("Prisma MCP installed connection projection", function _InstalledConnectionSuite()
{
	it("recovers an Installed row without resetting its current projection", async function _RecoversInstalled()
	{
		const current = { id: "install-1", mcpServerId: "server-1", lifecycleState: McpInstallState.Installed, connectionStatus: McpConnectionStatus.Active, lastUsedAt: null, connections: [{ generation: 4, credentialCustodiedAt: null, failureCode: null }] };
		const upsert = vi.fn().mockResolvedValue(current);
		const transaction = { mcpServerInstall: { upsert, updateMany: vi.fn() } } as unknown as Prisma.TransactionClient;

		await expect(new PrismaMcpOperatorRepository(transaction).upsertInstall("server-1", "principal-1", McpConnectionStatus.NeedsCredential)).resolves.toEqual({ outcome: McpOperatorInstallUpsertOutcomes.Installed, install: { mcpServerId: "server-1", lifecycleState: McpInstallState.Installed, connectionStatus: McpConnectionStatus.Active, lastUsedAt: null, currentConnection: current.connections[0] } });
		expect(transaction.mcpServerInstall.updateMany).not.toHaveBeenCalled();
	});

	it("selects only safe metadata from the newest connection generation", async function _SelectsSafeConnectionProjection()
	{
		const custodiedAt = new Date("2026-09-12T12:00:00.000Z");
		const findMany = vi.fn().mockResolvedValue([{ mcpServerId: "server-1", lifecycleState: McpInstallState.Installed, connectionStatus: "Active", lastUsedAt: null, connections: [{ generation: 3, credentialCustodiedAt: custodiedAt, failureCode: null }] }]);
		const transaction = { mcpServerInstall: { findMany } } as unknown as Prisma.TransactionClient;

		await expect(new PrismaMcpOperatorRepository(transaction).listInstalls("principal-1")).resolves.toEqual([{ mcpServerId: "server-1", lifecycleState: McpInstallState.Installed, connectionStatus: "Active", lastUsedAt: null, currentConnection: { generation: 3, credentialCustodiedAt: custodiedAt, failureCode: null } }]);
		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
			where: { principalId: "principal-1", lifecycleState: { not: McpInstallState.Removed } },
			select: expect.objectContaining({ connections: { orderBy: { generation: "desc" }, take: 1, select: { generation: true, credentialCustodiedAt: true, failureCode: true } } }),
		}));
	});

	it.each([
		[McpConnectionState.Failed, McpInstallState.Installed],
		[McpConnectionState.Revoked, McpInstallState.Removing],
	])("retains safe failure evidence from the latest %s connection on a %s install", async function _RetainsTerminalFailure(_state, lifecycleState)
	{
		const findMany = vi.fn().mockResolvedValue([{ mcpServerId: "server-1", lifecycleState, connectionStatus: "NeedsCredential", lastUsedAt: null, connections: [{ generation: 8, credentialCustodiedAt: null, failureCode: "authentication-rejected" }] }]);
		const transaction = { mcpServerInstall: { findMany } } as unknown as Prisma.TransactionClient;

		await expect(new PrismaMcpOperatorRepository(transaction).listInstalls("principal-1")).resolves.toEqual([{ mcpServerId: "server-1", lifecycleState, connectionStatus: "NeedsCredential", lastUsedAt: null, currentConnection: { generation: 8, credentialCustodiedAt: null, failureCode: "authentication-rejected" } }]);
		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ connections: expect.not.objectContaining({ where: expect.anything() }) }) }));
	});

	it("reactivates a Removed install while retaining its historical connection evidence", async function _ReinstallsRemoved()
	{
		const historical = { generation: 7, credentialCustodiedAt: new Date("2026-09-12T12:00:00.000Z"), failureCode: "credential-conflict" };
		const upsert = vi.fn().mockResolvedValue({ id: "install-1", mcpServerId: "server-1", lifecycleState: McpInstallState.Removed, connectionStatus: McpConnectionStatus.Active, lastUsedAt: new Date(), connections: [historical] });
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { mcpServerInstall: { upsert, updateMany } } as unknown as Prisma.TransactionClient;

		await expect(new PrismaMcpOperatorRepository(transaction).upsertInstall("server-1", "principal-1", McpConnectionStatus.NeedsCredential)).resolves.toEqual({ outcome: McpOperatorInstallUpsertOutcomes.Installed, install: { mcpServerId: "server-1", lifecycleState: McpInstallState.Installed, connectionStatus: McpConnectionStatus.NeedsCredential, lastUsedAt: null, currentConnection: historical } });
		expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ connections: { orderBy: { generation: "desc" }, take: 1, select: { generation: true, credentialCustodiedAt: true, failureCode: true } } }) }));
		expect(updateMany).toHaveBeenCalledWith({ where: { id: "install-1", mcpServerId: "server-1", principalId: "principal-1", lifecycleState: McpInstallState.Removed }, data: { lifecycleState: McpInstallState.Installed, connectionStatus: McpConnectionStatus.NeedsCredential, lastUsedAt: null } });
	});

	it("returns a typed conflict while removal is in progress", async function _ConflictsDuringRemoval()
	{
		const upsert = vi.fn().mockResolvedValue({ id: "install-1", mcpServerId: "server-1", lifecycleState: McpInstallState.Removing, connectionStatus: McpConnectionStatus.NeedsCredential, lastUsedAt: null, connections: [] });
		const transaction = { mcpServerInstall: { upsert, updateMany: vi.fn() } } as unknown as Prisma.TransactionClient;

		await expect(new PrismaMcpOperatorRepository(transaction).upsertInstall("server-1", "principal-1", McpConnectionStatus.NeedsCredential)).resolves.toEqual({ outcome: McpOperatorInstallUpsertOutcomes.RemovalInProgress });
		expect(transaction.mcpServerInstall.updateMany).not.toHaveBeenCalled();
	});
});
