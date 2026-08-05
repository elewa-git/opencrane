import type { Request } from "express";

import type { Logger } from "@opencrane/backend/observability";

import type { SteeringRequestRepository } from "./steering-request.types.js";

/** Authenticated browser caller resolved by the composing server rather than request input. */
export interface SteeringIngestCaller
{
	/** Silo resolved from the authenticated request host. */
	readonly siloId: string;
	/** Stable identity-provider subject allowed to steer only their own run. */
	readonly subjectId: string;
}

/** Trusted clock injected so steering ingest is deterministic in route tests. */
export interface SteeringIngestClock
{
	/** Return the server's current trusted instant. */
	now(): Date;
}

/** Composition ports for the owner-only steering ingest API. */
export interface SteeringIngestRouterDependencies
{
	/** Resolve browser session identity and host silo, or null when unauthenticated. */
	resolveCaller(request: Request): SteeringIngestCaller | null;
	/** Queue steering only after proving the current run belongs to that caller. */
	readonly requests: SteeringRequestRepository;
	/** Supply a trusted persistence instant. */
	readonly clock: SteeringIngestClock;
	/** Record unexpected failures without logging the owner's instruction text. */
	readonly logger: Logger;
}
