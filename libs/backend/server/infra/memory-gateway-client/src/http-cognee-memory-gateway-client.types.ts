import type { MemoryMutationDeliveryStates } from "@opencrane/contracts";

/** Why one private gateway exchange failed, without a body, URL, token, or original cause. */
export type MemoryGatewayTransportFailureCode = "token_unavailable" | "timeout" | "aborted" | "network" | "response_too_large";

/** Fetch-compatible request function injected by focused tests. */
export type CogneeFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Classifies whether one stable gateway route can mutate provider state. */
export enum MemoryGatewayRequestKinds
{
	/** A read failure carries no delivery state. */
	Read = "read",
	/** A mutation failure proves no dispatch or records ambiguity. */
	Mutation = "mutation",
}

/** One validated private gateway request issued by the public client. */
export interface MemoryGatewayHttpCommand
{
	/** Stable path beneath the configured gateway origin. */
	readonly path: string;
	/** HTTP method fixed by the selected gateway operation. */
	readonly method: "POST" | "DELETE";
	/** Read or mutation classification used to attach delivery evidence. */
	readonly kind: MemoryGatewayRequestKinds;
	/** Strict shared DTO for JSON requests; DELETE carries no duplicate body coordinates. */
	readonly body?: unknown;
}

/** Parsed successful JSON returned only after transport status and byte checks pass. */
export interface MemoryGatewayHttpResponse
{
	/** Untrusted parsed body that the public client must validate with its shared response schema. */
	readonly body: unknown;
}

/** Authenticated transport for one stable memory-gateway exchange at a time. */
export interface CogneeSession
{
	/**
	 * Sends one request, rereading the projected token and consuming one bounded JSON response.
	 *
	 * @param command - Fixed route, method, mutation class, and validated request body.
	 * @returns Parsed but untrusted JSON for the operation-specific shared validator.
	 * @throws MemoryGatewayReadFailure When a read receives a valid gateway refusal.
	 * @throws MemoryGatewayMutationFailure When a mutation receives a refusal with delivery evidence.
	 * @throws MemoryGatewayTransportError When the exchange cannot complete.
	 * @throws MemoryGatewayProtocolError When status, media type, or JSON violates the wire contract.
	 */
	send(command: MemoryGatewayHttpCommand): Promise<MemoryGatewayHttpResponse>;
}

/** Configuration for the authenticated private memory-gateway adapter. */
export interface CogneeMemoryGatewayHttpOptions
{
	/** In-cluster memory-gateway origin with no path, query, or credentials. */
	readonly baseUrl: string;
	/** Hard timeout independently applied through response-body consumption. */
	readonly requestTimeoutMilliseconds: number;
	/** Absolute path to the rotating projected token accepted by the memory gateway. */
	readonly serverTokenFile: string;
	/** Optional fetch seam used by focused tests. */
	readonly fetch?: CogneeFetch;
	/** Optional projected-token reader seam used by focused tests. */
	readonly readServerToken?: () => Promise<string>;
}

/** Delivery evidence carried only by failures from mutation routes. */
export type MemoryGatewayFailureDelivery = MemoryMutationDeliveryStates | undefined;
