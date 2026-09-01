import { describe, expect, it, vi } from "vitest";

import type { SignedFleetMembershipRevision } from "@opencrane/models/authorization";

import { _RunLocalDevelopmentSeed } from "../seed";

/** Builds signed evidence for the revision selected by the replaying seed. */
function _Membership(revision: number): SignedFleetMembershipRevision
{
	return {
		revision,
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
		payloadDigest: `sha256:seed-membership-${revision}`,
		signature: `seed-signature-${revision}`
	};
}

describe("Tier 2 database seed", function _Suite()
{
	it("appends fresh immutable membership evidence when mutable local state is replayed", async function _SeedsAtomically(): Promise<void>
	{
		let latestRevision: number | null = null;
		const revisionCreate = vi.fn(async function _CreateRevision(input: { data: { id: string; revision: number } }): Promise<void>
		{
			latestRevision = input.data.revision;
		});
		const assertionCreate = vi.fn();
		const modelDefinitionUpsert = vi.fn();
		const modelRoutingDefaultUpsert = vi.fn();
		const transaction = {
			principal: { upsert: vi.fn() },
			orgMembership: { upsert: vi.fn() },
			verifiedFleetMembershipRevision: {
				findFirst: vi.fn(async function _LatestRevision(): Promise<{ revision: number } | null>
				{
					return !latestRevision ? null : { revision: latestRevision };
				}),
				create: revisionCreate
			},
			verifiedFleetMembershipAssertion: { create: assertionCreate },
			modelDefinition: { upsert: modelDefinitionUpsert },
			modelRoutingDefault: { upsert: modelRoutingDefaultUpsert }
		};
		const prisma = {
			$transaction: vi.fn(async function _Transaction(operation) { await operation(transaction); }),
			$disconnect: vi.fn()
		};
		const dependencies = {
			assertLocalDatabase: vi.fn(),
			createMembership: vi.fn(_Membership),
			createPrisma() { return prisma as never; }
		};

		await _RunLocalDevelopmentSeed(dependencies);
		await _RunLocalDevelopmentSeed(dependencies);

		expect(prisma.$transaction).toHaveBeenCalledTimes(2);
		expect(prisma.$disconnect).toHaveBeenCalledTimes(2);

		expect(transaction.principal.upsert).toHaveBeenCalledTimes(2);
		expect(transaction.orgMembership.upsert).toHaveBeenCalledTimes(2);
		expect(transaction.modelDefinition.upsert).toHaveBeenCalledTimes(2);
		expect(transaction.modelRoutingDefault.upsert).toHaveBeenCalledTimes(2);
		expect(modelDefinitionUpsert).toHaveBeenCalledWith(expect.objectContaining({
			where: { id_siloId: { id: "local-development-model-auto", siloId: "local-development" } },
			create: expect.objectContaining({ id: "local-development-model-auto", siloId: "local-development" })
		}));
		expect(modelRoutingDefaultUpsert).toHaveBeenCalledWith(expect.objectContaining({
			where: { id_siloId: { id: "local-development-model-routing-default", siloId: "local-development" } },
			create: expect.objectContaining({ id: "local-development-model-routing-default", siloId: "local-development" })
		}));
		expect(dependencies.createMembership.mock.calls).toEqual([[1], [2]]);
		expect(revisionCreate.mock.calls.map(([input]) => input.data.id)).toEqual([
			"local-development-membership-revision-1",
			"local-development-membership-revision-2"
		]);
		expect(assertionCreate.mock.calls.map(([input]) => input.data)).toMatchObject([
			{
				id: "local-development-membership-assertion-row-1",
				revisionId: "local-development-membership-revision-1"
			},
			{
				id: "local-development-membership-assertion-row-2",
				revisionId: "local-development-membership-revision-2"
			}
		]);
	});
});
