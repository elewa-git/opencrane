/** Personal-memory coordinates that must still identify the execution user's active dataset. */
export interface RuntimePersonalMemoryEffectEligibilityCommand
{
	/** Silo containing the personal memory dataset. */
	readonly siloId: string;
	/** Dataset frozen into the admitted run's memory policy. */
	readonly datasetId: string;
	/** Local human Principal that owns the personal boundary. */
	readonly principalId: string;
}

/** Rechecks the personal dataset lifecycle before a runtime may recall memory. */
export interface RuntimePersonalMemoryEffectEligibility
{
	/** Returns true only while the dataset remains active on the exact personal boundary. */
	isEligible(command: RuntimePersonalMemoryEffectEligibilityCommand): Promise<boolean>;
}
