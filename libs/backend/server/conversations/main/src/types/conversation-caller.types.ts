/** Authenticated participant coordinates supplied by the public server composition. */
export interface ConversationCaller
{
	/** Stable local principal used by product authorization. */
	readonly principalId: string;
	/** Stable identity-provider subject used by conversation participation. */
	readonly subjectId: string;
	/** Silo selected by the authenticated browser session. */
	readonly siloId: string;
}
