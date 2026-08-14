import { ChannelInvocationAction, ConversationLifecycle, ConversationMode } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaChannelTargetAuthorityUnitOfWork } from "../prisma-channel-target-authority";

/** Captured observability calls for authority-boundary trace assertions. */
const _trace = vi.hoisted(function _CreateTraceState()
{
	return {
		doWithTrace: vi.fn(async function _DoWithTrace<T>(_name: string, _fields: Record<string, unknown>, work: () => Promise<T>): Promise<T> { return work(); }),
		setAttribute: vi.fn(),
	};
});

vi.mock("@opencrane/backend/observability", function _ObservabilityMock()
{
	return { ___DoWithTrace: _trace.doWithTrace, ___GetActiveSpan: function _GetActiveSpan() { return { setAttribute: _trace.setAttribute }; } };
});

/** Builds a Prisma facade that executes serializable work against one test transaction. */
function _Prisma(transaction: Record<string, unknown>, topLevel: Record<string, unknown> = {}): never
{
	return {
		...topLevel,
		$transaction: async function _Transaction<T>(operation: ((client: never) => Promise<T>) | readonly Promise<unknown>[]): Promise<T | unknown[]>
		{
			return typeof operation === "function" ? operation(transaction as never) : Promise.all(operation);
		},
	} as never;
}

/** Canonical event-context issuance command. */
function _IssueCommand(): never
{
	return { digest: `sha256:${"a".repeat(64)}`, subjectId: "user-1", siloId: "silo-1", conversationId: "conversation-1", agentServiceId: "service-1", action: "events.read", membershipRevision: 1, authorizationDigest: `sha256:${"b".repeat(64)}`, nowEpochMs: 1_000, expiresAtEpochMs: 2_000, allowedRouteHostSuffixes: [".svc.cluster.local"], receiverId: "receiver-1" } as never;
}

/** Open agent-session row shared by repository tests. */
function _Conversation()
{
	return { id: "conversation-1", siloId: "silo-1", agentServiceId: "service-1", mode: ConversationMode.AgentSession, lifecycle: ConversationLifecycle.Open, participants: [{ userId: "user-1", accessEndedPosition: null }] };
}

/** Exact service route joined to one invocation context. */
function _Route(overrides: Record<string, unknown> = {})
{
	return { id: "route-1", receiverId: "receiver-1", siloId: "silo-1", agentServiceId: "service-1", action: ChannelInvocationAction.EventsRead, endpoint: "http://runtime.svc.cluster.local/events", isCurrent: true, revokedAt: null, ...overrides };
}

describe("PrismaChannelTargetAuthorityUnitOfWork", function _Suite()
{
	it("projects only open agent-session coordinates and active participants", async function _ProjectsConversation()
	{
		const repository = new PrismaChannelTargetAuthorityUnitOfWork(_Prisma({ conversation: { findUnique: vi.fn().mockResolvedValue(_Conversation()) } }));
		await expect(repository.getConversationAuthority("conversation-1")).resolves.toEqual({ conversationId: "conversation-1", siloId: "silo-1", agentServiceId: "service-1", mode: "agent_session", lifecycle: "open", participantUserIds: ["user-1"] });
	});

	it("reconciles distinct route rows for two services sharing one stable receiver", async function _ReconcilesTwoServices()
	{
		const updateMany = vi.fn().mockResolvedValue({ count: 0 });
		const upsert = vi.fn(function _Upsert(input: unknown) { return Promise.resolve(input); });
		const prisma = _Prisma({
			agentService: { findMany: vi.fn().mockResolvedValue([{ id: "service-1", siloId: "silo-1" }, { id: "service-2", siloId: "silo-1" }]) },
			channelRuntimeRoute: { updateMany, upsert },
		});
		const repository = new PrismaChannelTargetAuthorityUnitOfWork(prisma);

		await expect(repository.reconcileRuntimeRoutes({ receiverId: "receiver-1", endpoint: "http://runtime.svc.cluster.local/events", action: "events.read", allowedRouteHostSuffixes: [".svc.cluster.local"] })).resolves.toBe(2);
		expect(updateMany).toHaveBeenCalledTimes(2);
		expect(upsert).toHaveBeenCalledTimes(2);
		expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { receiverId_siloId_agentServiceId_action: expect.objectContaining({ receiverId: "receiver-1", agentServiceId: "service-1" }) } }));
		expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { receiverId_siloId_agentServiceId_action: expect.objectContaining({ receiverId: "receiver-1", agentServiceId: "service-2" }) } }));
		expect(_trace.doWithTrace).toHaveBeenLastCalledWith("channel.routes.reconcile", {}, expect.any(Function));
	});

	it("rejects closed conversations before route selection", async function _RejectsConversationChange()
	{
		const transaction = {
			conversation: { findUnique: vi.fn().mockResolvedValue({ ..._Conversation(), lifecycle: ConversationLifecycle.Closed }) },
			channelRuntimeRoute: { findMany: vi.fn() },
			channelInvocationContext: { create: vi.fn() },
		};
		const repository = new PrismaChannelTargetAuthorityUnitOfWork(_Prisma(transaction));

		await expect(repository.issueInvocationContextAtomically(_IssueCommand())).resolves.toEqual({ status: "conversation_conflict" });
		expect(transaction.channelRuntimeRoute.findMany).not.toHaveBeenCalled();
		expect(_trace.setAttribute).toHaveBeenLastCalledWith("outcome", "conversation_conflict");
	});

	it("issues a context bound to both the exact service route and stable receiver", async function _IssuesEventRead()
	{
		const transaction = {
			conversation: { findUnique: vi.fn().mockResolvedValue(_Conversation()) },
			channelRuntimeRoute: { findMany: vi.fn().mockResolvedValue([_Route()]) },
			channelInvocationContext: { create: vi.fn().mockResolvedValue({ id: "context-1" }) },
		};
		const repository = new PrismaChannelTargetAuthorityUnitOfWork(_Prisma(transaction));

		await expect(repository.issueInvocationContextAtomically(_IssueCommand())).resolves.toEqual({ status: "issued", context: { id: "context-1", routeId: "route-1", receiverId: "receiver-1", endpoint: "http://runtime.svc.cluster.local/events" } });
		expect(transaction.channelRuntimeRoute.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ receiverId: "receiver-1", agentServiceId: "service-1" }) }));
		expect(transaction.channelInvocationContext.create).toHaveBeenCalledWith({ data: expect.objectContaining({ conversationId: "conversation-1", routeId: "route-1", receiverId: "receiver-1" }) });
	});

	it("rejects a context presented to the wrong stable receiver", async function _RejectsWrongReceiver()
	{
		const transaction = { channelInvocationContext: { findUnique: vi.fn().mockResolvedValue({ routeId: "route-1", receiverId: "receiver-1", route: _Route() }) } };
		const repository = new PrismaChannelTargetAuthorityUnitOfWork(_Prisma(transaction));
		await expect(repository.consumeInvocationContextAtomically({ digest: `sha256:${"a".repeat(64)}`, expectedReceiverId: "receiver-other", nowEpochMs: 1_000 })).resolves.toEqual({ status: "denied", reason: "receiver_mismatch" });
	});

	it("rejects a context whose route no longer matches its service evidence", async function _RejectsWrongRoute()
	{
		const transaction = { channelInvocationContext: { findUnique: vi.fn().mockResolvedValue({ routeId: "route-1", receiverId: "receiver-1", siloId: "silo-1", agentServiceId: "service-1", action: ChannelInvocationAction.EventsRead, route: _Route({ agentServiceId: "service-other" }) }) } };
		const repository = new PrismaChannelTargetAuthorityUnitOfWork(_Prisma(transaction));
		await expect(repository.consumeInvocationContextAtomically({ digest: `sha256:${"a".repeat(64)}`, expectedReceiverId: "receiver-1", nowEpochMs: 1_000 })).resolves.toEqual({ status: "denied", reason: "route_mismatch" });
	});

	it("rejects an invocation after its exact service route is revoked", async function _RejectsRevokedRoute()
	{
		const transaction = { channelInvocationContext: { findUnique: vi.fn().mockResolvedValue({ routeId: "route-1", receiverId: "receiver-1", siloId: "silo-1", agentServiceId: "service-1", action: ChannelInvocationAction.EventsRead, expiresAt: new Date(2_000), consumedAt: null, revokedAt: null, route: _Route({ revokedAt: new Date(900) }) }) } };
		const repository = new PrismaChannelTargetAuthorityUnitOfWork(_Prisma(transaction));
		await expect(repository.consumeInvocationContextAtomically({ digest: `sha256:${"a".repeat(64)}`, expectedReceiverId: "receiver-1", nowEpochMs: 1_000 })).resolves.toEqual({ status: "denied", reason: "route_inactive" });
	});

	it("claims an unused event context once before returning both route identities", async function _ConsumesOnce()
	{
		const transaction = {
			channelInvocationContext: {
				findUnique: vi.fn().mockResolvedValue({ id: "context-1", subjectId: "user-1", siloId: "silo-1", conversationId: "conversation-1", agentServiceId: "service-1", action: ChannelInvocationAction.EventsRead, routeId: "route-1", receiverId: "receiver-1", authorizationDigest: `sha256:${"b".repeat(64)}`, expiresAt: new Date(2_000), consumedAt: null, revokedAt: null, route: _Route() }),
				updateMany: vi.fn().mockResolvedValue({ count: 1 }),
			},
		};
		const repository = new PrismaChannelTargetAuthorityUnitOfWork(_Prisma(transaction));

		await expect(repository.consumeInvocationContextAtomically({ digest: `sha256:${"a".repeat(64)}`, expectedReceiverId: "receiver-1", nowEpochMs: 1_000 })).resolves.toEqual({ status: "consumed", context: { routeId: "route-1", receiverId: "receiver-1", subjectId: "user-1", siloId: "silo-1", conversationId: "conversation-1", agentServiceId: "service-1", action: "events.read", authorizationDigest: `sha256:${"b".repeat(64)}` } });
		expect(_trace.setAttribute).toHaveBeenCalledWith("outcome", "consumed");
		expect(JSON.stringify(_trace.doWithTrace.mock.calls)).not.toContain("sha256:");
	});
});
