import type { JsonValue } from "@opencrane/util";

/** A claimed cleanup event to hand back so cancellation can be settled on a later attempt. */
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
	/** Releases the claim under its current generation, marking it neither published nor failed. */
	defer(command: RunCancellationEventDeferralCommand): Promise<boolean>;
}

/** Builds the deferral repository on the caller's transaction. */
export interface RunCancellationEventDeferralUnitOfWork extends RunCancellationEventDeferralRepository {}
