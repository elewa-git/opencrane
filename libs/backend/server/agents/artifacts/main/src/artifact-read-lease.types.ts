import type { ArtifactReadLeaseClaims } from "@opencrane/backend/artifacts/authorization";

/**
 * Says whether the server issued a read lease for one published artifact revision.
 *
 * A server-side caller asks permission to read the bytes of one revision. Only two things can
 * come back: a short-lived signed lease it can hand to the private artifact service, or a
 * refusal. Nothing in this package hands back a storage location or a storage-provider
 * credential - no bucket, no object key, no pre-signed storage URL. The caller gets metadata
 * (content address, byte length, media type) plus an opaque signed lease, and only the artifact
 * service turns that lease into bytes.
 *
 * These strings are serialized, so they are part of the contract, not a local detail.
 *
 * Called by: `_CreateSkillAuthoringArtifactReader` in
 * apps/opencrane/src/infra/artifacts/artifact-upload.factory.ts, which throws
 * "artifact read lease denied" for any outcome other than `Issued`.
 *
 * @see {@link IssueArtifactReadLeaseResult} for the payload attached to each outcome.
 */
export enum IssueArtifactReadLeaseOutcomes
{
	/**
	 * The revision was found active and published and the lease was signed. The result also
	 * carries `compactLease` (the signed string to present to the artifact service) and `claims`
	 * (the same facts unsigned, so the caller can check what the service returns against them).
	 */
	Issued = "issued",
	/**
	 * Nothing was signed and nothing needs cleaning up. The result's `reason` says which check
	 * failed: `invalid_command` means an id was malformed or the clock argument was not a
	 * non-negative safe integer, so the catalogue was never queried; `revision_not_readable`
	 * means the catalogue holds no active artifact with that published revision in that silo, or
	 * the stored row failed a safety check. Retrying with the same input gives the same answer.
	 */
	Denied = "denied",
}

/**
 * Names the one revision a server-side caller wants to read.
 *
 * All three ids must match the same row set, and each must match `^[A-Za-z0-9_-]{1,128}$` or the
 * request is denied as `invalid_command` before the database is touched. The command carries no
 * byte length, media type, or content address on purpose: those are reloaded from the catalogue
 * so a caller cannot talk the server into signing byte facts it made up.
 *
 * @see {@link PublishedArtifactReadTarget} for the facts the catalogue returns for this command.
 */
export interface IssueArtifactReadLeaseCommand
{
	/** Silo that must own the artifact. A revision in another silo is treated as not readable. */
	readonly siloId: string;
	/** The artifact this revision belongs to. */
	readonly artifactId: string;
	/** The one published revision to read. Revisions never change once published. */
	readonly artifactRevisionId: string;
}

/**
 * The stored facts about one published revision, read back from the database.
 *
 * The issuer re-reads these instead of trusting the request, then checks that the three ids came
 * back exactly as asked for. That check is why the ids are repeated here rather than assumed:
 * if a repository ever returned a different row, the mismatch is caught before anything is
 * signed. Everything here goes into the lease unchanged.
 *
 * @see {@link ArtifactReadLeaseRepository.loadPublishedReadTarget} which produces this.
 */
export interface PublishedArtifactReadTarget
{
	/** Silo read from the artifact row, which must be Active. */
	readonly siloId: string;
	/** Artifact id read from the revision's artifact relation. */
	readonly artifactId: string;
	/** Revision id read from the catalogue row. */
	readonly artifactRevisionId: string;
	/** Stored content address, in the form `sha256:` plus 64 lowercase hex characters. */
	readonly contentAddress: string;
	/** Stored byte count. Must be a non-negative safe integer to survive the JSON boundary. */
	readonly byteLength: number;
	/** Stored media type. Must pass `__IsSafeArtifactMediaType` before it is signed. */
	readonly mediaType: string;
}

/**
 * Reads the stored facts for one published revision, and nothing else.
 *
 * The port is deliberately this small: it has no list method and no way to hand back a storage
 * location, so a caller holding it cannot enumerate a silo's artifacts or reach storage
 * directly. Implemented by `PrismaArtifactCatalogueRepository`, built through
 * `_CreateArtifactCatalogueRepository`.
 *
 * Called by: `__IssueArtifactReadLease` in artifact-read-lease.ts, which is in turn called by
 * `_CreateSkillAuthoringArtifactReader` in
 * apps/opencrane/src/infra/artifacts/artifact-upload.factory.ts.
 */
export interface ArtifactReadLeaseRepository
{
	/**
	 * Loads the requested revision when it is published and its artifact is active.
	 *
	 * @param command - The silo, artifact, and revision ids to look up.
	 * @returns The stored facts, or null when there is no such row, the artifact is not Active,
	 *   the revision is not Published, or the stored byte count is outside the range JavaScript
	 *   can carry exactly. Null is not an error: the caller turns it into a `revision_not_readable`
	 *   denial without saying which of those reasons applied.
	 */
	loadPublishedReadTarget(command: IssueArtifactReadLeaseCommand): Promise<PublishedArtifactReadTarget | null>;
}

/**
 * Signs read-lease claims using the private key mounted into the server pod.
 *
 * This package never holds key material. The app composition root loads the key and passes an
 * implementation in, which keeps the key out of every module that only needs a signature.
 *
 * Called by: satisfied inline as `{ sign: signLease }` in
 * apps/opencrane/src/infra/artifacts/artifact-upload.factory.ts, where `signLease` comes from
 * `_CreateArtifactReadLeaseSigner`.
 */
export interface ArtifactReadLeaseSigner
{
	/**
	 * Turns already-checked claims into the compact signed string the artifact service accepts.
	 *
	 * @param claims - Claims built from re-read catalogue facts, never from caller input.
	 * @returns The compact signed lease to send to the private artifact service.
	 * @throws Whatever the app-supplied signer throws, for example when the mounted key is
	 *   missing or unreadable. The issuer does not catch this, so the failure reaches the caller
	 *   instead of being reported as a denial.
	 */
	sign(claims: ArtifactReadLeaseClaims): string;
}

/**
 * What `__IssueArtifactReadLease` returns.
 *
 * On `Issued` the caller gets `compactLease` to send to the artifact service, and `claims` so it
 * can compare the service's `content-length` and `content-type` response headers against what
 * was signed and reject a mismatch. On `Denied` there is no lease and nothing to undo; `reason`
 * separates a malformed request from a revision that is simply not readable.
 *
 * @see {@link IssueArtifactReadLeaseOutcomes} for what each outcome means for a caller.
 */
export type IssueArtifactReadLeaseResult =
	| { readonly outcome: IssueArtifactReadLeaseOutcomes.Issued; readonly compactLease: string; readonly claims: ArtifactReadLeaseClaims }
	| { readonly outcome: IssueArtifactReadLeaseOutcomes.Denied; readonly reason: "invalid_command" | "revision_not_readable" };
