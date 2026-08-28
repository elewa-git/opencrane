/**
 * Names the durable worker outcomes that can wake one PDF preprocessing delivery.
 *
 * The worker never selects workflow retry behavior directly. The server persists one of these
 * states, emits a small wake-up signal in the same database transaction, and the controller reloads
 * this persisted outcome before it deletes the exact Kubernetes Job.
 */
export enum ArtifactPreprocessOutcomeKinds
{
	/** The converted text and its immutable completion digest were committed. */
	Completed = "completed",
	/** The server accepted the failure and permits another claimed delivery later. */
	RetryableFailed = "retryable_failed",
	/** The server accepted the failure and exhausted the job's delivery limit. */
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

/** Persisted successful completion returned to the controller. */
export interface ArtifactPreprocessCompletedOutcome extends ArtifactPreprocessOutcomeSignal
{
	/** Confirms that publication and completion evidence committed. */
	readonly kind: ArtifactPreprocessOutcomeKinds.Completed;
	/** Immutable digest for the saved completion evidence. */
	readonly completionDigest: string;
}

/** Persisted failed delivery returned to the controller. */
export interface ArtifactPreprocessRetryableFailedOutcome extends ArtifactPreprocessOutcomeSignal
{
	/** Confirms that the server accepted this delivery but another delivery may run later. */
	readonly kind: ArtifactPreprocessOutcomeKinds.RetryableFailed;
	/** Database-owned instant after which the controller may claim the next delivery. */
	readonly retryAt: string;
}

/** Persisted terminal failure returned to the controller. */
export interface ArtifactPreprocessTerminalFailedOutcome extends ArtifactPreprocessOutcomeSignal
{
	/** Confirms that the server stopped this preprocessing job without permitting another delivery. */
	readonly kind: ArtifactPreprocessOutcomeKinds.TerminalFailed;
}

/** Persisted outcome that authorizes UID-fenced cleanup for one delivery. */
export type ArtifactPreprocessOutcome = ArtifactPreprocessCompletedOutcome | ArtifactPreprocessRetryableFailedOutcome | ArtifactPreprocessTerminalFailedOutcome;

/** Builds the delivery-scoped event name required by Absurd's first-emission-wins event store. */
export function __ArtifactPreprocessOutcomeEventName(deliveryCount: number): string
{
	if (!Number.isSafeInteger(deliveryCount) || deliveryCount < 1)
	{
		throw new Error("Artifact preprocessing outcome requires a positive delivery count.");
	}
	return `artifact-preprocess-outcome:${deliveryCount}`;
}
