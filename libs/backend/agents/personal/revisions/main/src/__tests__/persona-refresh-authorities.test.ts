import { describe, expect, it, vi } from "vitest";

import { PrismaPersonaRefreshApprovalRepository } from "../prisma-persona-refresh-approval-repository.js";
import { PrismaPersonaRefreshInterviewRepository } from "../prisma-persona-refresh-interview-repository.js";

/** Fixed accepted refresh coordinates used by the persistence authority tests. */
const _REFRESH = { siloId: "silo-1", userId: "user-1", personaProfileId: "profile-1", refreshChangeId: "change-1", questionSetId: "onboarding", questionSetVersion: 1, startedAt: "2026-07-23T12:00:00.000Z" } as const;

/** Runs a narrow fake Prisma transaction used by the two refresh persistence seams. */
function _Prisma(transaction: unknown)
{
	return { $transaction: async function _transaction(callback: (value: unknown) => Promise<unknown>) { return callback(transaction); } } as never;
}

describe("refresh persona authorities", function _describeRefreshAuthorities()
{
	it("starts a linked interview only after the accepted refresh fence and reviewed set are present", async function _startsLinkedInterview()
	{
		const transaction = { $queryRaw: vi.fn().mockResolvedValue([{ id: "record" }]), personaInterview: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "interview-2" }) }, personaQuestionSet: { findUnique: vi.fn().mockResolvedValue({ state: "Reviewed" }) } };
		const result = await new PrismaPersonaRefreshInterviewRepository(_Prisma(transaction)).startRefreshAtomically(_REFRESH);

		expect(result).toEqual({ status: "started", interviewId: "interview-2" });
		expect(transaction.personaInterview.create).toHaveBeenCalledWith({ data: expect.objectContaining({ refreshChangeId: "change-1", personaProfileId: "profile-1" }), select: { id: true } });
	});

	it("rolls persona approval, personal revision publication, and applied refresh evidence through one transaction", async function _appliesRefresh()
	{
		const create = vi.fn().mockResolvedValue({ id: "agent-2" });
		const transaction = {
			$queryRaw: vi.fn().mockResolvedValueOnce([{ id: "profile-1" }]).mockResolvedValueOnce([{ id: "change-1", agentServiceId: "service-1", expectedPersonaRevisionId: "persona-1", expectedAgentRevisionId: "agent-1" }]).mockResolvedValue([]),
			personaRevision: { findFirst: vi.fn().mockResolvedValue({ id: "persona-2", interviewId: "interview-2" }), update: vi.fn().mockResolvedValue({}) },
			personaProfile: { findUnique: vi.fn().mockResolvedValue({ activeRevisionId: "persona-1" }), update: vi.fn().mockResolvedValue({}) },
			agentService: { findFirst: vi.fn().mockResolvedValue({ id: "service-1", activeRevisionId: "agent-1" }), update: vi.fn().mockResolvedValue({}) },
			agentRevision: { findFirst: vi.fn().mockResolvedValue({ id: "agent-1", agentServiceId: "service-1", revision: 1, promptPolicyVersion: "prompt-v1", personaRevisionId: "persona-1", modelDefinitionId: "model-1", budget: {}, skillAssignments: [], integrationAssignments: [], scopeAttachments: [] }), create, update: vi.fn().mockResolvedValue({}) },
			personalConfigurationChange: { update: vi.fn().mockResolvedValue({}) },
		};
		const result = await new PrismaPersonaRefreshApprovalRepository(_Prisma(transaction)).approveRefreshAtomically({ siloId: "silo-1", userId: "user-1", personaProfileId: "profile-1", personaRevisionId: "persona-2", approvedAt: "2026-07-23T12:05:00.000Z" });

		expect(result).toEqual({ status: "approved", agentRevisionId: "agent-2" });
		expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ personaRevisionId: "persona-2", parentRevision: { connect: { id: "agent-1" } } }) }));
		expect(transaction.personalConfigurationChange.update).toHaveBeenCalledWith({ where: { id: "change-1" }, data: { state: "Applied", appliedPersonaRevisionId: "persona-2", appliedAgentRevisionId: "agent-2" } });
	});
});
