import type { JsonValue } from "@opencrane/util";

/** Exact claimed cleanup event to release for a later cancellation-settlement attempt. */
export interface RunCancellationEventDeferralCommand
{
	/** Durable cleanup event identity. */
	readonly eventId: string;
	/** Exact current claim instant. */
	readonly claimedAt: Date;
	/** Exact current claim delivery generation. */
	readonly deliveryCount: number;
	/** Next instant at which the cleanup worker may retry. */
	readonly availableAt: Date;
	/** Replacement payload when deferral also records physical observation evidence. */
	readonly payload?: JsonValue;
}

/** Transaction-bound repository for releasing one exact cleanup claim. */
export interface RunCancellationEventDeferralRepository
{
	/** Release the exact claim generation without publishing or failing it. */
	defer(command: RunCancellationEventDeferralCommand): Promise<boolean>;
}

/** Transaction unit that constructs the cleanup-event deferral repository. */
export interface RunCancellationEventDeferralUnitOfWork extends RunCancellationEventDeferralRepository {}
