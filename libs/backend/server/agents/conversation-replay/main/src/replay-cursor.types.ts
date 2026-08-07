/** Immutable canonical tuple used to resume one authorised thread replay. */
export interface ConversationReplayCursor
{
	/** Run acceptance time in ISO-8601 UTC form. */
	readonly acceptedAt: string;
	/** Canonical run identifier. */
	readonly runId: string;
	/** One-based event sequence within the run. */
	readonly sequence: number;
}
