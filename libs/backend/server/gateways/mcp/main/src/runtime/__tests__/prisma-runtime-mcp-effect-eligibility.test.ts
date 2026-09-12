import { McpApprovalStatus, McpConnectionStatus, McpCredentialRequirement, McpServerRevisionState, McpServerStatus, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaRuntimeMcpEffectEligibilityAuthority } from "../prisma-runtime-mcp-effect-eligibility";

describe("PrismaRuntimeMcpEffectEligibilityAuthority", function _Suite()
{
	it("rejects a missing exact assignment, inactive server, unpublished server, or non-Ready revision", async function _RejectsMismatch()
	{
		const findFirst = vi.fn().mockResolvedValue(null);
		const install = vi.fn().mockResolvedValue(null);
		const transaction = { agentRevisionMcpToolAssignment: { findFirst }, mcpServerInstall: { findFirst: install } } as unknown as Prisma.TransactionClient;
		const authority = new PrismaRuntimeMcpEffectEligibilityAuthority(transaction);

		await expect(authority.isEligible({ siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", toolRevisionId: "tool-1", ownerPrincipalId: "service-principal-1" })).resolves.toBe(false);
		expect(findFirst).toHaveBeenCalledWith({
			where: {
				agentRevisionId: "revision-1",
				agentServiceId: "service-1",
				toolRevisionId: "tool-1",
				siloId: "silo-1",
			},
			select: { agentRevisionId: true },
		});
		expect(install).not.toHaveBeenCalled();
	});

	it("checks the execution Principal install after the exact assignment matches", async function _ChecksOwnerInstall()
	{
		const install = vi.fn().mockResolvedValue({ id: "install-1" });
		const transaction = { agentRevisionMcpToolAssignment: { findFirst: vi.fn().mockResolvedValue({ agentRevisionId: "revision-1" }) }, mcpServerInstall: { findFirst: install } } as unknown as Prisma.TransactionClient;
		const authority = new PrismaRuntimeMcpEffectEligibilityAuthority(transaction);

		await expect(authority.isEligible({ siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", toolRevisionId: "tool-1", ownerPrincipalId: "service-principal-1" })).resolves.toBe(true);
		expect(install).toHaveBeenCalledWith({
			where: {
				principalId: "service-principal-1",
				connectionStatus: McpConnectionStatus.Credentialless,
				mcpServer: { is: { siloId: "silo-1", credentialRequirement: McpCredentialRequirement.Credentialless, status: McpServerStatus.Active, approvalStatus: McpApprovalStatus.Published, revisions: { some: { state: McpServerRevisionState.Ready, protocolVersion: "2026-07-28", tools: { some: { id: "tool-1", siloId: "silo-1" } } } } } },
			},
			select: { id: true },
		});
	});
});
