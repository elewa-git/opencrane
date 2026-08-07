import type { ArtifactReadLeaseClaims } from "@opencrane/backend/artifacts/authorization";

/**
 * Stable serialized outcomes of the server-internal read-lease issuer.
 *
 * These values cross the artifacts package boundary so callers can branch on
 * one owned vocabulary without changing the existing result wire shape.
 */
export enum IssueArtifactReadLeaseOutcomes
{
	/** Exact catalogue facts were accepted and signed into a bounded read lease. */
	Issued = "issued",
	/** Input or catalogue evidence failed closed without granting read authority. */
	Denied = "denied",
}

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

/** Immutable catalogue facts loaded only after active-silo and published-revision checks. */
export interface PublishedArtifactReadTarget
{
	/** Silo independently loaded from the active artifact record. */
	readonly siloId: string;
	/** Logical artifact independently loaded from the revision relation. */
	readonly artifactId: string;
	/** Exact immutable revision independently loaded from the catalogue. */
	readonly artifactRevisionId: string;
	/** Canonical SHA-256 object address approved by that revision. */
	readonly contentAddress: string;
	/** Exact canonical byte count approved by that revision. */
	readonly byteLength: number;
	/** Catalogue-approved media type for the immutable bytes. */
	readonly mediaType: string;
}

/** Persistence boundary exposing no artifact path, list, or caller-supplied byte metadata. */
export interface ArtifactReadLeaseRepository
{
	/** Loads one active artifact's exact published revision, or null for every other state. */
	loadPublishedReadTarget(command: IssueArtifactReadLeaseCommand): Promise<PublishedArtifactReadTarget | null>;
}

/** Narrow signing port owned by server composition and backed by mounted key material. */
export interface ArtifactReadLeaseSigner
{
	/** Signs only validated server-owned artifact-read claims. */
	sign(claims: ArtifactReadLeaseClaims): string;
}

/** Stable outcome of one server-internal read-lease issuance attempt. */
export type IssueArtifactReadLeaseResult =
	| { readonly outcome: IssueArtifactReadLeaseOutcomes.Issued; readonly compactLease: string; readonly claims: ArtifactReadLeaseClaims }
	| { readonly outcome: IssueArtifactReadLeaseOutcomes.Denied; readonly reason: "invalid_command" | "revision_not_readable" };
