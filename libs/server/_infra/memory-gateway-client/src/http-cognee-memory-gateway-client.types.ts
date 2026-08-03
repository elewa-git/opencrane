/** Bounded transport failure classes reported without any remote or fact payload. */
export type MemoryGatewayTransportFailureCode = "timeout" | "network" | "oversize" | `http_${number}`;

/** Fetch-compatible function injected into the HTTP adapter. */
export type CogneeFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** One authenticated JSON exchange against the Cognee API. */
export interface CogneeSession
{
	/** Issue one request and return its parsed JSON body, or null for an empty success. */
	request(path: string, method: string, body: unknown): Promise<unknown>;
}

/** Coordinates identifying one personal-memory delivery attempt within a silo. */
export interface PersonalMemoryDeliveryKey
{
	/** Silo that owns the personal-memory dataset. */
	readonly siloId: string;
	/** Gateway-native dataset the delivery targets. */
	readonly cogneeDatasetId: string;
	/** Authenticated subject whose personal memory receives the fact. */
	readonly subjectId: string;
	/** Stable delivery key replayable only with byte-identical content. */
	readonly idempotencyKey: string;
}

/** Durable evidence of one accepted personal-memory delivery. */
export interface PersonalMemoryDeliveryRecord
{
	/** Canonical lowercase `sha256:` content address of the accepted content. */
	readonly contentDigest: string;
	/** Fact identifier minted by the remote gateway. */
	readonly cogneeExternalId: string;
}

/**
 * Durable ledger giving the stateless Cognee API idempotent personal-memory writes.
 *
 * Cognee mints a fact id per accepted item but has no delivery-key concept, so replay safety and
 * fact-to-dataset resolution live here. The port is defined beside the transport and implemented
 * with Prisma in the composition root, keeping this infra library free of a database dependency.
 */
export interface PersonalMemoryDeliveryLedger
{
	/** Return the durable evidence recorded for a delivery key, or null when it is unused. */
	findDelivery(key: PersonalMemoryDeliveryKey): Promise<PersonalMemoryDeliveryRecord | null>;
	/** Persist evidence for a fresh delivery, reporting a concurrent writer instead of overwriting. */
	recordDelivery(key: PersonalMemoryDeliveryKey, record: PersonalMemoryDeliveryRecord): Promise<"recorded" | "conflict_existing">;
	/** Resolve which dataset holds a gateway-minted fact for a subject, or null when unknown. */
	resolveFactDataset(reference: { readonly siloId: string; readonly subjectId: string; readonly factId: string }): Promise<{ readonly cogneeDatasetId: string } | null>;
	/** Atomically replace the live remote identifier after a correction, or report a stale fact reference. */
	replaceFactReference(reference: { readonly siloId: string; readonly subjectId: string; readonly factId: string; readonly replacementFactId: string }): Promise<"replaced" | "missing">;
}

/** Configuration for the Cognee-backed memory gateway adapter. */
export interface CogneeMemoryGatewayHttpOptions
{
	/** In-cluster memory-gateway origin with no path, query, or credentials. */
	readonly baseUrl: string;
	/** Hard timeout independently applied to every HTTP exchange. */
	readonly requestTimeoutMilliseconds: number;
	/** Durable idempotency and fact-resolution ledger. */
	readonly ledger: PersonalMemoryDeliveryLedger;
	/** Absolute path to the rotating projected token accepted by the memory gateway. */
	readonly serverTokenFile: string;
	/** Optional fetch seam used by focused tests. */
	readonly fetch?: CogneeFetch;
	/** Optional projected-token reader seam used by focused tests. */
	readonly readServerToken?: () => Promise<string>;
}
