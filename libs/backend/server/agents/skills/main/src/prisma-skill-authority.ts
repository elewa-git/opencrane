import { Prisma, SkillRevisionState, type PrismaClient } from "@prisma/client";

import { ___DoWithTrace } from "@opencrane/observability";

import type { AtomicPublishSkillRevisionResult, PublishSkillRevisionCommand, SkillAuthorityRepository, SkillPublicationSnapshot } from "./skill-publication.types.js";

/** Postgres authority that publishes one reviewed SkillRevision and advances its logical pointer. */
export class PrismaSkillAuthorityRepository implements SkillAuthorityRepository
{
	/** Canonical OpenCrane catalog database client. */
	private readonly prisma: PrismaClient;

	/** Creates the scope-checking authority adapter over the product Postgres database. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Read the revision and exact artifact state through the trusted caller's silo scope. */
	async getPublicationSnapshot(command: PublishSkillRevisionCommand): Promise<SkillPublicationSnapshot | null>
	{
		const self = this;
		return await ___DoWithTrace("skills.revision.snapshot", { siloId: command.siloId, skillId: command.skillId, skillRevisionId: command.skillRevisionId, artifactRevisionId: command.artifactRevisionId }, async function _traceSnapshot(): Promise<SkillPublicationSnapshot | null>
		{
			const revision = await self.prisma.skillRevision.findFirst({ where: { id: command.skillRevisionId, skillId: command.skillId, artifactRevisionId: command.artifactRevisionId, artifactContentAddress: command.artifactContentAddress, skill: { siloId: command.siloId } }, select: { state: true, artifactContentAddress: true, testReport: true, scanResult: true, signature: true, signerKeyId: true } });
			if (revision === null) return null;
			const artifact = await self.prisma.artifactRevision.findFirst({ where: { id: command.artifactRevisionId, contentAddress: command.artifactContentAddress, artifact: { siloId: command.siloId } }, select: { state: true } });
			if (artifact === null) return null;
			return { state: _ToPublicationState(revision.state), artifactPublished: artifact.state === "Published", artifactContentAddress: revision.artifactContentAddress, evidence: _Evidence(revision) };
		});
	}

	/** Lock and recheck every source of truth before publishing one exact revision and pointer. */
	async publishAtomically(command: PublishSkillRevisionCommand): Promise<AtomicPublishSkillRevisionResult>
	{
		const self = this;
		try
		{
			return await ___DoWithTrace("skills.revision.publish", { siloId: command.siloId, skillId: command.skillId, skillRevisionId: command.skillRevisionId, artifactRevisionId: command.artifactRevisionId }, async function _tracePublication(): Promise<AtomicPublishSkillRevisionResult>
			{
				return await self.prisma.$transaction(async function _publish(transaction: Prisma.TransactionClient): Promise<AtomicPublishSkillRevisionResult>
				{
					await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "skills" WHERE "id" = ${command.skillId} AND "silo_id" = ${command.siloId} FOR UPDATE`);
					await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "skill_revisions" WHERE "id" = ${command.skillRevisionId} AND "skill_id" = ${command.skillId} FOR UPDATE`);
					await transaction.$queryRaw(Prisma.sql`SELECT revision."id" FROM "artifact_revisions" revision JOIN "artifacts" artifact ON artifact."id" = revision."artifact_id" WHERE revision."id" = ${command.artifactRevisionId} AND artifact."silo_id" = ${command.siloId} FOR UPDATE OF revision, artifact`);

					const revision = await transaction.skillRevision.findFirst({ where: { id: command.skillRevisionId, skillId: command.skillId, artifactRevisionId: command.artifactRevisionId, artifactContentAddress: command.artifactContentAddress, skill: { siloId: command.siloId } }, select: { id: true, state: true, testReport: true, scanResult: true, signature: true, signerKeyId: true } });
					const artifact = await transaction.artifactRevision.findFirst({ where: { id: command.artifactRevisionId, contentAddress: command.artifactContentAddress, state: "Published", artifact: { siloId: command.siloId } }, select: { id: true } });
					if (revision === null || artifact === null) return { status: "not_found" };
					if (revision.state !== SkillRevisionState.Review || _Evidence(revision) === null) return { status: "conflict" };

					const published = await transaction.skillRevision.updateMany({ where: { id: command.skillRevisionId, skillId: command.skillId, state: SkillRevisionState.Review, artifactRevisionId: command.artifactRevisionId, artifactContentAddress: command.artifactContentAddress }, data: { state: SkillRevisionState.Published, reviewedBy: command.reviewedBy, publishedAt: new Date(command.publishedAt) } });
					if (published.count !== 1) return { status: "conflict" };
					const skill = await transaction.skill.updateMany({ where: { id: command.skillId, siloId: command.siloId }, data: { currentRevisionId: command.skillRevisionId } });
					return skill.count === 1 ? { status: "published" } : { status: "conflict" };
				});
			});
		}
		catch (error)
		{
			if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) return { status: "conflict" };
			throw error;
		}
	}
}

/** Convert server-owned JSON evidence into the reviewed shape without trusting browser input. */
function _Evidence(row: { readonly testReport: unknown; readonly scanResult: unknown; readonly signature: string | null; readonly signerKeyId: string | null }): SkillPublicationSnapshot["evidence"]
{
	if (!_IsPassedRecord(row.testReport) || !_IsPassedRecord(row.scanResult) || !row.signature?.trim() || !row.signerKeyId?.trim()) return null;
	return { testReport: row.testReport, scanResult: row.scanResult, signature: row.signature, signerKeyId: row.signerKeyId };
}

/** Require persisted structured evidence with the one literal successful result marker. */
function _IsPassedRecord(value: unknown): value is Readonly<Record<string, unknown>>
{
	return value !== null && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).passed === true;
}

/** Converts generated Prisma lifecycle enum values into the public stable vocabulary. */
function _ToPublicationState(state: SkillRevisionState): SkillPublicationSnapshot["state"]
{
	switch (state)
	{
		case SkillRevisionState.Draft: return "draft";
		case SkillRevisionState.Review: return "review";
		case SkillRevisionState.Published: return "published";
		case SkillRevisionState.Rejected: return "rejected";
		case SkillRevisionState.Revoked: return "revoked";
	}
}
