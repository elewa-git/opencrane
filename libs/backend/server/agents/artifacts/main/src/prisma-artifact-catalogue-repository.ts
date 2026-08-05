import { ArtifactIndexState, ArtifactKind, ArtifactRevisionState, ArtifactState, Prisma } from "@prisma/client";

import type { ArtifactReadLeaseRepository, IssueArtifactReadLeaseCommand, PublishedArtifactReadTarget } from "./artifact-read-lease.types.js";
import type { PersonalArtifactCatalogueRepository, PersonalArtifactEntry } from "./artifact-finalization.types.js";

/** Read-only Prisma repository for catalogue facts that require no durable transaction. */
export class PrismaArtifactCatalogueRepository implements ArtifactReadLeaseRepository, PersonalArtifactCatalogueRepository
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
		if (revision === null || revision.byteLength < 0n || revision.byteLength > BigInt(Number.MAX_SAFE_INTEGER)) return null;
		return { siloId: revision.artifact.siloId, artifactId: revision.artifactId, artifactRevisionId: revision.id, contentAddress: revision.contentAddress, byteLength: Number(revision.byteLength), mediaType: revision.mediaType };
	}

	/** Lists bounded browser-safe metadata only for assets owned by the trusted requester. */
	async listOwnedCatalogue(siloId: string, ownerPrincipalId: string): Promise<readonly PersonalArtifactEntry[]>
	{
		const artifacts = await this.prisma.artifact.findMany({ where: { siloId, ownerPrincipalId, state: { not: ArtifactState.Deleted }, currentRevisionId: { not: null } }, select: { id: true, kind: true, state: true, currentRevisionId: true, currentRevision: { select: { mediaType: true, byteLength: true, indexState: true } }, createdAt: true, updatedAt: true }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 50 });
		return artifacts.map(function _ToPersonalEntry(artifact): PersonalArtifactEntry { return { id: artifact.id, kind: _ToKind(artifact.kind), state: artifact.state === ArtifactState.Active ? "active" : "deletion_pending", currentRevisionId: artifact.currentRevisionId, mediaType: artifact.currentRevision?.mediaType ?? null, byteLength: artifact.currentRevision === null ? null : artifact.currentRevision.byteLength.toString(), indexState: artifact.currentRevision === null ? null : _ToIndexState(artifact.currentRevision.indexState), createdAt: artifact.createdAt.toISOString(), updatedAt: artifact.updatedAt.toISOString() }; });
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
