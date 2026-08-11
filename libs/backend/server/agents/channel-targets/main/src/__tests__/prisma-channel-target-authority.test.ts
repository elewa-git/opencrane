import { ChannelInvocationAction, ConversationLifecycle, ConversationMode } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaChannelTargetAuthorityUnitOfWork } from "../prisma-channel-target-authority.js";

/** Builds a Prisma facade that executes serializable work against one test transaction. */
function _Prisma(transaction: Record<string, unknown>, conversation?: Record<string, unknown>): never
{
	const transactionClient = conversation === undefined ? transaction : { ...transaction, conversation: { findUnique: vi.fn().mockResolvedValue(conversation) } };
	return {
		$transaction: async function _Transaction<T>(operation: (client: never) => Promise<T>): Promise<T> { return operation(transactionClient as never); },
	} as never;
}

/** Canonical event-context issuance command. */
function _IssueCommand(): never
{
	return { digest: `sha256:${"a".repeat(64)}`, subjectId: "user-1", siloId: "silo-1", conversationId: "conversation-1", agentServiceId: "service-1", action: "events.read", membershipRevision: 1, authorizationDigest: `sha256:${"b".repeat(64)}`, nowEpochMs: 1_000, expiresAtEpochMs: 2_000, allowedRouteHostSuffixes: [".svc.cluster.local"] } as never;
}

/** Open agent-session row shared by repository tests. */
function _Conversation()
{
	return { id: "conversation-1", siloId: "silo-1", agentServiceId: "service-1", mode: ConversationMode.AgentSession, lifecycle: ConversationLifecycle.Open, participants: [{ userId: "user-1", accessEndedPosition: null }] };
}

describe("PrismaChannelTargetAuthorityUnitOfWork", function _Suite()
{
	it("projects only open agent-session coordinates and active participants", async function _ProjectsConversation()
	{
		const repository = new PrismaChannelTargetAuthorityUnitOfWork(_Prisma({}, _Conversation()));

		await expect(repository.getConversationAuthority("conversation-1")).resolves.toEqual({ conversationId: "conversation-1", siloId: "silo-1", agentServiceId: "service-1", mode: "agent_session", lifecycle: "open", participantUserIds: ["user-1"] });
	});

	it("rejects closed or participant-inaccessible conversations during issuance", async function _RejectsConversationChange()
	{
		const transaction = {
			conversation: { findUnique: vi.fn().mockResolvedValue({ ..._Conversation(), lifecycle: ConversationLifecycle.Closed }) },
			channelRuntimeRoute: { findMany: vi.fn() },
			channelInvocationContext: { create: vi.fn() },
		};
		const repository = new PrismaChannelTargetAuthorityUnitOfWork(_Prisma(transaction));

		await expect(repository.issueInvocationContextAtomically(_IssueCommand())).resolves.toEqual({ status: "conversation_conflict" });
		expect(transaction.channelRuntimeRoute.findMany).not.toHaveBeenCalled();
	});

	it("issues only one current event-read route without raw locking", async function _IssuesEventRead()
	{
		const transaction = {
			conversation: { findUnique: vi.fn().mockResolvedValue(_Conversation()) },
			channelRuntimeRoute: { findMany: vi.fn().mockResolvedValue([{ id: "route-1", endpoint: "http://runtime.svc.cluster.local/events", expiresAt: new Date(3_000) }]) },
			channelInvocationContext: { create: vi.fn().mockResolvedValue({ id: "context-1" }) },
		};
		const repository = new PrismaChannelTargetAuthorityUnitOfWork(_Prisma(transaction));

		await expect(repository.issueInvocationContextAtomically(_IssueCommand())).resolves.toEqual({ status: "issued", context: { id: "context-1", routeId: "route-1", endpoint: "http://runtime.svc.cluster.local/events" } });
		expect(transaction.channelInvocationContext.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: ChannelInvocationAction.EventsRead, conversationId: "conversation-1" }) });
	});

	it("claims an unused event context once before returning its authority", async function _ConsumesOnce()
	{
		const transaction = {
			channelInvocationContext: {
				findUnique: vi.fn().mockResolvedValue({ id: "context-1", subjectId: "user-1", siloId: "silo-1", conversationId: "conversation-1", agentServiceId: "service-1", action: ChannelInvocationAction.EventsRead, routeId: "route-1", authorizationDigest: `sha256:${"b".repeat(64)}`, expiresAt: new Date(2_000), consumedAt: null, revokedAt: null, route: { isCurrent: true, revokedAt: null, expiresAt: new Date(2_000) } }),
				updateMany: vi.fn().mockResolvedValue({ count: 1 }),
			},
		};
		const repository = new PrismaChannelTargetAuthorityUnitOfWork(_Prisma(transaction));

		await expect(repository.consumeInvocationContextAtomically({ digest: `sha256:${"a".repeat(64)}`, expectedRouteId: "route-1", nowEpochMs: 1_000 })).resolves.toEqual({ status: "consumed", context: { subjectId: "user-1", siloId: "silo-1", conversationId: "conversation-1", agentServiceId: "service-1", action: "events.read", authorizationDigest: `sha256:${"b".repeat(64)}` } });
	});
});
