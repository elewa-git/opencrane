import { PersonaRevisionState, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaRuntimePersonaEffectEligibilityAuthority } from "../prisma-runtime-persona-effect-eligibility";

describe("PrismaRuntimePersonaEffectEligibilityAuthority", function _Suite()
{
	it("rejects a revision outside the exact silo, owner, Approved lifecycle, or active profile pointer", async function _RejectsMismatch()
	{
		const findFirst = vi.fn().mockResolvedValue(null);
		const transaction = { personaRevision: { findFirst } } as unknown as Prisma.TransactionClient;
		const authority = new PrismaRuntimePersonaEffectEligibilityAuthority(transaction);

		await expect(authority.findEligibleProfileId({ siloId: "silo-1", userId: "user-1", personaRevisionId: "revision-1" })).resolves.toBeNull();
		expect(findFirst).toHaveBeenCalledWith({
			where: {
				id: "revision-1",
				state: PersonaRevisionState.Approved,
				profile: { is: { siloId: "silo-1", userId: "user-1", activeRevisionId: "revision-1" } },
			},
			select: { personaProfileId: true },
		});
	});
});
