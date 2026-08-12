import type { ArtifactPromotionReceiptClaims, ArtifactReadLeaseClaims, ArtifactWriteLeaseClaims } from "@opencrane/backend/artifacts/authorization";
import type { ArtifactPreprocessorClaimCommand, ArtifactPreprocessorFailureCommand } from "@opencrane/contracts";

/**
 * Everything the server knows about one claimed PDF conversion job.
 *
 * The database picks the job and this describes it. There are no output fields here: the output
 * artifact and its write lease are created later, by `issueOutputLeaseAtomically`, after the
 * server has seen and hashed the submitted text. Note what is missing on purpose - no storage
 * location and no storage credential. The PDF worker never learns where the bytes live and never
 * holds a capability against storage; it reads and writes through OpenCrane, which brokers both
 * directions.
 *
 * Only `jobId`, `attempt`, `claimFence`, and derived source limits ever reach the worker; see
 * `ArtifactPreprocessorJobClaim` in libs/contracts for the trimmed shape sent over HTTP.
 *
 * @see {@link ArtifactPreprocessRepository.claimNextAtomically} which produces this.
 */
export interface ArtifactPreprocessClaimProjection
{
	/** Durable preprocessing job identifier. */
	readonly jobId: string;
	/** Monotonic attempt number allocated under the current claim. */
	readonly attempt: number;
	/** New random value generated for this claim. Every later worker call must send it back; a call carrying an older fence is rejected as stale, which is how a worker whose claim expired cannot still report a result. */
	readonly claimFence: string;
	/** Database-clock instant after which this claim is dead: source reads, output submissions, and failure reports are all rejected, and the next poller may reclaim the job. */
	readonly claimExpiresAt: Date;
	/** Source artifact silo selected from catalogue state. */
	readonly siloId: string;
	/** Logical source artifact selected from catalogue state. */
	readonly sourceArtifactId: string;
	/** Immutable PDF source revision identifier. */
	readonly sourceRevisionId: string;
	/** Size of the source PDF in bytes, so the worker can refuse a file above its configured ceiling before downloading it. */
	readonly sourceByteLength: number;
}

/**
 * A signed-ready read permission for the source PDF, plus the facts to check the download against.
 *
 * Issued only while the worker's attempt and fence are still current. This never leaves the
 * server: the app-side source broker signs the lease, calls the artifact service itself, and
 * streams the bytes on to the worker, so the worker sees only bytes and headers.
 *
 * @see {@link ArtifactPreprocessSourceLeaseIssuer.issueSourceLeaseAtomically} which produces this.
 */
export interface ArtifactPreprocessSourceLeaseProjection
{
	/** Read authority whose expiry never exceeds the current claim deadline. */
	readonly readLease: ArtifactReadLeaseClaims;
	/** Source byte count from the catalogue, compared against what the artifact service actually returns so a mismatch fails instead of being converted. */
	readonly byteLength: number;
	/** Fixed source media type admitted by this pipeline. */
	readonly mediaType: "application/pdf";
}

/**
 * The claim plus the hash and size of the text the server has already received in full.
 *
 * The server reads the whole submitted body, enforces its byte ceiling, and hashes it before
 * asking for a write lease. That order matters: the content address is computed by OpenCrane,
 * never supplied by the worker, so the worker cannot reserve write authority for bytes the
 * server has not seen.
 *
 * @see {@link ArtifactPreprocessRepository.issueOutputLeaseAtomically} which consumes this.
 */
export interface ArtifactPreprocessOutputLeaseRequest extends ArtifactPreprocessorClaimCommand
{
	/** SHA-256 content address computed from the bounded submitted text bytes. */
	readonly contentAddress: string;
	/** Exact submitted UTF-8 text byte length. */
	readonly byteLength: number;
}

/**
 * The write permission for the converted text, together with the revision id reserved for it.
 *
 * This type is server-only and must stay that way. `writeLease` is a capability over artifact
 * storage; the PDF worker never receives it, never receives the promotion receipt, and never
 * learns a storage location. The app-side output broker signs this lease, promotes the bytes
 * through the private artifact service, verifies the receipt, and only then completes the job.
 * The worker's whole view of this step is a 204 or a 409.
 *
 * `derivedRevisionId` is derived from the lease id, so completion can prove the receipt belongs
 * to the same lease that was handed out for this attempt.
 *
 * @see {@link ArtifactPreprocessRepository.issueOutputLeaseAtomically} which produces this.
 * @see {@link ArtifactPreprocessCompletionRequest} for the next step.
 */
export interface ArtifactPreprocessOutputLeaseProjection
{
	/** Immutable job identifier. */
	readonly jobId: string;
	/** Current claim attempt. */
	readonly attempt: number;
	/** Current claim fence. */
	readonly claimFence: string;
	/** Server-generated revision identity reserved by the catalogue authority. */
	readonly derivedRevisionId: string;
	/** Write permission over artifact storage for exactly these bytes. Signed and spent inside the server; sending it to the worker would hand the worker direct storage authority. */
	readonly writeLease: ArtifactWriteLeaseClaims;
}

/**
 * Proof from the artifact service that the converted bytes are stored, ready to be committed.
 *
 * Built by the app-side output broker after it verifies the receipt signature. The completion
 * transaction re-checks the receipt against the stored lease row before publishing anything, so
 * a receipt for a different lease, size, or media type is refused rather than trusted.
 *
 * `receiptDigest` is stored so a replay of the same completion is recognised instead of
 * publishing a second revision.
 */
export interface ArtifactPreprocessCompletionRequest extends ArtifactPreprocessorClaimCommand
{
	/** Server-reserved generated revision identifier. */
	readonly derivedRevisionId: string;
	/** Artifact-service verified promotion evidence. */
	readonly promotion: ArtifactPromotionReceiptClaims;
	/** SHA-256 digest of the compact signed receipt for durable replay fencing. */
	readonly receiptDigest: string;
}

/**
 * What a claim attempt returned: either a job now fenced to this worker, or nothing to do.
 *
 * `none` is the normal idle answer and the router turns it into HTTP 204, which tells the worker
 * to keep polling. `claimed` means the job row is already marked Claimed with a fresh fence and
 * expiry, so the worker owns it until that expiry passes.
 */
export type ClaimNextArtifactPreprocessJobResult = { readonly status: "claimed"; readonly claim: ArtifactPreprocessClaimProjection } | { readonly status: "none" };

/**
 * What happened when the server tried to reserve write authority for the submitted text.
 *
 * `issued` gives back the lease to sign and spend. `completed` means this exact output was
 * already published on this attempt - a duplicate submission after a lost response - and the
 * caller should report success without promoting anything again. `conflict` means stop: the job
 * or its output artifact is gone (`claim_not_found`), another attempt has taken over or the
 * claim expired (`stale_claim`), or the hash or size failed validation, or a previous lease for
 * this attempt was for different bytes (`invalid_output`).
 */
export type IssueArtifactPreprocessOutputLeaseResult = { readonly status: "issued"; readonly lease: ArtifactPreprocessOutputLeaseProjection } | { readonly status: "completed" } | { readonly status: "conflict"; readonly reason: "claim_not_found" | "stale_claim" | "invalid_output" };

/**
 * What happened when the server tried to commit the converted revision.
 *
 * `completed` covers both the first successful commit and a repeat of the same completion, so a
 * caller may treat it as plain success. `conflict` means nothing was published: the job or its
 * lease is missing (`claim_not_found`), the attempt or fence moved on or the revision id does
 * not match the lease (`stale_claim`), the receipt does not match the stored lease
 * (`invalid_receipt`), or that receipt was already spent (`receipt_consumed`).
 */
export type CompleteArtifactPreprocessJobResult = { readonly status: "completed" } | { readonly status: "conflict"; readonly reason: "claim_not_found" | "stale_claim" | "invalid_receipt" | "receipt_consumed" };

/**
 * What the server decided after a worker reported its attempt failed.
 *
 * The worker does not choose. `retryable` means the job was parked with a wait before it can be
 * claimed again, growing with the attempt number. `terminal` means the attempt limit is reached
 * and the job will not run again. `conflict` means the report was ignored because the job is
 * missing (`claim_not_found`) or the attempt, fence, or expiry no longer match (`stale_claim`);
 * either way the worker should stop and poll for new work.
 */
export type FailArtifactPreprocessJobResult = { readonly status: "retryable" | "terminal" } | { readonly status: "conflict"; readonly reason: "claim_not_found" | "stale_claim" };

/**
 * Hands out read permission for one job's source PDF.
 *
 * Split out from the full repository so the app-side source broker can be given just this one
 * method and cannot claim, complete, or fail jobs. The `Atomically` suffix on the method is a
 * standing rule in this package: every method carrying it does all its reads and writes inside
 * one serializable database transaction opened by the unit of work, never by the caller.
 *
 * Called by: `_CreateArtifactPreprocessSourceBroker` in
 * apps/opencrane/src/infra/artifacts/artifact-preprocess-source-broker.factory.ts.
 */
export interface ArtifactPreprocessSourceLeaseIssuer
{
	/**
	 * Issues read permission for the source PDF if this attempt still owns the job.
	 *
	 * @param command - The job id, attempt number, and fence the worker presented.
	 * @returns The lease and the source facts to check the download against, or null when the job
	 *   row does not match on state, attempt, fence, or expiry, or when the source revision is no
	 *   longer a published active PDF. Null must be turned into a refusal, not a retry.
	 */
	issueSourceLeaseAtomically(command: ArtifactPreprocessorClaimCommand): Promise<ArtifactPreprocessSourceLeaseProjection | null>;
}

/**
 * The complete set of database operations in the PDF-to-text job lifecycle.
 *
 * Every method runs in its own serializable transaction: claim, then issue a read lease, then
 * issue a write lease, then complete or fail. Each one re-checks the attempt and fence, so no
 * caller has to hold a transaction open across worker HTTP calls, and a worker that went quiet
 * cannot come back and change a job another attempt has taken over.
 *
 * Implemented by `_ArtifactPreprocessAuthority` (adds the transaction per call) over
 * `PrismaArtifactPreprocessRepository` (runs the SQL inside one). Build it with
 * `_CreateArtifactPreprocessAuthority`.
 *
 * Called by: `_CreateOptionalRuntimeComposition` in apps/opencrane/src/app/runtime-composition.ts
 * passes it to the router; `_CreateArtifactPreprocessOutputBroker` in
 * apps/opencrane/src/infra/artifacts/artifact-upload.factory.ts uses it for output and completion.
 */
export interface ArtifactPreprocessRepository extends ArtifactPreprocessSourceLeaseIssuer
{
	/**
	 * Takes the next job that is ready to run and fences it to this caller.
	 *
	 * Also recovers jobs whose claim expired, and creates the hidden output artifact row the first
	 * time a job is claimed, so later steps have somewhere to attach the text revision.
	 *
	 * @returns `claimed` with the job's source facts, or `none` when nothing is ready.
	 * @throws Error when a stored source byte count is too large to represent exactly in
	 *   JavaScript, because passing it on would silently truncate the size the worker enforces.
	 */
	claimNextAtomically(): Promise<ClaimNextArtifactPreprocessJobResult>;
	/**
	 * Reserves write permission for text the server has already received and hashed.
	 *
	 * Re-submitting the same bytes for the same attempt returns the same lease rather than a
	 * second one, so a lost response cannot create two parallel writes.
	 *
	 * @param request - The claim plus the server-computed content address and byte length.
	 * @returns `issued`, `completed` if this output was already published, or `conflict`.
	 */
	issueOutputLeaseAtomically(request: ArtifactPreprocessOutputLeaseRequest): Promise<IssueArtifactPreprocessOutputLeaseResult>;
	/**
	 * Commits the converted revision: spends the lease, publishes the revision, points the output
	 * artifact at it, records that it came from the source revision, and closes the job.
	 *
	 * @param request - The claim, the reserved revision id, the verified receipt, and its digest.
	 * @returns `completed` on success or on a repeat of the same completion, else `conflict`.
	 */
	completeAtomically(request: ArtifactPreprocessCompletionRequest): Promise<CompleteArtifactPreprocessJobResult>;
	/**
	 * Records a failed attempt and decides whether the job may run again.
	 *
	 * @param command - The claim plus one of the three allowed failure codes.
	 * @returns `retryable` with a wait before the next claim, `terminal` when the attempt limit is
	 *   reached, or `conflict` when the report no longer matches the live claim.
	 */
	failAtomically(command: ArtifactPreprocessorFailureCommand): Promise<FailArtifactPreprocessJobResult>;
}

/** TokenReview-confirmed identity of the sole artifact-preprocessor Kubernetes workload. */
export interface ReviewedArtifactPreprocessorIdentity
{
	/** Exact Kubernetes username returned by TokenReview. */
	readonly username: string;
	/** Namespace returned by the reviewed ServiceAccount subject. */
	readonly namespace: string;
	/** ServiceAccount name returned by TokenReview. */
	readonly serviceAccountName: string;
	/** Audiences accepted by the Kubernetes API server. */
	readonly audiences: readonly string[];
}

/**
 * Asks Kubernetes who a bearer token belongs to.
 *
 * This router has no user session and is not behind the normal auth middleware, so this is the
 * only thing standing between the internal listener and any pod that can reach it. The adapter
 * is supplied by the app so this package never holds a Kubernetes client.
 *
 * Called by: `_CreateArtifactPreprocessorTokenReviewer` in
 * libs/backend/server/infra/workload-identity/src/projected-token-reviewer.ts supplies the
 * implementation; `_IsPreprocessor` in artifact-preprocessing.router.ts calls it on every request.
 */
export interface ArtifactPreprocessorTokenReviewer
{
	/**
	 * Reviews one token mounted into a pod by Kubernetes.
	 *
	 * @param token - The value taken from an `Authorization: Bearer` header.
	 * @returns The reviewed identity, or null when the token is not valid. Null and a
	 *   non-matching identity are treated the same way: HTTP 401 with no detail about which check
	 *   failed.
	 * @throws Whatever the Kubernetes client throws when the API server cannot be reached; the
	 *   router logs it and answers 503 rather than 401, so an outage is not read as a denial.
	 */
	__Review(token: string): Promise<ReviewedArtifactPreprocessorIdentity | null>;
}

/**
 * The source PDF as a stream the server is relaying, plus the facts it must agree with.
 *
 * The server has already spent the read lease against the private artifact service; what the
 * worker receives is a plain byte stream with a length and a media type. No URL, no bucket, no
 * token. The two metadata fields are checked against both the job row and the lease before any
 * bytes are forwarded, so a stream that disagrees with the catalogue is refused.
 */
export interface ArtifactPreprocessSourceRead
{
	/** Exact length cross-checked against both job and read-lease catalogue facts. */
	readonly byteLength: number;
	/** Fixed media type cross-checked against both job and read-lease catalogue facts. */
	readonly mediaType: "application/pdf";
	/** Private artifact-service response body streamed through OpenCrane. */
	readonly bytes: AsyncIterable<Uint8Array>;
}

/**
 * Fetches the source PDF on the worker's behalf.
 *
 * The broker issues the read lease, signs it, calls the private artifact service, and returns
 * the byte stream. Routing the read through here is what keeps the artifact service address and
 * the lease inside the server.
 *
 * Called by: the `POST /jobs/:jobId/source` handler in artifact-preprocessing.router.ts.
 * Implemented by `_CreateArtifactPreprocessSourceBroker` in
 * apps/opencrane/src/infra/artifacts/artifact-preprocess-source-broker.factory.ts.
 */
export interface ArtifactPreprocessSourceBroker
{
	/**
	 * Streams the source PDF if this attempt still owns the job.
	 *
	 * @param command - The job id, attempt, and fence the worker presented.
	 * @returns The stream and its checked metadata, or null when the claim is no longer current,
	 *   which the router reports as HTTP 409 so the worker abandons the job and polls again.
	 * @throws When the artifact service is unreachable or answers badly; the router logs it and
	 *   answers 503, or destroys the response if headers were already sent.
	 */
	read(command: ArtifactPreprocessorClaimCommand): Promise<ArtifactPreprocessSourceRead | null>;
}

/**
 * Takes the converted text from the worker and does everything needed to publish it.
 *
 * Five steps, all inside the server: read the body under a byte ceiling, hash it, reserve a
 * write lease for exactly those bytes, promote them through the private artifact service and
 * verify the receipt, then commit the revision. The worker gets one word back. It never sees the
 * write lease, the receipt, or where the bytes went.
 *
 * Called by: the `PUT /jobs/:jobId/output` handler in artifact-preprocessing.router.ts.
 * Implemented by `_CreateArtifactPreprocessOutputBroker` in
 * apps/opencrane/src/infra/artifacts/artifact-upload.factory.ts.
 */
export interface ArtifactPreprocessOutputBroker
{
	/**
	 * Publishes one submitted output body.
	 *
	 * @param command - The job id, attempt, and fence the worker presented in request headers.
	 * @param bytes - The raw submitted body. Read once and fully before anything is reserved.
	 * @returns `"completed"` when the text is published, including when this repeats an already
	 *   published submission, or `"conflict"` when the claim is no longer current, which the
	 *   router reports as HTTP 409.
	 * @throws When the body exceeds the configured ceiling, or the artifact service is unreachable
	 *   or returns a receipt that does not verify. The router logs it and answers 503; the job
	 *   stays claimed until its expiry, then becomes retryable.
	 */
	publish(command: ArtifactPreprocessorClaimCommand, bytes: AsyncIterable<Uint8Array>): Promise<"completed" | "conflict">;
}

/** The one logging method this router needs, kept this small so the package does not depend on a full logger type. */
export interface ArtifactPreprocessorLogger
{
	/** Records one infrastructure failure without serialising credentials or request bodies. */
	error(bindings: { readonly err: unknown; readonly operation: string }, message: string): void;
}

/**
 * Everything `__CreateArtifactPreprocessorRouter` needs, supplied by the app composition root.
 *
 * The split is deliberate: `repository` owns database state, the two brokers own all byte
 * movement and all lease handling, and `tokenReviewer` plus `namespace` decide who is allowed to
 * call. Because the brokers sit here rather than in the worker, no storage address or lease is
 * ever rendered into a response.
 *
 * Called by: `_CreateOptionalRuntimeComposition` in apps/opencrane/src/app/runtime-composition.ts.
 */
export interface ArtifactPreprocessorRouterDependencies
{
	/** Fixed projected-token identity reviewer. */
	readonly tokenReviewer: ArtifactPreprocessorTokenReviewer;
	/** Exact namespace containing the preprocessing ServiceAccount. */
	readonly namespace: string;
	/** Durable catalogue state authority. */
	readonly repository: ArtifactPreprocessRepository;
	/** Source-byte broker that keeps the read lease and storage endpoint private. */
	readonly sourceBroker: ArtifactPreprocessSourceBroker;
	/** Output-byte broker that keeps the write lease and promotion receipt private. */
	readonly outputBroker: ArtifactPreprocessOutputBroker;
	/** Process logger for unavailable-authority failures. */
	readonly logger: ArtifactPreprocessorLogger;
}
