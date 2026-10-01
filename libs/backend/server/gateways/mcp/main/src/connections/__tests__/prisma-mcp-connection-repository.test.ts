import { McpConnectionCredentialKind, McpConnectionState, McpConnectionStatus, McpCredentialRequirement, McpInstallState, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { McpConnectionFailureCodes, McpConnectionStatus as ContractConnectionStatus, McpCredentialRequirement as ContractCredentialRequirement } from "@opencrane/contracts";

import { PrismaMcpConnectionRepository } from "../prisma-mcp-connection-repository";

describe("PrismaMcpConnectionRepository locking", () =>
{
	it("locks an existing install before returning its remote connection target", async () =>
	{
		const claim = vi.fn().mockResolvedValue({ identityDigest: "claim" });
		const installUpdate = vi.fn().mockResolvedValue({ count: 1 });
		const findFirst = vi.fn().mockResolvedValue(_Server([{ id: "install-1", connectionStatus: McpConnectionStatus.NeedsCredential }]));
		const transaction = {
			mcpConnectionAdmissionClaim: { upsert: claim },
			mcpServer: { findFirst },
			mcpServerInstall: { updateMany: installUpdate },
		} as unknown as Prisma.TransactionClient;

		await expect(new PrismaMcpConnectionRepository(transaction).lockInstall("silo-1", "server-1", "principal-1")).resolves.toMatchObject({ installId: "install-1", ownerPrincipalId: "principal-1" });
		expect(claim).toHaveBeenCalledBefore(installUpdate);
		expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ installs: expect.objectContaining({ where: { principalId: "principal-1", lifecycleState: McpInstallState.Installed } }) }) }));
		expect(installUpdate).toHaveBeenCalledWith({ where: { id: "install-1", mcpServerId: "server-1", principalId: "principal-1", lifecycleState: McpInstallState.Installed, connectionStatus: McpConnectionStatus.NeedsCredential }, data: { connectionStatus: McpConnectionStatus.NeedsCredential } });
	});

	it("creates the missing managed-service install after admission", async () =>
	{
		const upsert = vi.fn().mockResolvedValue({ id: "install-2", lifecycleState: McpInstallState.Installed });
		const transaction = { mcpServerInstall: { upsert } } as unknown as Prisma.TransactionClient;
		const repository = new PrismaMcpConnectionRepository(transaction);
		const target = { installId: null, serverId: "server-1", ownerPrincipalId: "service-principal-1", endpoint: "https://mcp.example.test/rpc", credentialRequirement: ContractCredentialRequirement.PrincipalCredential } as const;

		await expect(repository.createManagedInstall(target)).resolves.toEqual({ ...target, installId: "install-2" });
		expect(upsert).toHaveBeenCalledWith({ where: { mcpServerId_principalId: { mcpServerId: "server-1", principalId: "service-principal-1" } }, create: { mcpServerId: "server-1", principalId: "service-principal-1", lifecycleState: McpInstallState.Installed, connectionStatus: McpConnectionStatus.NeedsCredential }, update: {}, select: { id: true, lifecycleState: true } });
	});

	it("refuses to reuse a managed install while removal is pending", async () =>
	{
		const upsert = vi.fn().mockResolvedValue({ id: "install-2", lifecycleState: McpInstallState.Removing });
		const transaction = { mcpServerInstall: { upsert } } as unknown as Prisma.TransactionClient;
		const target = { installId: null, serverId: "server-1", ownerPrincipalId: "service-principal-1", endpoint: "https://mcp.example.test/rpc", credentialRequirement: ContractCredentialRequirement.PrincipalCredential } as const;

		await expect(new PrismaMcpConnectionRepository(transaction).createManagedInstall(target)).resolves.toBeNull();
	});

	it("locks removal by install before selecting the current connection", async () =>
	{
		const claim = vi.fn().mockResolvedValue({ identityDigest: "claim" });
		const installUpdate = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = {
			mcpConnectionAdmissionClaim: { upsert: claim },
			mcpServerInstall: { findFirst: vi.fn().mockResolvedValue({ id: "install-1", mcpServerId: "server-1", principalId: "principal-1", lifecycleState: McpInstallState.Installed, connectionStatus: McpConnectionStatus.Active }), updateMany: installUpdate },
		} as unknown as Prisma.TransactionClient;

		await expect(new PrismaMcpConnectionRepository(transaction).lockInstallForRemoval("silo-1", "server-1", "principal-1")).resolves.toMatchObject({ installId: "install-1", lifecycleState: "installed" });
		expect(claim).toHaveBeenCalledBefore(installUpdate);
		expect(installUpdate).toHaveBeenCalledWith({ where: { id: "install-1", mcpServerId: "server-1", principalId: "principal-1", lifecycleState: McpInstallState.Installed, connectionStatus: McpConnectionStatus.Active }, data: { connectionStatus: McpConnectionStatus.Active } });
	});

	it("denies explicit revocation once install removal has started", async () =>
	{
		const findFirst = vi.fn().mockResolvedValue(null);
		const transaction = { mcpConnectionAdmissionClaim: { upsert: vi.fn() }, mcpServerInstall: { findFirst } } as unknown as Prisma.TransactionClient;

		await expect(new PrismaMcpConnectionRepository(transaction).lockInstallForRevocation("silo-1", "server-1", "principal-1")).resolves.toBeNull();
		expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ lifecycleState: McpInstallState.Installed }) }));
	});

	it("locks the selected connection generation with every immutable owner coordinate", async () =>
	{
		const row = _Connection();
		const connectionUpdate = vi.fn().mockResolvedValue({ count: 1 });
		const findFirst = vi.fn().mockResolvedValue(row);
		const transaction = { mcpConnection: { findFirst, updateMany: connectionUpdate } } as unknown as Prisma.TransactionClient;

		await expect(new PrismaMcpConnectionRepository(transaction).lockCurrent("silo-1", "install-1")).resolves.toMatchObject({ id: "connection-1", generation: 2 });
		expect(connectionUpdate).toHaveBeenCalledWith({ where: { id: "connection-1", siloId: "silo-1", mcpServerInstallId: "install-1", generation: 2, state: McpConnectionState.Activating }, data: { state: McpConnectionState.Activating } });
	});

	it("allows a definite activation failure only after custody reached Activating", async () =>
	{
		const row = _Connection();
		const connectionUpdate = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { mcpConnection: { findFirst: vi.fn().mockResolvedValue(row), updateMany: connectionUpdate } } as unknown as Prisma.TransactionClient;
		const repository = new PrismaMcpConnectionRepository(transaction);
		const record = await repository.lockCurrent("silo-1", "install-1");
		expect(record).not.toBeNull();
		connectionUpdate.mockClear();

		await repository.markActivationFailed(record!, McpConnectionFailureCodes.WorkflowExhausted, new Date("2026-09-12T12:00:00.000Z"));

		expect(connectionUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ state: McpConnectionState.Activating }), data: expect.objectContaining({ state: McpConnectionState.Failed, failureCode: McpConnectionFailureCodes.WorkflowExhausted }) }));
	});

	it("does not let a late connection result rewrite a removing install", async () =>
	{
		const updateMany = vi.fn().mockResolvedValue({ count: 0 });
		const transaction = { mcpServerInstall: { updateMany } } as unknown as Prisma.TransactionClient;

		await new PrismaMcpConnectionRepository(transaction).setInstallProjection("install-1", { connectionStatus: ContractConnectionStatus.Active, connectionGeneration: 1, credentialUpdatedAt: null, failureCode: null });
		expect(updateMany).toHaveBeenCalledWith({ where: { id: "install-1", lifecycleState: McpInstallState.Installed }, data: { connectionStatus: McpConnectionStatus.Active } });
	});
});

function _Server(installs: readonly { readonly id: string; readonly connectionStatus: McpConnectionStatus }[])
{
	return { id: "server-1", endpoint: "https://mcp.example.test/rpc", credentialRequirement: McpCredentialRequirement.PrincipalCredential, installs };
}

function _Connection()
{
	return {
		id: "connection-1", siloId: "silo-1", mcpServerInstallId: "install-1", mcpServerId: "server-1", ownerPrincipalId: "principal-1", actorPrincipalId: "principal-1", agentServiceId: null, generation: 2,
		credentialRequirement: McpCredentialRequirement.PrincipalCredential, credentialKind: McpConnectionCredentialKind.Bearer, endpointDigest: `sha256:${"a".repeat(64)}`, state: McpConnectionState.Activating,
		requestKeyDigest: `sha256:${"b".repeat(64)}`, commandDigest: `sha256:${"c".repeat(64)}`, materialVerifier: `hmac-sha256:${"d".repeat(64)}`, materialVerifierKeyId: "key-1", authorizationDecisionDigest: `sha256:${"e".repeat(64)}`,
		credentialSecretRef: null, credentialSecretUid: null, credentialSecretResourceVersion: null, credentialCustodiedAt: null, taskId: "task-1", taskName: "activate", taskKey: "task-key",
		revokeKeyDigest: null, revokeDecisionDigest: null, revokeTaskId: null, revokeTaskName: null, revokeTaskKey: null, failureCode: null, activatedAt: null, revokedAt: null, cleanupCompletedAt: null,
	};
}
