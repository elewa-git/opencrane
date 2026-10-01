/** The transport fields needed to interpret a generated-client GET result. */
export interface GovernanceReadResponse
{
	/** Untrusted successful body, validated by the state package before it reaches a caller. */
	readonly data?: unknown;
	/** HTTP status remains available even when middleware returns an untyped error body. */
	readonly response: Pick<Response, "status">;
}
