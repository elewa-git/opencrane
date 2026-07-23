import { SkillRevisionState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaSkillAuthorityRepository } from "../prisma-skill-authority.js";

/** Build one complete, host-scoped publication command. */
function _Command()
{
	return { siloId: "silo-1", skillId: "skill-1", skillRevisionId: "skill-revision-1", artifactRevisionId: "artifact-revision-1", artifactContentAddress: `sha256:${"a".repeat(64)}`, reviewedBy: "reviewer-1", publishedAt: "2026-07-23T10:00:00.000Z" };
}

/** Build a transaction fake that records the authority's lock and conditional write discipline. */
function _Prisma(options: { readonly revision?: { readonly id: string; readonly state: SkillRevisionState } | null; readonly artifact?: { readonly id: string } | null; readonly evidenceComplete?: boolean; readonly updated?: number; readonly skillUpdated?: number } = {})
{
	const transaction = {
		$queryRaw: vi.fn(),
		skillRevision: { findFirst: vi.fn().mockResolvedValue(options.revision === undefined ? { id: "skill-revision-1", state: SkillRevisionState.Review, testReport: options.evidenceComplete === false ? null : { passed: true }, scanResult: { passed: true }, signature: options.evidenceComplete === false ? null : "signature", signerKeyId: "key-1" } : options.revision), updateMany: vi.fn().mockResolvedValue({ count: options.updated ?? 1 }) },
		artifactRevision: { findFirst: vi.fn().mockResolvedValue(options.artifact === undefined ? { id: "artifact-revision-1" } : options.artifact) },
		skill: { updateMany: vi.fn().mockResolvedValue({ count: options.skillUpdated ?? 1 }) },
	};
	const prisma = { $transaction: vi.fn(async function _transaction(work: (client: typeof transaction) => Promise<unknown>) { return await work(transaction); }) } as never;
	return { transaction, prisma };
}

describe("PrismaSkillAuthorityRepository", function _DescribePrismaSkillAuthorityRepository()
{
	it("locks scoped skill, revision, and exact artifact before atomically publishing", async function _Publishes()
	{
		const { prisma, transaction } = _Prisma();
		const result = await new PrismaSkillAuthorityRepository(prisma).publishAtomically(_Command());
		expect(result).toEqual({ status: "published" });
		expect(transaction.$queryRaw).toHaveBeenCalledTimes(3);
		expect(transaction.skillRevision.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ skill: { siloId: "silo-1" } }) }));
		expect(transaction.skillRevision.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ state: SkillRevisionState.Review }), data: { state: SkillRevisionState.Published, reviewedBy: "reviewer-1", publishedAt: new Date("2026-07-23T10:00:00.000Z") } }));
		expect(transaction.skill.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "skill-1", siloId: "silo-1" }, data: { currentRevisionId: "skill-revision-1" } }));
	});

	it("does not expose a revision from another silo as a publishable authority", async function _HidesCrossSilo()
	{
		const { prisma, transaction } = _Prisma({ revision: null });
		const result = await new PrismaSkillAuthorityRepository(prisma).publishAtomically(_Command());
		expect(result).toEqual({ status: "not_found" });
		expect(transaction.skillRevision.updateMany).not.toHaveBeenCalled();
		expect(transaction.skill.updateMany).not.toHaveBeenCalled();
	});

	it("returns conflict when a concurrent publisher consumes the review state", async function _DetectsStaleReview()
	{
		const { prisma, transaction } = _Prisma({ updated: 0 });
		const result = await new PrismaSkillAuthorityRepository(prisma).publishAtomically(_Command());
		expect(result).toEqual({ status: "conflict" });
		expect(transaction.skill.updateMany).not.toHaveBeenCalled();
	});

	it("returns conflict without writing when server-owned review evidence disappears under the lock", async function _RejectsLostEvidence()
	{
		const { prisma, transaction } = _Prisma({ evidenceComplete: false });
		const result = await new PrismaSkillAuthorityRepository(prisma).publishAtomically(_Command());
		expect(result).toEqual({ status: "conflict" });
		expect(transaction.skillRevision.updateMany).not.toHaveBeenCalled();
		expect(transaction.skill.updateMany).not.toHaveBeenCalled();
	});
});
