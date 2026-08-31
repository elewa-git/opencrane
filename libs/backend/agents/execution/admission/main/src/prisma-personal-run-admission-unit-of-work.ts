import type { PrismaClient } from "@prisma/client";

import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import type { PersonalRunAdmissionCommand, PersonalRunAdmissionReadRepository, PersonalRunAdmissionUnitOfWork, PersonalRunIdempotencyResult, PersonalRunConversationAuthority } from "./personal-run-admission.types";
import { PrismaPersonalRunAdmissionRepository } from "./prisma-personal-run-admission-repository";

/**
 * Opens the serializable Prisma transaction that each personal-admission read runs in.
 *
 * One transaction per call, not one for all three: these reads happen at different points in
 * admission (two in the preflight, one only after a commit failed), so they must not be forced to
 * share a snapshot. `Serializable` here is PostgreSQL's SERIALIZABLE isolation level, requested
 * through the shared unit-of-work envelope: the idempotency check decides whether a run is created,
 * and under a weaker level two concurrent requests could both read "not found" and both create one.
 * Callers must therefore expect a serialization failure and retry rather than treat it as fatal.
 *
 * Constructed by: `__CreatePersonalRunAdmissionPort` (personal-run-admission.composition.ts).
 *
 * @implements PersonalRunAdmissionUnitOfWork
 * @see PrismaPersonalRunAdmissionRepository - does the actual reading, bound to the transaction.
 */
export class PrismaPersonalRunAdmissionUnitOfWork implements PersonalRunAdmissionUnitOfWork
{
	/** OpenCrane product database client. */
	private readonly prisma: PrismaClient;

	/** Creates the Unit of Work over the server's Prisma client. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Looks up the idempotency key in its own serializable transaction. */
	async resolve(command: PersonalRunAdmissionCommand): Promise<PersonalRunIdempotencyResult>
	{
		return this._run(async function _Resolve(repository)
		{
			return repository.resolve(command);
		});
	}

	/** Finds the personal AgentService for the caller's open conversation, in its own serializable transaction. */
	async resolveConversation(command: PersonalRunAdmissionCommand): Promise<PersonalRunConversationAuthority | null>
	{
		return this._run(async function _ResolveConversation(repository)
		{
			return repository.resolveConversation(command);
		});
	}

	/** Re-reads the conversation in a fresh transaction to see whether a run is already in progress. */
	async hasActiveConversationRun(command: PersonalRunAdmissionCommand): Promise<boolean>
	{
		return this._run(async function _HasActiveConversationRun(repository)
		{
			return repository.hasActiveConversationRun(command);
		});
	}

	/**
	 * Runs one read inside a fresh serializable transaction, building the reader for it.
	 *
	 * @param work - The read to perform, given a reader bound to the new transaction.
	 * @returns Whatever `work` returned.
	 * @throws Whatever Prisma throws, including a serialization failure under contention. Callers that
	 * must not fail on this wrap the call — see the recovery read in `personal-run-admission.ts`.
	 */
	private async _run<TResult>(work: (repository: PersonalRunAdmissionReadRepository) => Promise<TResult>): Promise<TResult>
	{
		return ___RunInPrismaUnitOfWork(this.prisma, async function _Run(transaction)
		{
			return work(new PrismaPersonalRunAdmissionRepository(transaction));
		}, { isolationLevel: "Serializable", operation: "personal run admission" });
	}
}
