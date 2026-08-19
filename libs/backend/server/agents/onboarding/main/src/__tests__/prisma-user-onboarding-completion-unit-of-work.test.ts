import { Prisma, UserOnboardingState, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaUserOnboardingCompletionUnitOfWork } from "../prisma-user-onboarding-completion-unit-of-work";
import { UserOnboardingPersonalAgentBootstrapStatuses, UserOnboardingReadinessStatuses } from "../user-onboarding-completion.types";
import type { UserOnboardingOwner } from "../user-onboarding.types";

/** Stable owner supplied by an authenticated test session. */
const _OWNER: UserOnboardingOwner = { siloId: "silo-1", subjectId: "user-1" };

/** Build the complete pinned evidence returned by the transaction repository. */
function _Evidence()
{
	return {
		id: "onboarding-1",
		siloId: _OWNER.siloId,
		userId: _OWNER.subjectId,
		state: UserOnboardingState.BootstrapChatInProgress,
		completionProvenance: null,
		personaRevisionId: "persona-1",
		bootstrapConversationId: "conversation-1",
		bootstrapContentRevisionId: "content-1",
		bootstrapContentDigest: "digest-1",
		bootstrapConversation: {
			id: "conversation-1",
			onboardingId: "onboarding-1",
			siloId: _OWNER.siloId,
			userId: _OWNER.subjectId,
			personaRevisionId: "persona-1",
			contentRevisionId: "content-1",
			contentDigest: "digest-1",
			answers: [{ questionOrdinal: 1 }, { questionOrdinal: 2 }, { questionOrdinal: 3 }],
			contentRevision: { questions: [{ ordinal: 1 }, { ordinal: 2 }, { ordinal: 3 }] },
		},
	};
}

/** Open transactions that commit staged Agent writes only when their callback resolves. */
function _Prisma(markResults: readonly boolean[])
{
	const committed: string[] = [];
	let attempt = 0;
	const transaction = vi.fn(async function _Transaction(work: (client: Prisma.TransactionClient) => Promise<unknown>)
	{
		const currentAttempt = attempt;
		attempt += 1;
		const staged: string[] = [];
		const client = {
			userOnboarding: {
				findUnique: vi.fn().mockResolvedValue(_Evidence()),
				updateMany: vi.fn().mockResolvedValue({ count: markResults[currentAttempt] ? 1 : 0 }),
			},
			staged,
		} as unknown as Prisma.TransactionClient & { staged: string[] };
		const result = await work(client);
		committed.push(...staged);
		return result;
	});
	return { prisma: { $transaction: transaction } as unknown as PrismaClient, committed, transaction };
}

/** Stage all material Agent writes on the current transaction attempt. */
function _PersonalAgent(transaction: Prisma.TransactionClient)
{
	return {
		ensureReady: vi.fn().mockImplementation(async function _StageAgentWrites()
		{
			(transaction as Prisma.TransactionClient & { staged: string[] }).staged.push("AgentService", "AgentRevision", "AuditEvent");
			return { status: UserOnboardingPersonalAgentBootstrapStatuses.Ready, agentServiceId: "onboarding-1" };
		}),
	};
}

describe("PrismaUserOnboardingCompletionUnitOfWork", function _PrismaCompletionUnitOfWorkSuite()
{
	it("rolls back material Agent writes before retrying a lost final completion compare-and-swap", async function _RetriesRolledBackConflict()
	{
		const database = _Prisma([false, true]);
		const unitOfWork = new PrismaUserOnboardingCompletionUnitOfWork(database.prisma, _PersonalAgent);

		await expect(unitOfWork.complete(_OWNER, "conversation-1", new Date("2026-08-18T10:00:00.000Z"))).resolves.toEqual({ status: UserOnboardingReadinessStatuses.Ready, agentServiceId: "onboarding-1" });
		expect(database.transaction).toHaveBeenCalledTimes(2);
		expect(database.committed).toEqual(["AgentService", "AgentRevision", "AuditEvent"]);
	});

	it("returns unavailable only after every lost compare-and-swap attempt rolled back", async function _ExhaustsRolledBackConflicts()
	{
		const database = _Prisma([false, false, false]);
		const unitOfWork = new PrismaUserOnboardingCompletionUnitOfWork(database.prisma, _PersonalAgent);

		await expect(unitOfWork.complete(_OWNER, "conversation-1", new Date())).resolves.toEqual({ status: UserOnboardingReadinessStatuses.AuthorityUnavailable, agentServiceId: null });
		expect(database.transaction).toHaveBeenCalledTimes(3);
		expect(database.committed).toEqual([]);
	});

	it.each(["P2002", "P2034"])("retries a Prisma %s conflict with a fresh transaction", async function _RetriesPrismaConflict(code)
	{
		const database = _Prisma([true]);
		const successfulTransaction = database.transaction.getMockImplementation();
		database.transaction
			.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("retryable transaction conflict", { code, clientVersion: "test" }))
			.mockImplementation(successfulTransaction ?? vi.fn());
		const unitOfWork = new PrismaUserOnboardingCompletionUnitOfWork(database.prisma, _PersonalAgent);

		await expect(unitOfWork.complete(_OWNER, "conversation-1", new Date())).resolves.toEqual({ status: UserOnboardingReadinessStatuses.Ready, agentServiceId: "onboarding-1" });
		expect(database.transaction).toHaveBeenCalledTimes(2);
	});
});
