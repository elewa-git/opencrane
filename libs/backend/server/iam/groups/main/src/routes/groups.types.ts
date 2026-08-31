import type { Request } from "express";

/** Trusted group route caller resolved from the authenticated session and request host. */
export interface GroupRouteCaller
{
	/** Silo derived from the trusted request host. */
	siloId: string;
	/** Durable local Principal admitted by authentication middleware. */
	principalId: string;
}

/** Resolves the silo boundary for one authenticated group request. */
export type GroupRouteCallerResolver = (request: Request) => GroupRouteCaller | null;
