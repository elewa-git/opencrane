import { McpApprovalStatus, McpServerRevisionState, McpServerStatus, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaRuntimeMcpEffectEligibilityAuthority } from "../prisma-runtime-mcp-effect-eligibility";

describe("PrismaRuntimeMcpEffectEligibilityAuthority", function _Suite()
{
	it("rejects a missing exact assignment, inactive server, unpublished server, or non-Ready revision", async function _RejectsMismatch()
	{
		const findFirst = vi.fn().mockResolvedValue(null);
		const transaction = { agentRevisionMcpToolAssignment: { findFirst } } as unknown as Prisma.TransactionClient;
		const authority = new PrismaRuntimeMcpEffectEligibilityAuthority(transaction);

		await expect(authority.isEligible({ siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", toolRevisionId: "tool-1" })).resolves.toBe(false);
		expect(findFirst).toHaveBeenCalledWith({
			where: {
				agentRevisionId: "revision-1",
				agentServiceId: "service-1",
				toolRevisionId: "tool-1",
				siloId: "silo-1",
				toolRevision: { is: { serverRevision: { is: { state: McpServerRevisionState.Ready, server: { is: { status: McpServerStatus.Active, approvalStatus: McpApprovalStatus.Published } } } } } },
			},
			select: { agentRevisionId: true },
		});
	});
});
