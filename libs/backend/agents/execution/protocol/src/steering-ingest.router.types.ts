import type { Request } from "express";

import type { Logger } from "@opencrane/backend/observability";

import type { SteeringRequestRepository } from "./steering-request.types.js";

/** The signed-in caller. The server works this out; it never comes from the request body. */
export interface SteeringIngestCaller
{
	/** Silo resolved from the authenticated request host. */
	readonly siloId: string;
	/** The caller's identity-provider subject. They may steer only their own run. */
	readonly subjectId: string;
}

/** Trusted clock injected so steering ingest is deterministic in route tests. */
export interface SteeringIngestClock
{
	/** Return the server's current trusted instant. */
	now(): Date;
}

/** Ports the steering router needs. Only a run's owner may steer it. */
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
