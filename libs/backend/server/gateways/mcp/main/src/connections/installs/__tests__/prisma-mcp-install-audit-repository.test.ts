import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaMcpInstallAuditRepository } from "../prisma-mcp-install-audit-repository";

describe("PrismaMcpInstallAuditRepository", () =>
{
	it("preserves the installed-server deletion audit contract", async () =>
	{
		const create = vi.fn().mockResolvedValue({ id: 1 });
		const repository = new PrismaMcpInstallAuditRepository({ auditEntry: { create } } as unknown as Prisma.TransactionClient);

		await repository.appendUninstalled("silo-1", "server-1", "principal-1", "principal-1");
		expect(create).toHaveBeenCalledWith({ data: { siloId: "silo-1", action: "Deleted", resource: "McpServerInstall/server-1:principal-1", message: "MCP server server-1 uninstalled for principal-1", metadata: { actorPrincipalId: "principal-1" } } });
	});
});
