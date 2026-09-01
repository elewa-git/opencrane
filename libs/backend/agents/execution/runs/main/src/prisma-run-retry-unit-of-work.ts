import type { PrismaClient } from "@prisma/client";

import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";
import { ___IsRolledBackConflict, ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";
import { PrismaAuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";

import { PrismaAgentRunAuthorityRepository } from "./prisma-run-authority";
import { __StartNextRunAttempt } from "./run-authority";
import type { AgentRunRetryTransactionRepository, RunRetryAuthority, StartNextRunAttemptCommand, StartNextRunAttemptResult } from "./run-authority.types";
import type { RetryRunInputCompiler } from "./retry-run-input.types";
import type { RunAdmissionTransaction } from "./run-admission.types";

/** Maximum number of complete retry-authority attempts after PostgreSQL reports a safe rollback. */
const _RUN_RETRY_ATTEMPT_LIMIT = 3;

/**
 * Owns database transactions and conflict recovery for participant-requested run retries.
 *
 * This class supplies one fresh serializable transaction-bound repository for each complete retry
 * decision. It checks a durable replay, requester, run, and AgentService before compiling the
 * next snapshot, then commits that snapshot through the attempt CAS in that same transaction. A
 * rollback repeats the entire decision, so a snapshot can never be frozen from an earlier database
 * view. After three conflicts it reads the committed next-attempt workflow task.
 *
 * Called by: `PrismaConversationUnitOfWork.retryRun` through its injected `RunRetryAuthority` port.
 * @implements RunRetryAuthority
 */
export class PrismaAgentRunRetryUnitOfWork implements RunRetryAuthority
{
	/** Product database client used only to open transaction attempts. */
	private readonly _prisma: PrismaClient;
	/** Workflow task admission capability shared with each fresh transaction repository. */
	private readonly _workflow: Pick<IWorkflowEngine, "spawn">;
	/** Builds current-evidence input snapshots from inside the retry transaction attempt. */
	private readonly _retryInputCompiler: RetryRunInputCompiler;

	/** Creates the retry transaction boundary over the app-owned Prisma client. */
	constructor(prisma: PrismaClient, workflow: Pick<IWorkflowEngine, "spawn">, retryInputCompiler: RetryRunInputCompiler)
	{
		this._prisma = prisma;
		this._workflow = workflow;
		this._retryInputCompiler = retryInputCompiler;
	}

	/**
	 * Starts or replays a participant-authorized next attempt.
	 * @param command - Owner, route, observed attempt, and server acceptance time.
	 * @returns The user-facing started, idempotent, or denied result.
	 * @throws The last P2002/P2034 when no matching winner exists after three attempts, or any other
	 * database error immediately.
	 */
	async retry(command: StartNextRunAttemptCommand): Promise<StartNextRunAttemptResult>
	{
		try
		{
			return await this._Decide(command);
		}
		catch (error)
		{
			if (!___IsRolledBackConflict(error))
			{
				throw error;
			}
			const winner = await this._ReadWinner(command);
			if (winner !== null)
			{
				return winner;
			}
			throw error;
		}
	}

	/** Repeats the complete checked replay, compilation, and compare-and-swap only after rollback. */
	private async _Decide(command: StartNextRunAttemptCommand): Promise<StartNextRunAttemptResult>
	{
		for (let attempt = 1; ; attempt += 1)
		{
			try
			{
				return await this._Run(async (repository, transaction) => __StartNextRunAttempt(repository, command, this._retryInputCompiler, transaction), "Serializable", command.acceptedAt);
			}
			catch (error)
			{
				if (!___IsRolledBackConflict(error) || attempt === _RUN_RETRY_ATTEMPT_LIMIT)
				{
					throw error;
				}
			}
		}
	}

	/** Reads the committed next attempt after all transaction retries have rolled back. */
	private async _ReadWinner(command: StartNextRunAttemptCommand): Promise<StartNextRunAttemptResult | null>
	{
		return this._Run(function _Read(repository)
		{
			return repository.readRetryWinner(command);
		}, "Serializable", command.acceptedAt);
	}

	/** Runs one operation with a repository bound to a fresh transaction at the requested isolation. */
	private async _Run<Result>(work: (repository: AgentRunRetryTransactionRepository, transaction: RunAdmissionTransaction) => Promise<Result>, isolationLevel: "RepeatableRead" | "Serializable", admittedAt: string): Promise<Result>
	{
		const workflow = this._workflow;
		return ___RunInPrismaUnitOfWork(this._prisma, async function _Run(transaction): Promise<Result>
		{
			const authorization = new PrismaAuthorizationAuthority(transaction);
			return work(new PrismaAgentRunAuthorityRepository(transaction, workflow, authorization), { prisma: transaction, authorization, admittedAt, admittedAtEpochMs: Date.parse(admittedAt) });
		}, { isolationLevel, operation: "run retry" });
	}
}
