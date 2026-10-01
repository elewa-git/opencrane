/** Identifies a browser read session; object identity also fences a later return to the same user. */
export interface GovernanceReadScope
{
	/** Authenticated reader selected by app composition, or null after authentication loss. */
	readonly identity: string | null;
}

/** Coordinates one local read without sending browser generations to the server. */
export interface GovernanceReadRequest<TQuery>
{
	/** Repeated reads of the same query remain distinct. */
	readonly generation: number;
	/** Endpoint-specific read coordinates. */
	readonly query: TQuery;
}
