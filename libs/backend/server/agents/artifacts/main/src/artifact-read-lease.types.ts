import type { ArtifactReadLeaseClaims } from "@opencrane/backend/artifacts/authorization";

/** Server-owned coordinates for one exact published revision that may be read internally. */
export interface IssueArtifactReadLeaseCommand
{
	/** Silo whose artifact authority must contain the requested revision. */
	readonly siloId: string;
	/** Logical artifact that owns the revision. */
	readonly artifactId: string;
	/** Immutable published revision that owns the canonical bytes. */
	readonly artifactRevisionId: string;
}

/** Immutable catalog facts loaded only after active-silo and published-revision checks. */
export interface PublishedArtifactReadTarget
{
	/** Silo independently re-read from the active artifact record. */
	readonly siloId: string;
	/** Logical artifact independently re-read from the revision relation. */
	readonly artifactId: string;
	/** Exact immutable revision independently re-read from the catalog. */
	readonly artifactRevisionId: string;
	/** Canonical SHA-256 object address approved by that revision. */
	readonly contentAddress: string;
	/** Exact canonical byte count approved by that revision. */
	readonly byteLength: number;
	/** Catalog-approved media type for the immutable bytes. */
	readonly mediaType: string;
}

/** Persistence boundary that exposes no artifact path, list, or caller-controlled metadata. */
export interface ArtifactReadLeaseRepository
{
	/** Loads one active artifact's exact published revision, or null for every other state. */
	loadPublishedReadTarget(command: IssueArtifactReadLeaseCommand): Promise<PublishedArtifactReadTarget | null>;
}

/** Narrow signing port owned by server composition and backed by the mounted lease key. */
export interface ArtifactReadLeaseSigner
{
	/** Signs only validated server-owned artifact-read claims. */
	sign(claims: ArtifactReadLeaseClaims): string;
}

/** Result of one server-internal read-lease issuance attempt. */
export type IssueArtifactReadLeaseResult =
	| { readonly outcome: "issued"; readonly compactLease: string; readonly claims: ArtifactReadLeaseClaims }
	| { readonly outcome: "denied"; readonly reason: "invalid_command" | "revision_not_readable" };
