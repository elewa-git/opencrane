import type { PrismaClient } from "@prisma/client";

import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";
import { ___IsRolledBackConflict, ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";
import { PrismaAuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";

import { PrismaAgentRunAuthorityRepository } from "./prisma-run-authority";
import { __StartNextRunAttempt } from "./run-authority";
import type { AgentRunAuthorityRepository, AgentRunAuthoritySnapshot, AgentRunRetryTransactionRepository, AtomicRunAttemptResult, AtomicStartNextRunAttemptCommand, RunRetryAuthority, StartNextRunAttemptCommand, StartNextRunAttemptResult } from "./run-authority.types";

/** Maximum number of complete retry-authority attempts after PostgreSQL reports a safe rollback. */
const _RUN_RETRY_ATTEMPT_LIMIT = 3;

/**
 * Owns database transactions and conflict recovery for participant-requested run retries.
 *
 * The domain authority performs an advisory read and then a separately guarded write. This class
 * supplies a fresh transaction-bound repository for each part and may repeat the full decision only
 * after Prisma confirms P2002 or P2034 rolled it back. Because one decision spans two transactions
 * at different isolation levels, the retry loop lives here rather than in the shared envelope, which
 * opens each individual transaction. After three conflicts it reads the committed next-attempt
 * workflow task and accepts it only when it matches the requested run coordinates.
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
		try
		{
			return await this._Decide(command);
		}
		catch (error)
		{
			if (!___IsRolledBackConflict(error)) throw error;
			const winner = await this._ReadWinner(command);
			if (winner !== null) return winner;
			throw error;
		}
	}

	/** Repeats the complete read-then-write decision only after Prisma proves a full rollback. */
	private async _Decide(command: StartNextRunAttemptCommand): Promise<StartNextRunAttemptResult>
	{
		for (let attempt = 1; ; attempt += 1)
		{
			try
			{
				return await __StartNextRunAttempt(this._RepositoryPort(), command);
			}
			catch (error)
			{
				if (!___IsRolledBackConflict(error) || attempt === _RUN_RETRY_ATTEMPT_LIMIT) throw error;
			}
		}
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
		return this._Run(function _Read(repository) { return repository.getRunAuthority(runId); }, "RepeatableRead");
	}

	/** Applies the guarded attempt and workflow-task writes together at Serializable isolation. */
	private async _StartAttempt(command: AtomicStartNextRunAttemptCommand): Promise<AtomicRunAttemptResult>
	{
		return this._Run(function _Start(repository) { return repository.startNextAttemptAtomically(command); }, "Serializable");
	}

	/** Reads the committed next attempt after all transaction retries have rolled back. */
	private async _ReadWinner(command: StartNextRunAttemptCommand): Promise<StartNextRunAttemptResult | null>
	{
		return this._Run(function _Read(repository)
		{
			return repository.readRetryWinner(command);
		}, "Serializable");
	}

	/** Runs one operation with a repository bound to a fresh transaction at the requested isolation. */
	private async _Run<Result>(work: (repository: AgentRunRetryTransactionRepository) => Promise<Result>, isolationLevel: "RepeatableRead" | "Serializable"): Promise<Result>
	{
		const workflow = this._workflow;
		return ___RunInPrismaUnitOfWork(this._prisma, async function _Run(transaction): Promise<Result>
		{
			return work(new PrismaAgentRunAuthorityRepository(transaction, workflow, new PrismaAuthorizationAuthority(transaction)));
		}, { isolationLevel, operation: "run retry" });
	}
}
