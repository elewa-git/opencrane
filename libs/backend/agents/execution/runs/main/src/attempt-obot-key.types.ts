/**
 * Request to mint one attempt-scoped Obot key at claim time.
 *
 * Built from the immutable snapshot's integration assignments plus the claim coordinates. The
 * concrete issuer lives in the app layer (which resolves each assignment's custody reference and
 * holds the Obot service credential); this library never imports it, so the runtime and its
 * dispatch authority stay outbound-only.
 */
export interface AttemptObotKeyMintRequest
{
	/** Logical run whose attempt receives the key. */
	readonly runId: string;
	/** Positive attempt number the key is bound to. */
	readonly attempt: number;
	/** Silo owning the run and every named integration. */
	readonly siloId: string;
	/** Immutable AgentRevision whose integration assignments scope the key. */
	readonly agentRevisionId: string;
	/** Integrations frozen into the snapshot; the issuer resolves each to its custody reference. */
	readonly integrationIds: readonly string[];
	/** Attempt- and delivery-unique key name recorded by Obot for audit correlation. */
	readonly keyName: string;
	/** Hard key expiry bounded to the attempt assignment lifetime. */
	readonly expiresAt: Date;
}

/** A minted attempt-scoped Obot key. Carries only transient values — never persisted. */
export interface MintedAttemptObotKey
{
	/** The short-lived Obot bearer key the runtime presents to the MCP proxy; transient, never stored. */
	readonly key: string;
	/** Obot-minted key identifier stored beside the key for later revocation; not a credential. */
	readonly keyId: string;
}

/**
 * Injected minting port bound by the app to the Obot attempt-key issuer.
 *
 * Keeping this a port means `scope:execution-runs` never depends on the Obot transport: the Obot
 * service credential stays in the server process, and the minted attempt key only rides the claim
 * response into the controller's per-attempt Secret.
 */
export type AttemptObotKeyIssuer = (request: AttemptObotKeyMintRequest) => Promise<MintedAttemptObotKey>;
