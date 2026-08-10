/** Request to mint one attempt-scoped Obot API key. */
export interface IssueObotAttemptKeyCommand
{
	/**
	 * Obot MCP server ids (custody references) the key is scoped to.
	 *
	 * One run attempt may hold several integration assignments, and the runtime receives exactly ONE
	 * attempt key, so the key must name every assigned server id. Obot enforces that the key can reach
	 * no other MCP server.
	 */
	readonly obotCustodyReferences: readonly string[];
	/** Attempt-unique key name recorded by Obot for audit correlation; never a secret. */
	readonly name: string;
	/** Hard key expiry bounded to the attempt assignment lease. */
	readonly expiresAt: Date;
}

/** One minted attempt-scoped Obot key; the key value is transient and never persisted. */
export interface IssuedObotAttemptKey
{
	/** Bearer key value the runtime presents to the Obot MCP proxy; transient, never stored or logged. */
	readonly key: string;
	/** Obot-minted key identifier used only for revocation; not a credential. */
	readonly keyId: string;
}

/**
 * Runtime-neutral boundary for minting and revoking attempt-scoped Obot API keys.
 *
 * The issued key is the ONLY Obot credential a runtime workload ever holds: it is scoped to the
 * exact MCP server ids of the attempt's integration assignments and expires with the assignment
 * lease. The Obot service credential used to mint it never leaves the server process.
 */
export interface ObotAttemptKeyIssuer
{
	/** Mints one server-scoped, expiring API key for a claimed run attempt. */
	issueAttemptKey(command: IssueObotAttemptKeyCommand): Promise<IssuedObotAttemptKey>;
	/** Revokes one previously minted attempt key; an already-absent key counts as revoked. */
	revokeAttemptKey(keyId: string): Promise<void>;
}
