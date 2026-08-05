import { Prisma, type PrismaClient } from "@prisma/client";

import type { PersonalRunAdmissionCommand, PersonalRunAdmissionReadRepository, PersonalRunAdmissionUnitOfWork, PersonalRunIdempotencyResult, PersonalRunThreadAuthority } from "./personal-run-admission.types.js";
import { PrismaPersonalRunAdmissionRepository } from "./prisma-personal-run-admission-repository.js";

/** Prisma transaction owner for durable duplicate and participant-thread authority reads. */
export class PrismaPersonalRunAdmissionUnitOfWork implements PersonalRunAdmissionUnitOfWork
{
	/** OpenCrane product database client. */
	private readonly prisma: PrismaClient;

	/** Creates the authority over the server's app-owned Prisma client. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Returns a durable duplicate outcome from one serializable authority snapshot. */
	async resolve(command: PersonalRunAdmissionCommand): Promise<PersonalRunIdempotencyResult>
	{
		return this._run(async function _Resolve(repository)
		{
			return repository.resolve(command);
		});
	}

	/** Resolves one active participant-bound personal service from one serializable authority snapshot. */
	async resolveThread(command: PersonalRunAdmissionCommand): Promise<PersonalRunThreadAuthority | null>
	{
		return this._run(async function _ResolveThread(repository)
		{
			return repository.resolveThread(command);
		});
	}

	/** Construct the transaction-scoped read adapter once for any admission authority operation. */
	private async _run<TResult>(work: (repository: PersonalRunAdmissionReadRepository) => Promise<TResult>): Promise<TResult>
	{
		return this.prisma.$transaction(async function _Run(transaction)
		{
			return work(new PrismaPersonalRunAdmissionRepository(transaction));
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}
