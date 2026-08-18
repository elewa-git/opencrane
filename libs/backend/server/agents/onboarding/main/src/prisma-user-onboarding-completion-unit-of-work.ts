import { Prisma, type PrismaClient } from "@prisma/client";

import { __UserOnboardingCompletion, UserOnboardingCompletionConflict } from "./user-onboarding-completion";
import { UserOnboardingReadinessStatuses, type UserOnboardingCompletionUnitOfWork, type UserOnboardingPersonalAgentBootstrapPort, type UserOnboardingReadinessResult } from "./user-onboarding-completion.types";
import { PrismaUserOnboardingCompletionRepository } from "./prisma-user-onboarding-completion-repository";
import type { UserOnboardingOwner } from "./user-onboarding.types";

/** Total Serializable attempts allowed after proven full-transaction rollback. */
const _COMPLETION_ATTEMPT_LIMIT = 3;

/** Prisma conflicts that prove the failed attempt did not commit partially. */
const _RETRYABLE_COMPLETION_CODES = new Set(["P2002", "P2034"]);

/** Opens onboarding completion and readiness repair as one retry-safe Serializable transaction. */
export class PrismaUserOnboardingCompletionUnitOfWork implements UserOnboardingCompletionUnitOfWork
{
	/** Root client used only to open a fresh transaction for every attempt. */
	private readonly prisma: PrismaClient;
	/** App-owned factory that adapts agent-services to the current transaction. */
	private readonly createPersonalAgent: (transaction: Prisma.TransactionClient) => UserOnboardingPersonalAgentBootstrapPort;

	/** Create the onboarding-owned transaction boundary. */
	constructor(prisma: PrismaClient, createPersonalAgent: (transaction: Prisma.TransactionClient) => UserOnboardingPersonalAgentBootstrapPort)
	{
		this.prisma = prisma;
		this.createPersonalAgent = createPersonalAgent;
	}

	/** @inheritdoc */
	async complete(owner: UserOnboardingOwner, conversationId: string, completedAt: Date): Promise<UserOnboardingReadinessResult>
	{
		return this._attempt(function _Complete(authority) { return authority.complete(owner, conversationId, completedAt); });
	}

	/** @inheritdoc */
	async ensureReady(owner: UserOnboardingOwner): Promise<UserOnboardingReadinessResult>
	{
		return this._attempt(function _EnsureReady(authority) { return authority.ensureReady(owner, new Date()); });
	}

	/** Rebuild both repositories inside each fresh transaction and retry only confirmed rollbacks. */
	private async _attempt(work: (authority: __UserOnboardingCompletion) => Promise<UserOnboardingReadinessResult>): Promise<UserOnboardingReadinessResult>
	{
		const createPersonalAgent = this.createPersonalAgent;
		for (let attempt = 1; attempt <= _COMPLETION_ATTEMPT_LIMIT; attempt += 1)
		{
			try
			{
				return await this.prisma.$transaction(async function _Transaction(transaction)
				{
					const authority = new __UserOnboardingCompletion(new PrismaUserOnboardingCompletionRepository(transaction), createPersonalAgent(transaction));
					return work(authority);
				}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
			}
			catch (error)
			{
				if ((_Retryable(error) || error instanceof UserOnboardingCompletionConflict) && attempt < _COMPLETION_ATTEMPT_LIMIT) continue;
				if (error instanceof UserOnboardingCompletionConflict) return { status: UserOnboardingReadinessStatuses.AuthorityUnavailable, agentServiceId: null };
				throw error;
			}
		}
		throw new Error("user onboarding completion exhausted without a result");
	}
}

/** Accept only Prisma codes proving the whole transaction rolled back. */
function _Retryable(error: unknown): boolean
{
	return error instanceof Prisma.PrismaClientKnownRequestError && _RETRYABLE_COMPLETION_CODES.has(error.code);
}
