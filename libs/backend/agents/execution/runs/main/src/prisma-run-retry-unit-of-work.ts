import { Prisma, type PrismaClient } from "@prisma/client";

import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";
import { PrismaAuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";

import { PrismaAgentRunAuthorityRepository } from "./prisma-run-authority";
import { __StartNextRunAttempt } from "./run-authority";
import type { AgentRunAuthorityRepository, AgentRunAuthoritySnapshot, AgentRunRetryTransactionRepository, AtomicRunAttemptResult, AtomicStartNextRunAttemptCommand, RunRetryAuthority, StartNextRunAttemptCommand, StartNextRunAttemptResult } from "./run-authority.types";

/** Maximum number of complete retry-authority attempts after PostgreSQL reports a safe rollback. */
const _RUN_RETRY_ATTEMPT_LIMIT = 3;

/** Prisma codes that prove the complete transaction was rolled back by a concurrent writer. */
const _RETRYABLE_RUN_RETRY_CODES = new Set(["P2002", "P2034"]);

/**
 * Owns database transactions and conflict recovery for participant-requested run retries.
 *
 * The domain authority performs an advisory read and then a separately guarded write. This class
 * supplies a fresh transaction-bound repository for each part and may repeat the full decision only
 * after Prisma confirms P2002 or P2034 rolled it back. After three conflicts it reads the committed
 * next-attempt workflow task and accepts it only when it matches the requested run coordinates.
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

	/** Creates the retry transaction boundary over the app-owned Prisma client. */
	constructor(prisma: PrismaClient, workflow: Pick<IWorkflowEngine, "spawn">)
	{
		this._prisma = prisma;
		this._workflow = workflow;
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
		let lastConflict: unknown = null;
		for (let attempt = 1; attempt <= _RUN_RETRY_ATTEMPT_LIMIT; attempt += 1)
		{
			try
			{
				return await __StartNextRunAttempt(this._RepositoryPort(), command);
			}
			catch (error)
			{
				if (!_IsRetryableRunRetryConflict(error)) throw error;
				lastConflict = error;
			}
		}
		const winner = await this._ReadWinner(command);
		if (winner !== null) return winner;
		if (lastConflict !== null) throw lastConflict;
		throw new Error("run retry loop exhausted without a recorded database conflict");
	}

	/** Adapts the domain repository port to fresh transactions owned by this unit of work. */
	private _RepositoryPort(): AgentRunAuthorityRepository
	{
		const unitOfWork = this;
		return {
			getRunAuthority(runId: string): Promise<AgentRunAuthoritySnapshot | null>
			{
				return unitOfWork._ReadAuthority(runId);
			},
			startNextAttemptAtomically(command: AtomicStartNextRunAttemptCommand): Promise<AtomicRunAttemptResult>
			{
				return unitOfWork._StartAttempt(command);
			},
		};
	}

	/** Reads the run and service together at RepeatableRead isolation for the domain decision. */
	private async _ReadAuthority(runId: string): Promise<AgentRunAuthoritySnapshot | null>
	{
		return this._Run(function _Read(repository) { return repository.getRunAuthority(runId); }, Prisma.TransactionIsolationLevel.RepeatableRead);
	}

	/** Applies the guarded attempt and workflow-task writes together at Serializable isolation. */
	private async _StartAttempt(command: AtomicStartNextRunAttemptCommand): Promise<AtomicRunAttemptResult>
	{
		return this._Run(function _Start(repository) { return repository.startNextAttemptAtomically(command); }, Prisma.TransactionIsolationLevel.Serializable);
	}

	/** Reads the committed next attempt after all transaction retries have rolled back. */
	private async _ReadWinner(command: StartNextRunAttemptCommand): Promise<StartNextRunAttemptResult | null>
	{
		return this._Run(function _Read(repository)
		{
			return repository.readRetryWinner(command);
		}, Prisma.TransactionIsolationLevel.Serializable);
	}

	/** Runs one operation with a repository bound to a fresh transaction at the requested isolation. */
	private async _Run<Result>(work: (repository: AgentRunRetryTransactionRepository) => Promise<Result>, isolationLevel: Prisma.TransactionIsolationLevel): Promise<Result>
	{
		const workflow = this._workflow;
		return this._prisma.$transaction(async function _Run(transaction): Promise<Result>
		{
			return work(new PrismaAgentRunAuthorityRepository(transaction, workflow, new PrismaAuthorizationAuthority(transaction)));
		}, { isolationLevel });
	}
}

/** Returns whether Prisma confirms the whole transaction was rolled back by a known race. */
function _IsRetryableRunRetryConflict(error: unknown): boolean
{
	return error instanceof Prisma.PrismaClientKnownRequestError && _RETRYABLE_RUN_RETRY_CODES.has(error.code);
}
