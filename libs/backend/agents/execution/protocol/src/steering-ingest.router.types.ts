import type { Request } from "express";

import type { Logger } from "@opencrane/backend/observability";

import type { SteeringRequestRepository } from "./steering-request.types";

/**
 * Who is steering, as the server worked it out from the browser session.
 *
 * Neither field can be sent by the client. Both are used as filters on the run row in the write
 * transaction, so a caller who is signed in but does not own the named run gets the same 404 as one
 * naming a run that does not exist.
 *
 * Produced by: `SteeringIngestRouterDependencies.resolveCaller`, which the composition in
 * prisma-steering-ingest.router.ts wires to the session layer.
 */
export interface SteeringIngestCaller
{
	/** Silo resolved from the authenticated request host. */
	readonly siloId: string;
	/** Durable local Principal used by central product authorization. */
	readonly principalId: string;
	/** The caller's identity-provider subject. They may steer only their own run. */
	readonly subjectId: string;
}

/**
 * The two fields a steering request body may contain, after the router has checked it.
 *
 * The body is rejected unless it has exactly these two keys, so a client cannot add an `attempt`,
 * a `siloId`, or anything else the server is supposed to decide for itself — pinned by "rejects a
 * body that tries to add caller-controlled runtime coordinates" in
 * `__tests__/steering-ingest.router.test.ts`. Holding one of these means the shape and the length
 * limits passed; it says nothing about whether the run exists or is steerable.
 *
 * Produced by: `_body` in steering-ingest.router.ts, which returns null instead of throwing so the
 * route can answer 400.
 */
export interface SteeringIngestRequestBody
{
	/**
	 * The instruction itself, trimmed, non-empty, and at most `_MAX_STEERING_CHARACTERS` (4,000)
	 * characters. It is the only value in the whole request that came from the caller, and the
	 * runtime applies it at its next safe boundary rather than interrupting a model call.
	 */
	readonly text: string;
	/**
	 * The caller's own retry key, trimmed, non-empty, and at most 128 characters. Re-sending the
	 * same key with the same text replays the earlier submission instead of queueing a second one;
	 * the same key with different text is a conflict. The router hashes it and never passes the key
	 * itself further in.
	 */
	readonly idempotencyKey: string;
}

/**
 * Supplies the time a steering row is stamped with.
 *
 * It is a port rather than a direct `new Date()` so route tests can assert an exact `submittedAt`
 * instead of matching on whatever the clock happened to say.
 */
export interface SteeringIngestClock
{
	/** Return the server's current trusted instant. */
	now(): Date;
}

/**
 * Everything `__CreateSteeringIngestRouter` needs, so the route itself holds no database or session
 * knowledge.
 *
 * Implemented by: `_CreateSteeringIngestRouter` in prisma-steering-ingest.router.ts, which binds
 * the real session resolver, `PrismaSteeringRequestUnitOfWork`, the production clock, and the
 * server logger. Route tests pass fakes for all four.
 *
 * @see SteeringRequestRepository — where ownership is actually proved, and which outcome maps to
 * which status code.
 */
export interface SteeringIngestRouterDependencies
{
	/** Resolve browser session identity and host silo, or null when unauthenticated — which the route answers 401 for, revealing nothing about the run. */
	resolveCaller(request: Request): SteeringIngestCaller | null;
	/** Queue steering only after proving the current run belongs to that caller. */
	readonly requests: SteeringRequestRepository;
	/** Supply a trusted persistence instant. */
	readonly clock: SteeringIngestClock;
	/** Record unexpected failures without logging the owner's instruction text. */
	readonly logger: Logger;
}
