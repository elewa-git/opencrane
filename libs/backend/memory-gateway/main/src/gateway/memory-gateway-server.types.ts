import type { Server } from "node:http";

import type { CogneeProviderSession } from "../provider/auth/cognee-provider-session.types";

/** Minimal logger used by the private gateway without tying transport code to one app logger. */
export interface MemoryGatewayRequestLogger
{
	/** Record one content-free request failure. */
	error(fields: { readonly err: Error; readonly path: string }, message: string): void;
}

/** TokenReview result needed to establish the fixed OpenCrane server workload identity. */
export interface MemoryGatewayTokenReviewer
{
	/** Return a verified identity for an admitted token, or null when it is not the expected caller. */
	__Review(token: string): Promise<unknown | null>;
}

/** Dependencies that bind one private gateway listener to its authenticated provider session. */
export interface MemoryGatewayServerOptions
{
	/** Reviews the server's projected token before request bytes are read. */
	readonly tokenReviewer: MemoryGatewayTokenReviewer;
	/** Owns the sole Cognee login and every bounded provider exchange. */
	readonly providerSession: CogneeProviderSession;
	/** Receives content-free failure details for app-owned observability. */
	readonly log: MemoryGatewayRequestLogger;
}

/** Private HTTP server returned to the memory-gateway process bootstrap. */
export type MemoryGatewayServer = Server;
