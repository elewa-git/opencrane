import { z, type ZodType } from "zod";

/**
 * Names the durable worker outcomes that can wake one PDF preprocessing delivery.
 *
 * The worker never selects workflow retry behavior directly. The server persists one of these
 * states, emits a small wake-up signal in the same database transaction, and the controller reloads
 * this persisted outcome before it deletes the exact Kubernetes Job.
 *
 * These values cross the private controller HTTP boundary and reflect states stored in
 * `artifact_preprocess_jobs`. Renaming one therefore requires a forward database and protocol
 * migration.
 */
export enum ArtifactPreprocessOutcomeKinds
{
	/** The converted text and its immutable completion digest were committed; this delivery is terminal. */
	Completed = "completed",
	/** The server accepted the failure; this delivery is terminal but the job may receive another delivery. */
	RetryableFailed = "retryable_failed",
	/** The server accepted the failure and exhausted the job's delivery limit; the job is terminal. */
	TerminalFailed = "terminal_failed",
}

/** Minimal identity carried by an Absurd event; the controller reloads the actual outcome. */
export interface ArtifactPreprocessOutcomeSignal
{
	/** Saved PDF preprocessing job whose persisted state changed. */
	readonly preprocessJobId: string;
	/** Exact claimed delivery that produced the persisted outcome. */
	readonly deliveryCount: number;
}

/**
 * Reports a persisted successful completion that authorizes exact Job cleanup.
 *
 * Called by: the controller HTTP decoder and artifact workflow handler after the server commits the
 * generated text and completion digest.
 */
export interface ArtifactPreprocessCompletedOutcome extends ArtifactPreprocessOutcomeSignal
{
	/** Confirms that publication and completion evidence committed. */
	readonly kind: ArtifactPreprocessOutcomeKinds.Completed;
	/** Immutable digest for the saved completion evidence. */
	readonly completionDigest: string;
}

/**
 * Reports a persisted failed delivery that authorizes cleanup and a later claimed delivery.
 *
 * Called by: the controller HTTP decoder and artifact workflow handler before a durable retry sleep.
 */
export interface ArtifactPreprocessRetryableFailedOutcome extends ArtifactPreprocessOutcomeSignal
{
	/** Confirms that the server accepted this delivery but another delivery may run later. */
	readonly kind: ArtifactPreprocessOutcomeKinds.RetryableFailed;
	/** Database-owned instant after which the controller may claim the next delivery. */
	readonly retryAt: string;
}

/**
 * Reports a persisted terminal failure that authorizes cleanup and stops further deliveries.
 *
 * Called by: the controller HTTP decoder and artifact workflow handler before terminal task failure.
 */
export interface ArtifactPreprocessTerminalFailedOutcome extends ArtifactPreprocessOutcomeSignal
{
	/** Confirms that the server stopped this preprocessing job without permitting another delivery. */
	readonly kind: ArtifactPreprocessOutcomeKinds.TerminalFailed;
}

/** Persisted outcome that authorizes UID-fenced cleanup for one delivery. */
export type ArtifactPreprocessOutcome = ArtifactPreprocessCompletedOutcome | ArtifactPreprocessRetryableFailedOutcome | ArtifactPreprocessTerminalFailedOutcome;

/** Validates the persisted outcome shape shared by every controller transport. */
const _ArtifactPreprocessOutcomeSchema: ZodType<ArtifactPreprocessOutcome> = z.discriminatedUnion("kind", [
	z.object({ preprocessJobId: z.string().min(1).max(128), deliveryCount: z.number().int().min(1), kind: z.literal(ArtifactPreprocessOutcomeKinds.Completed), completionDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u) }).strict(),
	z.object({ preprocessJobId: z.string().min(1).max(128), deliveryCount: z.number().int().min(1), kind: z.literal(ArtifactPreprocessOutcomeKinds.RetryableFailed), retryAt: z.string().datetime({ offset: true }) }).strict(),
	z.object({ preprocessJobId: z.string().min(1).max(128), deliveryCount: z.number().int().min(1), kind: z.literal(ArtifactPreprocessOutcomeKinds.TerminalFailed) }).strict(),
]);

/**
 * Decodes one untrusted controller response into the shared persisted outcome.
 *
 * Called by: `_ParseArtifactPreprocessOutcome`, which additionally binds the decoded identity to
 * the HTTP request URL and delivery number.
 *
 * @param value - Untrusted JSON received through a controller transport.
 * @returns A complete persisted delivery outcome.
 * @throws ZodError when the value is not one exact supported outcome.
 */
export function __ParseArtifactPreprocessOutcome(value: unknown): ArtifactPreprocessOutcome
{
	return _ArtifactPreprocessOutcomeSchema.parse(value);
}

/** Builds the delivery-scoped event name required by Absurd's first-emission-wins event store. */
export function __ArtifactPreprocessOutcomeEventName(deliveryCount: number): string
{
	if (!Number.isSafeInteger(deliveryCount) || deliveryCount < 1)
	{
		throw new Error("Artifact preprocessing outcome requires a positive delivery count.");
	}
	return `artifact-preprocess-outcome:${deliveryCount}`;
}
