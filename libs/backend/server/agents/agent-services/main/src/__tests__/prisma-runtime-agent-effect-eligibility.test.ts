import { AgentRevisionState, AgentServiceKind, AgentServiceState, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaRuntimeAgentEffectEligibilityAuthority } from "../db/prisma-runtime-agent-effect-eligibility";

describe("PrismaRuntimeAgentEffectEligibilityAuthority", function _Suite()
{
	it("rejects any service outside the exact silo, kind, active revision, lifecycle, or managed Principal", async function _RejectsMismatch()
	{
		const findFirst = vi.fn().mockResolvedValue(null);
		const transaction = { agentService: { findFirst } } as unknown as Prisma.TransactionClient;
		const authority = new PrismaRuntimeAgentEffectEligibilityAuthority(transaction);

		await expect(authority.isEligible({ siloId: "silo-1", principalId: "principal-1", agentServiceId: "service-1", agentRevisionId: "revision-1", executionKind: "managed" })).resolves.toBe(false);
		expect(findFirst).toHaveBeenCalledWith({
			where: {
				id: "service-1",
				siloId: "silo-1",
				kind: AgentServiceKind.Managed,
				state: AgentServiceState.Active,
				activeRevisionId: "revision-1",
				principalId: "principal-1",
				activeRevision: { is: { id: "revision-1", state: AgentRevisionState.Published } },
			},
			select: { id: true },
		});
	});
});
