/**
 * Request to mint one attempt-scoped model key at claim time.
 *
 * Built from the immutable snapshot's model route and budget policy plus the silo. The concrete
 * issuer lives in the app layer (the model-routing gateway holds the LiteLLM master key); this
 * library never imports it, so the runtime and its dispatch authority stay outbound-only.
 */
export interface AttemptModelKeyMintRequest
{
	/** Attempt-stable key alias satisfying the issuer's `attempt-<...>` grammar. */
	readonly keyAlias: string;
	/** Single model alias the minted key may call, taken from the snapshot's model route. */
	readonly modelAlias: string;
	/** Silo whose per-silo model proxy issues the key. */
	readonly siloId: string;
	/** Hard aggregate spend ceiling in US dollars, derived from the snapshot's budget policy. */
	readonly maxBudgetUsd: number;
	/** Key lifetime in seconds, bounded to the attempt assignment lifetime. */
	readonly expirySeconds: number;
}

/** Carries one unused raw key only to the model-routing revocation operation. */
export interface AttemptModelKeyRevocation
{
	/** Names the key for safe tracing and auditing. */
	readonly keyAlias: string;
	/** Carries the transient raw key that the server must revoke without logging or persisting it. */
	readonly key: string;
}

/** A minted attempt-scoped model key. Carries only the transient key value — never persisted. */
export interface MintedAttemptModelKey
{
	/** The short-lived virtual key the runtime presents to the model proxy; transient, never stored. */
	readonly key: string;
}

/**
 * Injected minting port bound by the app to the model-routing gateway.
 *
 * Keeping this a port means `scope:execution-runs` never depends on `scope:model-routing`: the master
 * key stays in the server process that already holds it, and the minted virtual key only rides the
 * claim response.
 */
export interface AttemptModelKeyIssuer
{
	/** Mints one scoped transient key after the task's database transaction has committed. */
	(request: AttemptModelKeyMintRequest): Promise<MintedAttemptModelKey>;
	/** Revokes one unused minted key without recording its raw value. */
	revokeAttemptKey?(request: AttemptModelKeyRevocation): Promise<void>;
}

/** Requires an issuer to support both minting and immediate unused-key revocation. */
export type AttemptModelKeyIssuerWithRevocation = AttemptModelKeyIssuer & Required<Pick<AttemptModelKeyIssuer, "revokeAttemptKey">>;
