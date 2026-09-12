import { McpApprovalStatus, McpConnectionStatus, McpCredentialRequirement, McpServerRevisionState, McpServerStatus, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaMcpConnectionReadinessRepository } from "../prisma-mcp-connection-readiness-repository";

describe("PrismaMcpConnectionReadinessRepository", function _Suite()
{
	const command = { siloId: "silo-1", toolRevisionId: "tool-1", ownerPrincipalId: "principal-1" };

	it("binds readiness to the exact credentialless owner, tool, revision, and published server", async function _ReadsExactInstall()
	{
		const findFirst = vi.fn().mockResolvedValue({ id: "install-1" });
		const transaction = { mcpServerInstall: { findFirst } } as unknown as Prisma.TransactionClient;
		const repository = new PrismaMcpConnectionReadinessRepository(transaction);

		await expect(repository.isReady(command)).resolves.toBe(true);
		expect(findFirst).toHaveBeenCalledWith({
			where: {
				principalId: "principal-1",
				connectionStatus: McpConnectionStatus.Credentialless,
				mcpServer: {
					is: {
						siloId: "silo-1",
						credentialRequirement: McpCredentialRequirement.Credentialless,
						status: McpServerStatus.Active,
						approvalStatus: McpApprovalStatus.Published,
						revisions: { some: { state: McpServerRevisionState.Ready, protocolVersion: "2026-07-28", tools: { some: { id: "tool-1", siloId: "silo-1" } } } },
					},
				},
			},
			select: { id: true },
		});
	});

	it("uses one conditional update to serialize dispatch with uninstall", async function _LocksExactInstall()
	{
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { mcpServerInstall: { updateMany } } as unknown as Prisma.TransactionClient;
		const repository = new PrismaMcpConnectionReadinessRepository(transaction);

		await expect(repository.lockForDispatch(command)).resolves.toBe(true);
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { connectionStatus: McpConnectionStatus.Credentialless } }));
		updateMany.mockResolvedValue({ count: 0 });
		await expect(repository.lockForDispatch(command)).resolves.toBe(false);
	});
});
