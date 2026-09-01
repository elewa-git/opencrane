import { AgentRunState, ConversationLifecycle, ConversationMode, OrgMemberStatus, Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { MessageContentBlockKinds } from "@opencrane/models/conversations";

import { PersonalRunIdempotencyOutcomes, type PersonalRunAdmissionAssemblyCommand, type PersonalRunAdmissionCommand } from "../personal-run-admission.types";
import { PrismaPersonalRunAdmissionUnitOfWork } from "../prisma-personal-run-admission-unit-of-work";

/** Builds one trusted personal admission command for persistence-adapter tests. */
function _Command(): PersonalRunAdmissionCommand
{
	return { siloId: "silo-1", requesterIssuer: "https://issuer.test", requesterSubjectId: "user-1", requesterAuthenticatedAt: "2026-09-01T00:00:00.000Z", conversationId: "conversation-1", requestIdempotencyKey: "request-1", inputMessageId: "message-1", inputMessageBlocks: [{ id: "block-1", kind: MessageContentBlockKinds.Text, value: "Hello" }] };
}

/** Adds the server-allocated coordinates that the durable duplicate reader verifies. */
function _AssemblyCommand(): PersonalRunAdmissionAssemblyCommand
{
	return { ..._Command(), runId: "run-new", agentServiceId: "service-1" };
}

/** Builds a Prisma-shaped client that offers one serializable transaction. */
function _Client(transaction: object): never
{
	return {
		$transaction: async function _Transaction(work: (client: object) => Promise<unknown>, options: { readonly isolationLevel: Prisma.TransactionIsolationLevel })
		{
			expect(options.isolationLevel).toBe(Prisma.TransactionIsolationLevel.Serializable);
			return work(transaction);
		},
	} as never;
}

describe("PrismaPersonalRunAdmissionUnitOfWork", function _DescribePrismaPersonalRunAdmissionUnitOfWork()
{
	it("resolves an exact durable duplicate from one serializable authority snapshot", async function _ResolvesDuplicate()
	{
		const transaction = {
			agentRun: {
				findUnique: async function _FindUnique()
				{
					return { id: "run-1", conversationId: "conversation-1", trigger: "Interactive", inputSnapshot: { id: "snapshot-1" } };
				},
			},
		};
		const unitOfWork = new PrismaPersonalRunAdmissionUnitOfWork(_Client(transaction));

		await expect(unitOfWork.resolve(_AssemblyCommand())).resolves.toEqual({ outcome: PersonalRunIdempotencyOutcomes.Idempotent, runId: "run-1" });
	});

	it("resolves only a participant-bound personal service inside a serializable snapshot", async function _ResolvesPersonalConversation()
	{
		const transaction = {
			conversation: { findFirst: async function _FindConversation() { return { agentServiceId: "service-1" }; } },
			agentService: { findFirst: async function _FindService() { return { id: "service-1" }; } },
		};
		const unitOfWork = new PrismaPersonalRunAdmissionUnitOfWork(_Client(transaction));

		await expect(unitOfWork.resolveConversation(_Command())).resolves.toEqual({ agentServiceId: "service-1" });
	});

	it("reclassifies only a fresh participant-authorized active conversation run", async function _reclassifiesActiveRun()
	{
		const findFirst = vi.fn().mockResolvedValue({ id: "conversation-1" });
		const membership = vi.fn().mockResolvedValue({ clusterTenant: "silo-1" });
		const unitOfWork = new PrismaPersonalRunAdmissionUnitOfWork(_Client({ orgMembership: { findFirst: membership }, conversation: { findFirst } }));

		await expect(unitOfWork.hasActiveConversationRun(_Command())).resolves.toBe(true);
		expect(membership).toHaveBeenCalledWith({ where: { clusterTenant: "silo-1", subject: "user-1", status: OrgMemberStatus.Active }, select: { clusterTenant: true } });
		expect(findFirst).toHaveBeenCalledWith({
			where: {
				id: "conversation-1",
				siloId: "silo-1",
				mode: ConversationMode.AgentSession,
				lifecycle: ConversationLifecycle.Open,
				participants: { some: { userId: "user-1", accessEndedPosition: null } },
				runs: { some: { state: { notIn: [AgentRunState.Completed, AgentRunState.Failed, AgentRunState.Cancelled] } } },
			},
			select: { id: true },
		});
	});

	it("does not disclose an active conversation run after current membership is revoked", async function _DeniesRevokedMembership()
	{
		const findFirst = vi.fn().mockResolvedValue({ id: "conversation-1" });
		const unitOfWork = new PrismaPersonalRunAdmissionUnitOfWork(_Client({ orgMembership: { findFirst: vi.fn().mockResolvedValue(null) }, conversation: { findFirst } }));

		await expect(unitOfWork.hasActiveConversationRun(_Command())).resolves.toBe(false);
		expect(findFirst).not.toHaveBeenCalled();
	});
});
