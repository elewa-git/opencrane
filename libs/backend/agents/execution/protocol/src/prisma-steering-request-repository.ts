import { AgentRunState, Prisma, RuntimeCommandKind } from "@prisma/client";

import { PrismaAuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { SubmitSteeringRequestCommand, SubmitSteeringRequestResult, SteeringRequestTransactionRepository } from "./steering-request.types";

/**
 * Queues steering in Postgres through the transaction supplied by its unit of work.
 *
 * The unit of work runs this adapter at Serializable isolation. Each browser idempotency key maps to
 * one server-derived row id, so concurrent inserts cannot both commit even though the table has no
 * separate digest constraint. The runtime picks queued rows up later; nothing here interrupts a
 * model call.
 *
 * Called by: `PrismaSteeringRequestUnitOfWork`, which is composed into the steering router.
 *
 * @implements SteeringRequestTransactionRepository
 * @see docs/agents/prisma.md for the repository and transaction ownership rules this file sits under.
 */
export class PrismaSteeringRequestRepository implements SteeringRequestTransactionRepository
{
	/** Transaction supplied by the steering unit of work. */
	private readonly _transaction: Prisma.TransactionClient;
	/** Central product authority bound to the steering transaction. */
	private readonly _authorization: Pick<AuthorizationAuthority, "admitPrincipal">;

	/** Construct the queue repository around one Serializable transaction. */
	constructor(transaction: Prisma.TransactionClient, authorization: Pick<AuthorizationAuthority, "admitPrincipal">)
	{
		this._transaction = transaction;
		this._authorization = authorization;
	}

	/**
	 * Queue one instruction after proving the run belongs to this caller in this silo.
	 *
	 * A submission that repeats an earlier one is answered from the earlier row instead of queueing a
	 * second instruction, which is how a browser can safely retry a request whose answer it lost.
	 * The unit of work derives one row id from the owner, run, and retry-key digest. Finding that id
	 * proves the key was used before, and comparing the stored content digest says whether the words
	 * also match.
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
	async submit(command: SubmitSteeringRequestCommand, steeringRequestId: string): Promise<SubmitSteeringRequestResult>
	{
		// 1. Prove ownership before anything else is disclosed. Matching run, silo, and subject in one
		// query means a caller learns nothing about a run they do not own.
		const run = await this._transaction.agentRun.findFirst({ where: { id: command.runId, siloId: command.siloId, delegatedUserId: { equals: command.subjectId } }, select: { agentServiceId: true, attempt: true, state: true } });
		if (run === null)
			return { outcome: "not_found_or_not_owner" };
		// 2. Answer a repeat before judging whether the run can still be steered. The derived id is not
		// tied to an attempt, so a lost HTTP response stays replayable after the run moves on.
		const prior = await this.readWinner(command, steeringRequestId);
		if (prior !== null)
			return prior;
		// 3. Only a run that is assigned, running, or waiting on input can still accept an instruction.
		if (run.state !== AgentRunState.Assigned && run.state !== AgentRunState.Running && run.state !== AgentRunState.WaitingForInput)
			return { outcome: "run_not_steerable" };
		// 4. Refuse once this attempt's resume command exists. A resume carries the steering rows that
		// were pending when it was built and marks them Consumed as it is dispatched (see
		// `prisma-runtime-dispatch-authority.ts`), so an instruction inserted after it would sit
		// unread. `refuses steering after the attempt's sole resume command is already minted` in
		// `__tests__/prisma-steering-request-repository.test.ts` covers this.
		const priorResume = await this._transaction.runtimeDispatchedCommand.findFirst({ where: { runId: command.runId, attempt: run.attempt, kind: RuntimeCommandKind.ResumeAttempt }, select: { id: true } });
		if (priorResume !== null)
			return { outcome: "run_not_steerable" };
		// 5. Recheck the exact AgentService invocation grant before adding a new runtime effect.
		const argumentsValue = { runId: command.runId, attempt: run.attempt, steeringRequestId, digest: command.digest };
		const admission = await this._authorization.admitPrincipal({ siloId: command.siloId, principalId: command.principalId, actorKind: "user", actorId: command.principalId, resource: { kind: ProductAuthorizationResourceKinds.AgentService, id: run.agentServiceId }, action: ProductAuthorizationActions.Invoke, argumentsDigest: ___DigestCanonicalJson(argumentsValue as JsonValue), nowEpochMs: command.submittedAt.getTime() });
		if (admission.outcome !== AuthorizationDecisionOutcomes.Allow)
		{
			return { outcome: "not_found_or_not_owner" };
		}

		// 6. Store against the attempt read in this transaction. The derived primary key makes a second
		// writer fail with P2002, which the unit of work resolves after rollback.
		const content = command.content === null ? Prisma.JsonNull : command.content as Prisma.InputJsonValue;
		const created = await this._transaction.runtimeSteeringRequest.create({ data: { id: steeringRequestId, runId: command.runId, attempt: run.attempt, siloId: command.siloId, subjectId: command.subjectId, content, digest: command.digest, submittedAt: command.submittedAt } });
		return { outcome: "queued", steeringRequestId: created.id, attempt: run.attempt };
	}

	/**
	 * Reads the row for this server-derived request id and verifies it belongs to the same request.
	 * @param command - Original request whose owner, run, and content digest must match.
	 * @param steeringRequestId - Primary key derived by the steering unit of work.
	 * @returns `idempotent` for the same request, `idempotency_conflict` for a mismatched row, or null
	 * when no transaction has committed this id.
	 */
	async readWinner(command: SubmitSteeringRequestCommand, steeringRequestId: string): Promise<SubmitSteeringRequestResult | null>
	{
		const prior = await this._transaction.runtimeSteeringRequest.findUnique({ where: { id: steeringRequestId }, select: { id: true, runId: true, siloId: true, subjectId: true, attempt: true, digest: true } });
		if (prior === null)
			return null;
		if (prior.runId !== command.runId || prior.siloId !== command.siloId || prior.subjectId !== command.subjectId)
			return { outcome: "idempotency_conflict" };
		return prior.digest === command.digest
			? { outcome: "idempotent", steeringRequestId: prior.id, attempt: prior.attempt }
			: { outcome: "idempotency_conflict" };
	}
}
