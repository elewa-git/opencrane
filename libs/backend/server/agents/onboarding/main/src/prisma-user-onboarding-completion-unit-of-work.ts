import type { Prisma, PrismaClient } from "@prisma/client";

import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import { __UserOnboardingCompletion, UserOnboardingCompletionConflict } from "./user-onboarding-completion";
import { UserOnboardingReadinessStatuses, type UserOnboardingCompletionUnitOfWork, type UserOnboardingPersonalAgentBootstrapPort, type UserOnboardingReadinessResult } from "./user-onboarding-completion.types";
import { PrismaUserOnboardingCompletionRepository } from "./prisma-user-onboarding-completion-repository";
import type { UserOnboardingOwner } from "./user-onboarding.types";

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

	/**
	 * Rebuild both repositories inside each fresh transaction and retry only confirmed rollbacks.
	 *
	 * The shared unit-of-work envelope allows three attempts, retrying proven Prisma rollbacks
	 * (P2002 and P2034) plus the domain compare-and-swap conflict. When the domain conflict is
	 * still there after the last attempt, the caller receives a degraded readiness status instead
	 * of an exception.
	 */
	private async _attempt(work: (authority: __UserOnboardingCompletion) => Promise<UserOnboardingReadinessResult>): Promise<UserOnboardingReadinessResult>
	{
		const createPersonalAgent = this.createPersonalAgent;
		try
		{
			return await ___RunInPrismaUnitOfWork(this.prisma, async function _Transaction(transaction): Promise<UserOnboardingReadinessResult>
			{
				const authority = new __UserOnboardingCompletion(new PrismaUserOnboardingCompletionRepository(transaction), createPersonalAgent(transaction));
				return work(authority);
			}, { isolationLevel: "Serializable", operation: "user onboarding completion", attemptLimit: 3, isRetryable: _IsCompletionConflict });
		}
		catch (error)
		{
			if (error instanceof UserOnboardingCompletionConflict) return { status: UserOnboardingReadinessStatuses.AuthorityUnavailable, agentServiceId: null };
			throw error;
		}
	}
}

/** Returns whether the error is the domain compare-and-swap conflict, which is safe to retry. */
function _IsCompletionConflict(error: unknown): boolean
{
	return error instanceof UserOnboardingCompletionConflict;
}
