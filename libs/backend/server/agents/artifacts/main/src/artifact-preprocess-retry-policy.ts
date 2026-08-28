import type { ArtifactPreprocessFailureTransition } from "./artifact-preprocess-retry-policy.types";

/** Total deliveries allowed before artifact preprocessing becomes terminal. */
const _MAX_DELIVERIES = 3;

/** Base delay shared with source-lease expiry and multiplied before another delivery may run. */
export const _ARTIFACT_PREPROCESS_RETRY_DELAY_MILLISECONDS = 30_000;

/**
 * Selects one bounded failure transition from the delivery number and database clock.
 *
 * Called by: worker-reported failure persistence and controller-observed Job recovery. Keeping the
 * calculation here prevents those paths from drifting into different retry policies.
 *
 * @param deliveryCount - Positive current delivery saved in the preprocessing row.
 * @param now - Database-owned time from the surrounding serializable transaction.
 * @returns Retryable or terminal state and its matching next-attempt instant.
 */
export function _ArtifactPreprocessFailureTransition(deliveryCount: number, now: Date): ArtifactPreprocessFailureTransition
{
	if (!Number.isSafeInteger(deliveryCount) || deliveryCount < 1 || !(now instanceof Date) || Number.isNaN(now.getTime()))
	{
		throw new Error("Artifact preprocessing failure policy requires a positive delivery and database time.");
	}
	const terminal = deliveryCount >= _MAX_DELIVERIES;
	return {
		terminal,
		nextAttemptAt: terminal ? null : new Date(now.getTime() + _ARTIFACT_PREPROCESS_RETRY_DELAY_MILLISECONDS * deliveryCount),
	};
}
