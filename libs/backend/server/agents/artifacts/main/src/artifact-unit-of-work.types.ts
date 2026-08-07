import type { ArtifactAuthorityRepository } from "./artifact-finalization.types.js";
import type { ArtifactPreprocessRepository } from "./artifact-preprocessing.types.js";
import type { ArtifactUploadLeaseRepository } from "./artifact-upload.types.js";

/** Domain-neutral signal that a fully rolled-back artifact publication race exhausted safe retries. */
export class _ArtifactPublicationConflictError extends Error
{
	/** Marks a conflict without exposing persistence-adapter details to the application authority. */
	constructor()
	{
		super("artifact publication conflict");
	}
}

/** Capability repositories bound to one artifact-publication database transaction. */
export interface ArtifactPublicationTransaction
{
	/** Metadata finalization repository that consumes one promotion receipt. */
	readonly revisions: ArtifactAuthorityRepository;
	/** Write-lease repository that reserves one proof-bound upload. */
	readonly uploadLeases: ArtifactUploadLeaseRepository;
}

/** Work that must either commit wholly or leave no durable artifact-publication effect. */
export type ArtifactPublicationWork<Result> = (transaction: ArtifactPublicationTransaction) => Promise<Result>;

/** Opaque transaction boundary for one artifact publication or lease reservation. */
export interface ArtifactPublicationUnitOfWork
{
	/** Runs repository work atomically; implementations translate only known rolled-back races. */
	run<Result>(work: ArtifactPublicationWork<Result>): Promise<Result>;
}

/** Opaque transaction boundary for one fenced artifact-preprocessing lifecycle operation. */
export interface ArtifactPreprocessUnitOfWork
{
	/** Runs one preprocessing repository operation against one private transaction client. */
	run<Result>(work: ArtifactPreprocessWork<Result>): Promise<Result>;
}

/** Work executed under exactly one private preprocessing transaction. */
export type ArtifactPreprocessWork<Result> = (repository: ArtifactPreprocessRepository) => Promise<Result>;
