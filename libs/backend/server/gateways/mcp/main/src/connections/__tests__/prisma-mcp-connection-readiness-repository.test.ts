import { McpApprovalStatus, McpConnectionState, McpConnectionStatus, McpCredentialRequirement, McpExecutionTransport, McpInstallState, McpServerRevisionState, McpServerStatus, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaMcpConnectionReadinessRepository } from "../prisma-mcp-connection-readiness-repository";

describe("PrismaMcpConnectionReadinessRepository", function _Suite()
{
	const command = { siloId: "silo-1", toolRevisionId: "tool-1", ownerPrincipalId: "principal-1" };

	it("binds OCI readiness to the exact credentialless owner, tool, revision, and published server", async function _ReadsExactInstall()
	{
		const findFirst = vi.fn().mockResolvedValue(_OciTarget());
		const transaction = { mcpServerInstall: { findFirst } } as unknown as Prisma.TransactionClient;
		const repository = new PrismaMcpConnectionReadinessRepository(transaction);

		await expect(repository.isReady(command)).resolves.toBe(true);
		expect(findFirst).toHaveBeenCalledWith({
			where: {
				principalId: "principal-1",
				lifecycleState: McpInstallState.Installed,
				mcpServer: {
					is: {
						siloId: "silo-1",
						status: McpServerStatus.Active,
						approvalStatus: McpApprovalStatus.Published,
						revisions: { some: { state: McpServerRevisionState.Ready, protocolVersion: "2026-07-28", tools: { some: { id: "tool-1", siloId: "silo-1" } } } },
					},
				},
			},
			select: expect.any(Object),
		});
	});

	it("accepts only the exact active remote generation owned by the installed Principal", async function _ReadsRemoteGeneration()
	{
		const findFirst = vi.fn().mockResolvedValue(_RemoteTarget());
		const repository = new PrismaMcpConnectionReadinessRepository({ mcpServerInstall: { findFirst } } as unknown as Prisma.TransactionClient);

		await expect(repository.isReady(command)).resolves.toBe(true);
		findFirst.mockResolvedValue(_RemoteTarget({ ownerPrincipalId: "other-principal" }));
		await expect(repository.isReady(command)).resolves.toBe(false);
		findFirst.mockResolvedValue(_RemoteTarget({ generation: 1 }));
		await expect(repository.isReady(command)).resolves.toBe(false);
		findFirst.mockResolvedValue(_RemoteTarget({ state: McpConnectionState.Revoked }));
		await expect(repository.isReady(command)).resolves.toBe(false);
	});

	it("locks the install and exact active remote generation before dispatch", async function _LocksExactInstall()
	{
		const installUpdate = vi.fn().mockResolvedValue({ count: 1 });
		const connectionUpdate = vi.fn().mockResolvedValue({ count: 1 });
		const findFirst = vi.fn().mockResolvedValue(_RemoteTarget());
		const transaction = { mcpServerInstall: { findFirst, updateMany: installUpdate }, mcpConnection: { updateMany: connectionUpdate } } as unknown as Prisma.TransactionClient;
		const repository = new PrismaMcpConnectionReadinessRepository(transaction);

		await expect(repository.lockForDispatch(command)).resolves.toBe(true);
		expect(installUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "install-1", lifecycleState: McpInstallState.Installed, connectionStatus: McpConnectionStatus.Active }), data: { connectionStatus: McpConnectionStatus.Active } }));
		expect(connectionUpdate).toHaveBeenCalledWith({ where: { id: "connection-2", mcpServerInstallId: "install-1", ownerPrincipalId: "principal-1", generation: 2, endpointDigest: "sha256:endpoint", state: McpConnectionState.Active }, data: { state: McpConnectionState.Active } });
		expect(installUpdate).toHaveBeenCalledBefore(connectionUpdate);
		connectionUpdate.mockResolvedValue({ count: 0 });
		await expect(repository.lockForDispatch(command)).resolves.toBe(false);
	});

	it("locks a credentialless OCI install without requiring a connection row", async function _LocksOciInstall()
	{
		const installUpdate = vi.fn().mockResolvedValue({ count: 1 });
		const connectionUpdate = vi.fn();
		const transaction = { mcpServerInstall: { findFirst: vi.fn().mockResolvedValue(_OciTarget()), updateMany: installUpdate }, mcpConnection: { updateMany: connectionUpdate } } as unknown as Prisma.TransactionClient;

		await expect(new PrismaMcpConnectionReadinessRepository(transaction).lockForDispatch(command)).resolves.toBe(true);
		expect(connectionUpdate).not.toHaveBeenCalled();
	});

	it.each([McpInstallState.Removing, McpInstallState.Removed])("denies %s installs before selecting a revision", async function _DeniesUnavailableInstall(lifecycleState)
	{
		const findFirst = vi.fn().mockImplementation(function _Find(input: { readonly where: { readonly lifecycleState: McpInstallState } })
		{
			expect(input.where.lifecycleState).toBe(McpInstallState.Installed);
			return Promise.resolve(null);
		});
		const transaction = { mcpServerInstall: { findFirst, updateMany: vi.fn() }, mcpConnection: { updateMany: vi.fn() } } as unknown as Prisma.TransactionClient;

		await expect(new PrismaMcpConnectionReadinessRepository(transaction).lockForDispatch(command)).resolves.toBe(false);
		expect(transaction.mcpServerInstall.updateMany).not.toHaveBeenCalled();
		expect(transaction.mcpConnection.updateMany).not.toHaveBeenCalled();
	});
});

function _OciTarget()
{
	return {
		id: "install-1", mcpServerId: "server-1", principalId: "principal-1", connectionStatus: McpConnectionStatus.Credentialless,
		mcpServer: { credentialRequirement: McpCredentialRequirement.Credentialless, revisions: [{ transport: McpExecutionTransport.OciImage, connectionId: null, connectionGeneration: null, connectionOwnerPrincipalId: null, endpointDigest: null, connection: null }] },
	};
}

function _RemoteTarget(connection: { readonly ownerPrincipalId?: string; readonly generation?: number; readonly state?: McpConnectionState } = {})
{
	const ownerPrincipalId = connection.ownerPrincipalId ?? "principal-1";
	const generation = connection.generation ?? 2;
	return {
		id: "install-1", mcpServerId: "server-1", principalId: "principal-1", connectionStatus: McpConnectionStatus.Active,
		mcpServer: {
			credentialRequirement: McpCredentialRequirement.PrincipalCredential,
			revisions: [{ transport: McpExecutionTransport.RemoteHttp, connectionId: "connection-2", connectionGeneration: 2, connectionOwnerPrincipalId: "principal-1", endpointDigest: "sha256:endpoint", connection: { id: "connection-2", mcpServerInstallId: "install-1", ownerPrincipalId, generation, endpointDigest: "sha256:endpoint", state: connection.state ?? McpConnectionState.Active } }],
		},
	};
}
