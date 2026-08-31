import type { JsonValue } from "@opencrane/util";

/**
 * One instruction to queue for whichever attempt the run is on now.
 *
 * Only `content` comes from the caller's body. The run id comes from the path, and the silo,
 * subject, both digests, and the time are all worked out by the server, so a client cannot aim an
 * instruction at another person's run or backdate one. The attempt is not in here at all: the
 * repository reads it inside the write transaction, because the run can move to a new attempt while
 * the request is in flight.
 *
 * Built by: `__CreateSteeringIngestRouter` (steering-ingest.router.ts) on
 * `POST /api/v1/me/runs/:runId/steering`.
 */
export interface SubmitSteeringRequestCommand
{
	/** Run named in the request path. */
	readonly runId: string;
	/** Silo resolved from the authenticated request host. */
	readonly siloId: string;
	/** Durable local Principal resolved from the authenticated session. */
	readonly principalId: string;
	/** Stable authenticated subject that must own the run. */
	readonly subjectId: string;
	/** Bounded JSON instruction accepted from the owner. */
	readonly content: JsonValue;
	/**
	 * `${idempotencyDigest}:${sha256 of the content}` — what gets stored on the row.
	 *
	 * The unit of work derives the row id from `idempotencyDigest`, then compares this full digest with
	 * the stored value. An equal value is an honest retry; a different value means the key was reused
	 * for different text. The client's key is never stored.
	 */
	readonly digest: string;
	/**
	 * Hash of the client's `idempotencyKey`, used in the server-derived row id and as the prefix of
	 * {@link SubmitSteeringRequestCommand.digest}. Hashing keeps the browser-chosen key out of the
	 * database.
	 */
	readonly idempotencyDigest: string;
	/** Trusted submission instant. */
	readonly submittedAt: Date;
}

/**
 * What happened to a steering submission, and what the caller should tell the user.
 *
 * Only `queued` and `idempotent` mean an instruction is now waiting for the runtime; the other
 * three mean nothing was written. The two failure outcomes are deliberately not the same thing:
 * `run_not_steerable` admits the run exists and is the caller's, while `not_found_or_not_owner`
 * admits nothing, so the endpoint cannot be used to find out whether somebody else's run exists.
 *
 * `PrismaSteeringRequestRepository` produces these inside a transaction. Its unit of work resolves
 * database conflicts, then `__CreateSteeringIngestRouter` turns the result into a status code. None
 * of the values are persisted — the row carries the digest, not the outcome — so renaming one needs
 * no migration, though it does change the HTTP contract clients see.
 */
export type SubmitSteeringRequestResult =
	/** The instruction was written and the runtime will pick it up at its next safe boundary. The router answers 202 and reports the request as `pending`. */
	| { readonly outcome: "queued"; readonly steeringRequestId: string; readonly attempt: number }
	/** This exact instruction and client key were already queued, so nothing new was written and the earlier row's id and attempt come back. Safe to treat as success: the router answers 200 with the same `pending` body as `queued`. */
	| { readonly outcome: "idempotent"; readonly steeringRequestId: string; readonly attempt: number }
	/** The client key was used before, for different text. Nothing was written, and re-sending will keep failing until the caller picks a fresh key — the router answers 409. */
	| { readonly outcome: "idempotency_conflict" }
	/** No run matches all three of id, silo, and owner. The three causes — no such run, another silo's run, somebody else's run — are not distinguished on purpose, and the router answers 404 for all of them. */
	| { readonly outcome: "not_found_or_not_owner" }
	/** The run is the caller's, but it cannot take steering: it is not in `Assigned`, `Running`, or `WaitingForInput`, or the resume command for this attempt has already been sent and the instruction can no longer be folded into it. Not permanent — a later attempt may accept steering again. The router answers 409. */
	| { readonly outcome: "run_not_steerable" };

/**
 * Saves owner-submitted steering through a transaction-owning unit of work.
 *
 * Each attempt checks ownership and steerability in the same Serializable transaction as the
 * insert, because both can change between an HTTP request arriving and the row being written. The
 * unit of work retries only a transaction that Prisma confirms was rolled back.
 *
 * Called by: `__CreateSteeringIngestRouter` (steering-ingest.router.ts) through its injected
 * `requests` port. Implemented by `PrismaSteeringRequestUnitOfWork`.
 */
export interface SteeringRequestRepository
{
	/**
	 * Queue one instruction for the signed-in owner's current attempt.
	 *
	 * @param command - The run, silo, subject, instruction, both digests, and the submission time.
	 * @returns One of the five {@link SubmitSteeringRequestResult} outcomes, each documented with the
	 * status code it produces. `queued` and `idempotent` are both successes and differ only in
	 * whether a row was written; `idempotency_conflict` needs a fresh client key; the other two are
	 * refusals, and `not_found_or_not_owner` is the one that reveals nothing.
	 * @throws When the database is unreachable, which the router turns into 503
	 * `steering_unavailable` after logging without the instruction text.
	 */
	submitAtomically(command: SubmitSteeringRequestCommand): Promise<SubmitSteeringRequestResult>;
}

/**
 * Performs steering reads and writes on a transaction opened by the unit of work.
 *
 * The request id is derived from the run, owner, and idempotency digest before this port is called.
 * That id makes concurrent inserts collide on the primary key, so the unit of work can retry a
 * rolled-back transaction and then compare the stored winner without adding another database key.
 *
 * Called by: `PrismaSteeringRequestUnitOfWork` in prisma-steering-request-unit-of-work.ts.
 * Implemented by: `PrismaSteeringRequestRepository` in prisma-steering-request-repository.ts.
 */
export interface SteeringRequestTransactionRepository
{
	/**
	 * Tries to queue the request inside the caller's transaction.
	 * @param command - Owner-bound request assembled by the HTTP authority.
	 * @param steeringRequestId - Server-derived primary key for this idempotency request.
	 * @returns The normal steering outcome when the transaction can decide without a database race.
	 * @throws A Prisma P2002 or P2034 when the transaction lost a concurrent insert or serialization
	 * race. The unit of work retries only those failures.
	 */
	submit(command: SubmitSteeringRequestCommand, steeringRequestId: string): Promise<SubmitSteeringRequestResult>;
	/**
	 * Reads the row that won after Prisma rolled the submitting transaction back.
	 * @param command - Original request whose owner and digest must still match.
	 * @param steeringRequestId - Same derived primary key used by {@link submit}.
	 * @returns `idempotent` for the same digest, `idempotency_conflict` for a different digest, or
	 * null when no committed winner exists yet.
	 */
	readWinner(command: SubmitSteeringRequestCommand, steeringRequestId: string): Promise<SubmitSteeringRequestResult | null>;
}
