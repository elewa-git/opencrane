import { ArtifactIndexState, ArtifactKind, ArtifactRevisionState, ArtifactState, Prisma } from "@prisma/client";

import type { ArtifactReadLeaseRepository, IssueArtifactReadLeaseCommand, PublishedArtifactReadTarget } from "./artifact-read-lease.types";
import type { PersonalArtifactEntry } from "./artifact-finalization.types";

/** Stable cursor for the descending catalogue order. */
interface ArtifactCatalogueCandidateCursor
{
	/** Updated instant of the last row in the previous page. */
	readonly updatedAt: Date;
	/** Stable identifier that breaks equal-timestamp ties. */
	readonly id: string;
}

/** One bounded candidate page plus the cursor needed to continue scanning. */
interface ArtifactCatalogueCandidatePage
{
	/** Lifecycle-eligible rows in stable descending order. */
	readonly entries: readonly PersonalArtifactEntry[];
	/** Cursor for the next raw page, or null when this page ended the catalogue. */
	readonly nextCursor: ArtifactCatalogueCandidateCursor | null;
}

/** Read-only Prisma repository for catalogue facts that require no durable transaction. */
export class PrismaArtifactCatalogueRepository implements ArtifactReadLeaseRepository
{
	/** Canonical product database client used only for read projections. */
	private readonly prisma: Prisma.TransactionClient;

	/** Creates the catalogue read repository. */
	constructor(prisma: Prisma.TransactionClient)
	{
		this.prisma = prisma;
	}

	/** Loads only an active artifact's exact published revision as storage-neutral read authority. */
	async loadPublishedReadTarget(command: IssueArtifactReadLeaseCommand): Promise<PublishedArtifactReadTarget | null>
	{
		const revision = await this.prisma.artifactRevision.findFirst({ where: { id: command.artifactRevisionId, artifactId: command.artifactId, state: ArtifactRevisionState.Published, artifact: { siloId: command.siloId, state: ArtifactState.Active } }, select: { id: true, artifactId: true, contentAddress: true, byteLength: true, mediaType: true, artifact: { select: { siloId: true } } } });
		if (revision === null || revision.byteLength < 0n || revision.byteLength > BigInt(Number.MAX_SAFE_INTEGER))
		{
			return null;
		}
		return { siloId: revision.artifact.siloId, artifactId: revision.artifactId, artifactRevisionId: revision.id, contentAddress: revision.contentAddress, byteLength: Number(revision.byteLength), mediaType: revision.mediaType };
	}

	/** Lists one bounded lifecycle-eligible page before central authorization filtering. */
	async listCatalogueCandidates(siloId: string, cursor: ArtifactCatalogueCandidateCursor | null = null, take = 50): Promise<ArtifactCatalogueCandidatePage>
	{
		const cursorWhere = cursor === null ? {} : { OR: [{ updatedAt: { lt: cursor.updatedAt } }, { updatedAt: cursor.updatedAt, id: { lt: cursor.id } }] };
		const artifacts = await this.prisma.artifact.findMany({ where: { siloId, state: { not: ArtifactState.Deleted }, currentRevisionId: { not: null }, ...cursorWhere }, select: { id: true, kind: true, state: true, currentRevisionId: true, currentRevision: { select: { mediaType: true, byteLength: true, indexState: true } }, createdAt: true, updatedAt: true }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take });
		const entries = artifacts.map(function _ToPersonalEntry(artifact): PersonalArtifactEntry
		{
			const byteLength = artifact.currentRevision === null ? null : artifact.currentRevision.byteLength.toString();
			const indexState = artifact.currentRevision === null ? null : _ToIndexState(artifact.currentRevision.indexState);
			return { id: artifact.id, kind: _ToKind(artifact.kind), state: artifact.state === ArtifactState.Active ? "active" : "deletion_pending", currentRevisionId: artifact.currentRevisionId, mediaType: artifact.currentRevision?.mediaType ?? null, byteLength, indexState, createdAt: artifact.createdAt.toISOString(), updatedAt: artifact.updatedAt.toISOString() };
		});
		const last = artifacts.at(-1);
		const nextCursor = artifacts.length === take && last !== undefined ? { updatedAt: last.updatedAt, id: last.id } : null;
		return { entries, nextCursor };
	}
}

/** Converts the generated database kind into the stable browser vocabulary. */
function _ToKind(kind: ArtifactKind): PersonalArtifactEntry["kind"]
{
	switch (kind)
	{
		case ArtifactKind.Document: return "document";
		case ArtifactKind.Generated: return "generated";
		case ArtifactKind.Skill: return "skill";
		case ArtifactKind.Upload: return "upload";
	}
}

/** Converts generated index state into the stable browser vocabulary. */
function _ToIndexState(state: ArtifactIndexState): NonNullable<PersonalArtifactEntry["indexState"]>
{
	switch (state)
	{
		case ArtifactIndexState.Pending: return "pending";
		case ArtifactIndexState.Indexed: return "indexed";
		case ArtifactIndexState.Failed: return "failed";
		case ArtifactIndexState.RemovalPending: return "removal_pending";
		case ArtifactIndexState.Removed: return "removed";
	}
}
