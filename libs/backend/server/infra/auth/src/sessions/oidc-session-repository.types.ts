/** Identifies a browser session without persisting its cookie identifier. */
export interface OidcSessionCoordinates
{
	/** Selects the trusted deployment configuration that issued the session. */
	readonly namespace: string;
	/** Contains the SHA-256 digest of the cookie session identifier. */
	readonly idDigest: string;
	/** Records the server clock for this operation. */
	readonly now: Date;
	/** Records the immutable identifier deadline; cleanup adds the supported clock-skew allowance. */
	readonly retainUntil: Date;
}

/** Holds encrypted session data read from the database. */
export interface StoredOidcSession
{
	/** Contains the versioned authenticated-encryption envelope, never plaintext tokens. */
	readonly payload: string;
	/** Prevents a request from overwriting a later save or logout. */
	readonly revision: number;
	/** Bounds this session by login-flow or verified identity expiry. */
	readonly validUntil: Date;
}

/** Saves a new session or updates the revision that this request actually read. */
export interface SaveOidcSession extends OidcSessionCoordinates
{
	/** Contains the encrypted session envelope. */
	readonly payload: string;
	/** Bounds authentication independently of the browser cookie's rolling expiry. */
	readonly validUntil: Date;
	/** Is null for a new identifier; an existing session must match its loaded revision. */
	readonly expectedRevision: number | null;
}

/**
 * Persists browser sessions and logout markers within the existing product database.
 * Every save checks expiry and the expected revision. A failed save never revives a session.
 */
export interface OidcSessionRepository
{
	/** Loads an unexpired session; missing, logged-out and expired sessions return null. */
	read(command: OidcSessionCoordinates): Promise<StoredOidcSession | null>;
	/** Commits the encrypted session and returns its new revision, or throws on a conflict. */
	save(command: SaveOidcSession): Promise<number>;
	/** Removes session content and retains a marker against delayed first saves. */
	destroy(command: OidcSessionCoordinates): Promise<void>;
	/** Removes at most one bounded batch after identifier expiry and the clock-skew allowance. */
	prune(namespace: string, now: Date): Promise<number>;
}
