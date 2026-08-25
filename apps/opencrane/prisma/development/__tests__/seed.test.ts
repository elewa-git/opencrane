import { describe, expect, it, vi } from "vitest";

import type { SignedFleetMembershipRevision } from "@opencrane/models/authorization";

import { _RunLocalDevelopmentSeed } from "../seed";

/** Builds stable signed evidence without reading a workstation key. */
function _Membership(): SignedFleetMembershipRevision
{
	return {
		revision: 1,
		issuerId: "local-development-issuer",
		issuerKeyId: "local-development-key",
		siloId: "local-development",
		issuedAtEpochMs: 1_787_572_800_000,
		expiresAtEpochMs: 1_788_177_600_000,
		assertions: [{
			assertionId: "local-development-personal-membership",
			siloId: "local-development",
			subjectId: "local-development-user"
		}],
		payloadDigest: "sha256:seed-membership",
		signature: "seed-signature"
	};
}

describe("Tier 2 database seed", function _Suite()
{
	it("replays every identity, membership, and model write inside one transaction", async function _SeedsAtomically(): Promise<void>
	{
		const transaction = {
			principal: { upsert: vi.fn() },
			orgMembership: { upsert: vi.fn() },
			verifiedFleetMembershipRevision: { upsert: vi.fn() },
			verifiedFleetMembershipAssertion: { upsert: vi.fn() },
			modelDefinition: { upsert: vi.fn() },
			modelRoutingDefault: { upsert: vi.fn() }
		};
		const prisma = {
			$transaction: vi.fn(async function _Transaction(operation) { await operation(transaction); }),
			$disconnect: vi.fn()
		};
		const dependencies = {
			assertLocalDatabase: vi.fn(),
			createMembership: _Membership,
			createPrisma() { return prisma as never; }
		};

		await _RunLocalDevelopmentSeed(dependencies);
		await _RunLocalDevelopmentSeed(dependencies);

		expect(prisma.$transaction).toHaveBeenCalledTimes(2);
		expect(prisma.$disconnect).toHaveBeenCalledTimes(2);

		for (const delegate of Object.values(transaction))
		{
			expect(delegate.upsert).toHaveBeenCalledTimes(2);
		}
	});
});
