import { ArtifactPreprocessJobState, ArtifactRevisionState, ArtifactScanJobState, ArtifactState, type Prisma } from "@prisma/client";

import { ArtifactPreprocessPipelineVersions } from "@opencrane/backend/artifacts/preprocessor/workflows/contract";
import { ___IsSha256ContentAddress } from "@opencrane/models/artifacts";

import type { ScannedPdfTextLineage, ScannedPdfTextRepository } from "./pdf-text-lineage.types";

/** Resolves one converted PDF through its exact scan, completed job and sole parent revision. */
export class PrismaScannedPdfTextRepository implements ScannedPdfTextRepository
{
	/** Uses the caller's transaction so lineage and protected adoption share a snapshot. */
	constructor(private readonly transaction: Prisma.TransactionClient) {}

	/**
	 * Returns content coordinates only when the complete source-to-text chain remains published.
	 * The caller must authorize the source Artifact before using this internal read result; a
	 * hidden derivative does not create a separate participant grant.
	 */
	async resolve(siloId: string, sourceArtifactId: string, sourceRevisionId: string): Promise<ScannedPdfTextLineage | null>
	{
		const job = await this.transaction.artifactPreprocessJob.findUnique({
			where: { sourceRevisionId_pipelineVersion: { sourceRevisionId, pipelineVersion: ArtifactPreprocessPipelineVersions.PdfToText } },
			include: { sourceRevision: { include: { artifact: true, scanJob: true } }, derivedArtifact: true, derivedRevision: { include: { parents: true } } },
		});
		if (job === null || job.state !== ArtifactPreprocessJobState.Completed || job.completionDigest === null
			|| !___IsSha256ContentAddress(job.completionDigest) || job.completionConsumedAt === null || job.completedAt === null)
			return null;
		const source = job.sourceRevision;
		if (source.id !== sourceRevisionId || source.artifactId !== sourceArtifactId || source.artifact.siloId !== siloId
			|| source.artifact.state !== ArtifactState.Active || source.artifact.currentRevisionId !== source.id
			|| source.state !== ArtifactRevisionState.Published || source.mediaType !== "application/pdf"
			|| source.scanJob?.state !== ArtifactScanJobState.Clean || !_PositiveSafeLength(source.byteLength))
			return null;
		const artifact = job.derivedArtifact;
		const text = job.derivedRevision;
		if (artifact === null || text === null || job.derivedArtifactId !== artifact.id || job.derivedRevisionId !== text.id
			|| artifact.siloId !== siloId || artifact.state !== ArtifactState.Active || artifact.currentRevisionId !== text.id
			|| text.artifactId !== artifact.id || text.state !== ArtifactRevisionState.Published || text.mediaType !== "text/plain"
			|| !___IsSha256ContentAddress(text.contentAddress) || !_PositiveSafeLength(text.byteLength)
			|| text.parents.length !== 1 || text.parents[0]!.parentRevisionId !== source.id
			|| text.parents[0]!.childRevisionId !== text.id || !_MatchesProvenance(text.provenance, source.id))
			return null;
		return { siloId, sourceArtifactId, sourceRevisionId, sourceByteLength: Number(source.byteLength), artifactId: artifact.id,
			artifactRevisionId: text.id, contentAddress: text.contentAddress, byteLength: Number(text.byteLength), mediaType: "text/plain" };
	}
}

/** Refuses empty text and lengths that lose precision when used by the byte reader. */
function _PositiveSafeLength(value: bigint): boolean
{
	return value > 0n && value <= BigInt(Number.MAX_SAFE_INTEGER);
}

/** Checks the conversion receipt names the same pipeline and source as the parent relation. */
function _MatchesProvenance(value: Prisma.JsonValue, sourceRevisionId: string): boolean
{
	return typeof value === "object" && value !== null && !Array.isArray(value)
		&& value["pipelineVersion"] === ArtifactPreprocessPipelineVersions.PdfToText && value["sourceRevisionId"] === sourceRevisionId;
}
