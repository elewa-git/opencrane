import { Prisma, type PrismaClient } from "@prisma/client";
import type { Logger } from "@opencrane/backend/observability";
import { describe, expect, it, vi } from "vitest";

import { PersonaApprovalInterviewStates, PersonaApprovalRevisionStates } from "../../approval/persona-authority.types";
import { PersonaAgentRevisionSelectionStatuses } from "../../approval/persona-authority.types";
import { PrismaPersonaPersistenceUnitOfWork } from "../prisma-persona-persistence-unit-of-work";
import type { PersonaAgentRevisionSelectionFactory } from "../prisma-persona-persistence-composition.types";

/** Builds a root client whose transaction boundary rejects with the supplied failure. */
function _Prisma(error: Error): PrismaClient
{
	return { $transaction: vi.fn().mockRejectedValue(error) } as unknown as PrismaClient;
}

/** Builds the observable structured logger owned by the aggregate unit of work. */
function _Logger(): Logger
{
	return { error: vi.fn() } as unknown as Logger;
}

/** Builds the app-owned selection factory required by the approval transaction. */
function _SelectionFactory(): PersonaAgentRevisionSelectionFactory
{
	return { create() { return { select() { return Promise.resolve({ status: PersonaAgentRevisionSelectionStatuses.Selected }); } }; } };
}

describe("PrismaPersonaPersistenceUnitOfWork", function _DescribePersonaPersistenceUnitOfWork()
{
	it("constructs persona repositories inside the exact serializable transaction callback", async function _BindsRepositoriesToTransaction()
	{
		const transaction = { personaProfile: { findUnique: vi.fn().mockResolvedValue(null) } };
		const prisma = {
			$transaction: vi.fn(async function _Transaction(work: (client: unknown) => Promise<unknown>)
			{
				return work(transaction);
			}),
		} as unknown as PrismaClient;
		const unitOfWork = new PrismaPersonaPersistenceUnitOfWork(prisma, _Logger(), _SelectionFactory());

		await expect(unitOfWork.readStatus("silo-1", "user-1")).resolves.toEqual({ state: "interview", interviewId: null, answeredQuestionCount: 0, questionCount: 0, personaRevisionId: null, questions: [], resolution: null, result: null });
		expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
		expect(transaction.personaProfile.findUnique).toHaveBeenCalledOnce();
	});

	it("logs and translates an unexpected onboarding transaction failure exactly once", async function _TranslatesOnboardingFailure()
	{
		const error = new Error("database unavailable");
		const logger = _Logger();
		const unitOfWork = new PrismaPersonaPersistenceUnitOfWork(_Prisma(error), logger, _SelectionFactory());

		await expect(unitOfWork.ensureAtomically({ siloId: "silo-1", userId: "user-1", provisionedAt: "2026-07-26T12:00:00.000Z" })).resolves.toEqual({ outcome: "denied", reason: "persistence_unavailable" });
		expect(logger.error).toHaveBeenCalledOnce();
		expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ err: error, operation: "persona.onboarding.provision", siloId: "silo-1" }), "Persona onboarding provisioning is unavailable");
	});

	it("classifies a serializable interview race as a conflict without operational logging", async function _ClassifiesInterviewConflict()
	{
		const conflict = new Prisma.PrismaClientKnownRequestError("could not serialize access", { code: "P2034", clientVersion: "test" });
		const logger = _Logger();
		const unitOfWork = new PrismaPersonaPersistenceUnitOfWork(_Prisma(conflict), logger, _SelectionFactory());

		await expect(unitOfWork.completeAtomically({ userId: "user-1", personaProfileId: "profile-1", interviewId: "interview-1", completedAt: "2026-07-23T09:02:00.000Z" })).resolves.toEqual({ status: "conflict" });
		expect(logger.error).not.toHaveBeenCalled();
	});

	it("logs an unexpected draft failure and returns a fail-closed persistence denial", async function _TranslatesDraftFailure()
	{
		const error = new Prisma.PrismaClientKnownRequestError("connection pool timeout", { code: "P2024", clientVersion: "test" });
		const logger = _Logger();
		const unitOfWork = new PrismaPersonaPersistenceUnitOfWork(_Prisma(error), logger, _SelectionFactory());

		await expect(unitOfWork.createFromInterviewAtomically({ siloId: "silo-1", userId: "user-1", personaProfileId: "profile-1", interviewId: "interview-1", authoredAt: "2026-07-26T12:00:00.000Z" })).resolves.toEqual({ status: "persistence_unavailable" });
		expect(logger.error).toHaveBeenCalledOnce();
	});

	it("translates an approval commit race to the authority's explicit conflict result", async function _TranslatesApprovalConflict()
	{
		const conflict = new Prisma.PrismaClientKnownRequestError("could not serialize access", { code: "P2034", clientVersion: "test" });
		const unitOfWork = new PrismaPersonaPersistenceUnitOfWork(_Prisma(conflict), _Logger(), _SelectionFactory());

		await expect(unitOfWork.approveAndActivateAtomically({ personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-26T12:00:00.000Z", expectedRevisionState: PersonaApprovalRevisionStates.Draft, expectedInterviewState: PersonaApprovalInterviewStates.Completed, expectedInsightCount: 3 })).resolves.toEqual({ status: "conflict" });
	});

	it("rejects the transaction before translating a stale bound refresh to conflict", async function _RollsBackStaleRefresh()
	{
		const transaction = {
			personaProfile: { findFirst: vi.fn().mockResolvedValue({ siloId: "silo-1", activeRevisionId: null }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
			personaRevision: { findFirst: vi.fn().mockResolvedValue({ interviewId: "interview-1" }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
			personaInterview: { findUnique: vi.fn().mockResolvedValue({ refreshConfigurationChangeId: "change-1" }) },
			personaInsight: { count: vi.fn().mockResolvedValue(3) },
			personalConfigurationChange: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
		};
		let rolledBack = false;
		const prisma = {
			$transaction: vi.fn(async function _Transaction(work: (client: unknown) => Promise<unknown>)
			{
				try
				{
					return await work(transaction);
				}
				catch (error)
				{
					rolledBack = true;
					throw error;
				}
			}),
		} as unknown as PrismaClient;
		const unitOfWork = new PrismaPersonaPersistenceUnitOfWork(prisma, _Logger(), _SelectionFactory());

		await expect(unitOfWork.approveAndActivateAtomically({ personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1", approvedAt: "2026-07-26T12:00:00.000Z", expectedRevisionState: PersonaApprovalRevisionStates.Draft, expectedInterviewState: PersonaApprovalInterviewStates.Completed, expectedInsightCount: 3 })).resolves.toEqual({ status: "conflict" });
		expect(rolledBack).toBe(true);
		expect(transaction.personaRevision.updateMany).toHaveBeenCalledOnce();
		expect(transaction.personaProfile.updateMany).toHaveBeenCalledOnce();
	});
});
