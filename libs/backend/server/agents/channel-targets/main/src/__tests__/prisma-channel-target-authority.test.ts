import { ChannelInvocationAction, ConversationLifecycle, ConversationMode } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthorizationBoundaryKinds, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { PrismaChannelTargetAuthorityUnitOfWork } from "../prisma-channel-target-authority";

/** Captured observability calls for authority-boundary trace assertions. */
const _trace = vi.hoisted(function _CreateTraceState()
{
	return {
		doWithTrace: vi.fn(async function _DoWithTrace<T>(_name: string, _fields: Record<string, unknown>, work: () => Promise<T>): Promise<T> { return work(); }),
		setAttribute: vi.fn(),
	};
});

/** Captured central authorization admission used by route-coordinate assertions. */
const _authorization = vi.hoisted(function _CreateAuthorizationState()
{
	return { admit: vi.fn().mockResolvedValue({ outcome: "allow", evidence: { decisionDigest: `sha256:${"d".repeat(64)}` } }), reconcile: vi.fn().mockResolvedValue(0) };
});

vi.mock("@opencrane/backend/observability", function _ObservabilityMock()
{
	return { ___DoWithTrace: _trace.doWithTrace, ___GetActiveSpan: function _GetActiveSpan() { return { setAttribute: _trace.setAttribute }; } };
});

vi.mock("@opencrane/backend/server/iam/authorization", function _AuthorizationMock()
{
	return {
		PrismaAuthorizationAuthority: class { async admit(command: unknown) { return _authorization.admit(command); } },
		PrismaManagedAuthorizationGrantRepository: class { async reconcileManagedResourceGrants(command: unknown) { return _authorization.reconcile(command); } },
	};
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
	return { digest: `sha256:${"a".repeat(64)}`, subjectId: "user-1", principalId: "principal-1", siloId: "silo-1", conversationId: "conversation-1", agentServiceId: "service-1", action: "events.read", membershipRevision: 1, nowEpochMs: 1_000, expiresAtEpochMs: 2_000, allowedRouteHostSuffixes: [".svc.cluster.local"], receiverId: "receiver-1" } as never;
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
	beforeEach(function _ResetAuthorizationCalls()
	{
		vi.clearAllMocks();
	});

	it("projects only open agent-session coordinates and active participants", async function _ProjectsConversation()
	{
		const repository = new PrismaChannelTargetAuthorityUnitOfWork(_Prisma({ conversation: { findUnique: vi.fn().mockResolvedValue(_Conversation()) }, principal: { findMany: vi.fn().mockResolvedValue([{ id: "principal-1", subject: "user-1" }]) } }));
		await expect(repository.getConversationAuthority("conversation-1", "user-1")).resolves.toEqual({ conversationId: "conversation-1", siloId: "silo-1", agentServiceId: "service-1", mode: "agent_session", lifecycle: "open", participantUserIds: ["user-1"], participantPrincipalId: "principal-1" });
	});

	it("reconciles distinct route rows for two services sharing one stable receiver", async function _ReconcilesTwoServices()
	{
		const updateMany = vi.fn().mockResolvedValue({ count: 0 });
		const upsert = vi.fn()
			.mockResolvedValueOnce({ id: "route-1", siloId: "silo-1", agentServiceId: "service-1" })
			.mockResolvedValueOnce({ id: "route-2", siloId: "silo-1", agentServiceId: "service-2" });
		const prisma = _Prisma({
			agentService: { findMany: vi.fn().mockResolvedValue([{ id: "service-1", siloId: "silo-1" }, { id: "service-2", siloId: "silo-1" }]) },
			channelRuntimeRoute: { findMany: vi.fn().mockResolvedValue([]), updateMany, upsert },
			conversation: { findMany: vi.fn().mockResolvedValue([]) },
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
			conversation: { findUnique: vi.fn().mockResolvedValue(_Conversation()), findMany: vi.fn().mockResolvedValue([{ participants: [{ userId: "user-1" }] }]) },
			principal: { findMany: vi.fn().mockResolvedValue([{ id: "principal-1", subject: "user-1" }]) },
			agentService: { findFirst: vi.fn().mockResolvedValue({ id: "service-1" }) },
			channelRuntimeRoute: { findMany: vi.fn().mockResolvedValue([_Route()]) },
			channelInvocationContext: { create: vi.fn().mockResolvedValue({ id: "context-1" }) },
		};
		const repository = new PrismaChannelTargetAuthorityUnitOfWork(_Prisma(transaction));

		await expect(repository.issueInvocationContextAtomically(_IssueCommand())).resolves.toEqual({ status: "issued", context: { id: "context-1", routeId: "route-1", receiverId: "receiver-1", endpoint: "http://runtime.svc.cluster.local/events" } });
		expect(transaction.channelRuntimeRoute.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ receiverId: "receiver-1", agentServiceId: "service-1" }) }));
		expect(_authorization.admit).toHaveBeenLastCalledWith({ siloId: "silo-1", principalId: "principal-1", actorKind: "user", actorId: "principal-1", boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId: "principal-1" }, resource: { kind: ProductAuthorizationResourceKinds.ChannelTarget, id: "route-1" }, action: ProductAuthorizationActions.Send, argumentsDigest: ___DigestCanonicalJson({ action: "events.read", agentServiceId: "service-1", conversationId: "conversation-1", receiverId: "receiver-1", routeId: "route-1" }), membershipRevision: 1, nowEpochMs: 1_000 });
		expect(transaction.channelInvocationContext.create).toHaveBeenCalledWith({ data: expect.objectContaining({ conversationId: "conversation-1", routeId: "route-1", receiverId: "receiver-1" }) });
	});

	it("fails closed when the participant has no exact grant for the selected route", async function _RejectsMissingRouteGrant()
	{
		_authorization.admit.mockResolvedValueOnce({ outcome: "deny", evidence: null });
		const transaction = {
			conversation: { findUnique: vi.fn().mockResolvedValue(_Conversation()), findMany: vi.fn().mockResolvedValue([{ participants: [{ userId: "user-1" }] }]) },
			principal: { findMany: vi.fn().mockResolvedValue([{ id: "principal-1", subject: "user-1" }]) },
			agentService: { findFirst: vi.fn().mockResolvedValue({ id: "service-1" }) },
			channelRuntimeRoute: { findMany: vi.fn().mockResolvedValue([_Route()]) },
			channelInvocationContext: { create: vi.fn() },
		};
		const repository = new PrismaChannelTargetAuthorityUnitOfWork(_Prisma(transaction));

		await expect(repository.issueInvocationContextAtomically(_IssueCommand())).resolves.toEqual({ status: "participant_conflict" });
		expect(transaction.channelInvocationContext.create).not.toHaveBeenCalled();
	});

	it("rotates grants from a retired route onto only current Agent-session participants", async function _RotatesExactParticipantGrants()
	{
		const retired = { id: "route-old", siloId: "silo-1", agentServiceId: "service-1" };
		const transaction = {
			agentService: { findMany: vi.fn().mockResolvedValue([{ id: "service-1", siloId: "silo-1" }]) },
			channelRuntimeRoute: {
				findMany: vi.fn().mockResolvedValueOnce([retired]),
				updateMany: vi.fn().mockResolvedValue({ count: 1 }),
				upsert: vi.fn().mockResolvedValue({ id: "route-new", siloId: "silo-1", agentServiceId: "service-1" }),
			},
			conversation: { findMany: vi.fn().mockResolvedValue([{ participants: [{ userId: "user-1" }] }]) },
			principal: { findMany: vi.fn().mockResolvedValue([{ id: "principal-1", subject: "user-1" }]) },
		};
		const repository = new PrismaChannelTargetAuthorityUnitOfWork(_Prisma(transaction));

		await expect(repository.reconcileRuntimeRoutes({ receiverId: "receiver-1", endpoint: "http://runtime.svc.cluster.local/events", action: "events.read", allowedRouteHostSuffixes: [".svc.cluster.local"] })).resolves.toBe(1);
		expect(_authorization.reconcile).toHaveBeenNthCalledWith(1, expect.objectContaining({ resource: { kind: ProductAuthorizationResourceKinds.ChannelTarget, id: "route-old" }, grants: [] }));
		expect(_authorization.reconcile).toHaveBeenNthCalledWith(2, expect.objectContaining({ resource: { kind: ProductAuthorizationResourceKinds.ChannelTarget, id: "route-new" }, grants: [expect.objectContaining({ subject: { kind: "principal", principalId: "principal-1" } })] }));
	});

	it("fails route reconciliation when a current participant Principal is ambiguous", async function _RejectsAmbiguousParticipantProjection()
	{
		const transaction = {
			agentService: { findMany: vi.fn().mockResolvedValue([{ id: "service-1", siloId: "silo-1" }]) },
			channelRuntimeRoute: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 0 }), upsert: vi.fn().mockResolvedValue({ id: "route-1", siloId: "silo-1", agentServiceId: "service-1" }) },
			conversation: { findMany: vi.fn().mockResolvedValue([{ participants: [{ userId: "user-1" }] }]) },
			principal: { findMany: vi.fn().mockResolvedValue([{ id: "principal-1", subject: "user-1" }, { id: "principal-2", subject: "user-1" }]) },
		};
		const repository = new PrismaChannelTargetAuthorityUnitOfWork(_Prisma(transaction));

		await expect(repository.reconcileRuntimeRoutes({ receiverId: "receiver-1", endpoint: "http://runtime.svc.cluster.local/events", action: "events.read", allowedRouteHostSuffixes: [".svc.cluster.local"] })).rejects.toThrow("unavailable or ambiguous");
		expect(_authorization.reconcile).not.toHaveBeenCalled();
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
