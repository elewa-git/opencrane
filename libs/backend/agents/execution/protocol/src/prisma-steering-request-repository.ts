import { AgentRunState, Prisma, RuntimeCommandKind, type PrismaClient } from "@prisma/client";

import type { SubmitSteeringRequestCommand, SubmitSteeringRequestResult, SteeringRequestRepository } from "./steering-request.types.js";

/**
 * Queues steering in Postgres for the run's owner, checking ownership in the same transaction.
 *
 * It takes the advisory lock and then the run row lock - the same order every other writer of a run
 * uses, so no two writers can deadlock - and only then confirms the run is owned by this subject in
 * this silo and is still steerable. The runtime picks queued rows up later, at a safe boundary;
 * nothing here interrupts a model call.
 *
 * This class owns its transaction rather than joining one. `submitAtomically` opens `$transaction`
 * on the root Prisma client it was constructed with, so a caller cannot hand in a transaction and
 * cannot make this write part of a larger unit of work. Every check and the insert therefore commit
 * or roll back together, and by the time the method returns the row is durable. Sibling run writers
 * order their locks the same way - see `prisma-runtime-terminal-reporter.ts`, which takes the same
 * run-keyed advisory lock and then `SELECT ... FOR UPDATE` on `agent_runs`.
 *
 * That lock is doing more work than it looks. `RuntimeSteeringRequest` has no unique index on
 * `digest` (see `apps/opencrane/prisma/schema/runtime.prisma`), so nothing in the database would
 * stop two concurrent retries of the same key both passing the duplicate check and both inserting.
 * Serialising every submitter for a run behind the advisory lock is what makes the check reliable.
 *
 * Called by: `_CreateSteeringIngestRouter` (prisma-steering-ingest.router.ts), which
 * apps/opencrane/src/app/routes.ts mounts at /api/v1/me/runs.
 *
 * @implements SteeringRequestRepository
 * @see docs/agents/prisma.md for the repository and transaction ownership rules this file sits under.
 */
export class PrismaSteeringRequestRepository implements SteeringRequestRepository
{
	/**
	 * Client for the main OpenCrane database.
	 *
	 * It is the root client, not a transaction client, because this repository starts its own
	 * transaction on every submission.
	 */
	private readonly _prisma: PrismaClient;

	/** Construct the queue repository around the server-owned Prisma client. */
	constructor(prisma: PrismaClient)
	{
		this._prisma = prisma;
	}

	/**
	 * Queue one instruction after proving the run belongs to this caller in this silo.
	 *
	 * A submission that repeats an earlier one is answered from the earlier row instead of queueing a
	 * second instruction, which is how a browser can safely retry a request whose answer it lost.
	 * "Repeats" means the same retry key and the same words: the stored digest is the key's hash, a
	 * colon, then the instruction's hash, so a prefix match finds any earlier use of the key and
	 * comparing the whole digest says whether the words also match.
	 *
	 * @param command - Run, silo, subject, instruction, digest, and submission time.
	 * @returns `queued` with the new row's id and the attempt it belongs to.
	 * `idempotent` with the earlier row's id and *that row's* attempt, which may be older than the
	 * run's current attempt - a caller must not read it as the attempt now running.
	 * `idempotency_conflict` when this key was already used for different words; the caller has a bug
	 * or reused a key, and retrying will not help until the key changes.
	 * `not_found_or_not_owner` when no run matches all three of id, silo, and owner - the two cases are
	 * deliberately not distinguished. `run_not_steerable` when the run is in a state that cannot take
	 * steering, or a resume command has already been sent for this attempt.
	 */
	async submitAtomically(command: SubmitSteeringRequestCommand): Promise<SubmitSteeringRequestResult>
	{
		return this._prisma.$transaction(async function _submit(transaction): Promise<SubmitSteeringRequestResult>
		{
			// 1. Serialise every writer of this run before reading anything, so the checks below cannot be
			// invalidated by a concurrent submission or a state change while they run. The advisory lock
			// comes before the row lock because every sibling run writer takes them in that order, and a
			// writer that took them the other way round could deadlock against one of them.
			await transaction.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${command.runId}, 0))`);
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_runs" WHERE "id" = ${command.runId} FOR UPDATE`);
			// 2. Prove ownership before anything else is disclosed. Matching on all three of run, silo,
			// and subject in one query means a caller learns nothing about a run they do not own.
				const run = await transaction.agentRun.findFirst({ where: { id: command.runId, siloId: command.siloId, delegatedUserId: command.subjectId }, select: { attempt: true, state: true } });
				if (run === null) return { outcome: "not_found_or_not_owner" };
				// 3. Answer a repeat before judging whether the run can still be steered. The lookup is
				// scoped to this run and this owner but deliberately not to an attempt, so a key stays
				// honoured after the run moves on: a browser retrying a lost answer gets the same row back
				// rather than a refusal for a run that has since stopped accepting steering.
				const prior = await transaction.runtimeSteeringRequest.findFirst({ where: { runId: command.runId, siloId: command.siloId, subjectId: command.subjectId, digest: { startsWith: `${command.idempotencyDigest}:` } }, select: { id: true, attempt: true, digest: true } });
				if (prior?.digest === command.digest) return { outcome: "idempotent", steeringRequestId: prior.id, attempt: prior.attempt };
				// The key was used before but the text hash differs, so this is a different instruction
				// wearing an old key. Refusing keeps a retry from silently becoming a second instruction.
				if (prior !== null) return { outcome: "idempotency_conflict" };
				// 4. Only a run that is assigned, running, or waiting on input can still fold an
				// instruction in; anything else has no live attempt to steer.
				if (run.state !== AgentRunState.Assigned && run.state !== AgentRunState.Running && run.state !== AgentRunState.WaitingForInput) return { outcome: "run_not_steerable" };
			// 5. Refuse once this attempt's resume command exists. A resume carries the steering rows that
			// were pending when it was built and marks them Consumed as it is dispatched (see
			// `prisma-runtime-dispatch-authority.ts`), so an instruction inserted after it would sit
			// unread. `refuses steering after the attempt's sole resume command is already minted` in
			// `__tests__/prisma-steering-request-repository.test.ts` covers this.
			const priorResume = await transaction.runtimeDispatchedCommand.findFirst({ where: { runId: command.runId, attempt: run.attempt, kind: RuntimeCommandKind.ResumeAttempt }, select: { id: true } });
			if (priorResume !== null) return { outcome: "run_not_steerable" };
			// 6. Store the instruction against the attempt read under the lock, never an attempt the
			// caller named. `content` is a non-nullable Json column, so a null instruction has to be
			// written as `Prisma.JsonNull` - a plain null would be read as "leave this field alone".
			const content = command.content === null ? Prisma.JsonNull : command.content as Prisma.InputJsonValue;
			const created = await transaction.runtimeSteeringRequest.create({ data: { runId: command.runId, attempt: run.attempt, siloId: command.siloId, subjectId: command.subjectId, content, digest: command.digest, submittedAt: command.submittedAt } });
			return { outcome: "queued", steeringRequestId: created.id, attempt: run.attempt };
		});
	}
}
