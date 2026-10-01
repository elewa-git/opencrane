import { McpConnectionState, McpConnectionStatus, McpInstallState, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { McpInstallStates } from "@opencrane/contracts";

import { PrismaMcpInstallRemovalRepository } from "../prisma-mcp-install-removal-repository";

describe("PrismaMcpInstallRemovalRepository", () =>
{
	it.each([McpInstallState.Installed, McpInstallState.Removing])("locks a %s install before its retained connection cleanup", async lifecycleState =>
	{
		const findUnique = vi.fn().mockResolvedValue({ lifecycleState });
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const repository = new PrismaMcpInstallRemovalRepository({ mcpServerInstall: { findUnique, updateMany } } as unknown as Prisma.TransactionClient);

		await expect(repository.lockForCleanup("install-1")).resolves.toBe(lifecycleState === McpInstallState.Installed ? McpInstallStates.Installed : McpInstallStates.Removing);
		expect(updateMany).toHaveBeenCalledWith({ where: { id: "install-1", lifecycleState }, data: { lifecycleState } });
	});

	it("removes a generation-free install without entering cleanup", async () =>
	{
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const repository = new PrismaMcpInstallRemovalRepository({ mcpServerInstall: { updateMany } } as unknown as Prisma.TransactionClient);

		await expect(repository.markRemovedWithoutConnection("install-1")).resolves.toBe(true);
		expect(updateMany).toHaveBeenCalledWith({ where: { id: "install-1", lifecycleState: McpInstallState.Installed, connections: { none: {} } }, data: { lifecycleState: McpInstallState.Removed, connectionStatus: McpConnectionStatus.NeedsCredential } });
	});

	it("moves an installed row into removal and replays the stored winner", async () =>
	{
		const updateMany = vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
		const findUnique = vi.fn().mockResolvedValue({ lifecycleState: McpInstallState.Removing });
		const repository = new PrismaMcpInstallRemovalRepository({ mcpServerInstall: { updateMany, findUnique } } as unknown as Prisma.TransactionClient);

		await expect(repository.markRemoving("install-1")).resolves.toBe(true);
		await expect(repository.markRemoving("install-1")).resolves.toBe(true);
		expect(updateMany).toHaveBeenCalledWith({ where: { id: "install-1", lifecycleState: McpInstallState.Installed }, data: { lifecycleState: McpInstallState.Removing } });
	});

	it("completes only after every retained connection is revoked and cleaned", async () =>
	{
		const updateMany = vi.fn().mockResolvedValue({ count: 0 });
		const findUnique = vi.fn().mockResolvedValueOnce({ lifecycleState: McpInstallState.Removing }).mockResolvedValueOnce({ lifecycleState: McpInstallState.Removing });
		const repository = new PrismaMcpInstallRemovalRepository({ mcpServerInstall: { updateMany, findUnique } } as unknown as Prisma.TransactionClient);

		await expect(repository.markRemovedIfSettled("install-1")).resolves.toBe(false);
		expect(updateMany).toHaveBeenCalledWith({
			where: { id: "install-1", lifecycleState: McpInstallState.Removing, connections: { every: { state: McpConnectionState.Revoked, cleanupCompletedAt: { not: null } } } },
			data: { lifecycleState: McpInstallState.Removed, connectionStatus: McpConnectionStatus.NeedsCredential },
		});
	});

	it("uses the lifecycle decision to reject cleanup from Installed", async () =>
	{
		const updateMany = vi.fn();
		const findUnique = vi.fn().mockResolvedValue({ lifecycleState: McpInstallState.Installed });
		const repository = new PrismaMcpInstallRemovalRepository({ mcpServerInstall: { updateMany, findUnique } } as unknown as Prisma.TransactionClient);

		await expect(repository.markRemovedIfSettled("install-1")).resolves.toBe(false);
		expect(updateMany).not.toHaveBeenCalled();
	});
});
