import { AgentRunState, ConversationLifecycle, ConversationMessageRole, ConversationMessageState, ConversationMode } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationModes, MessageContentBlockKinds, MessageSources } from "@opencrane/models/conversations";
import type { RunRetryAuthority } from "@opencrane/backend/agents/execution/runs";
import { __DecodeConversationProjectionCursor } from "@opencrane/backend/conversations/projection";

import { PrismaConversationUnitOfWork } from "../db/prisma-conversation-unit-of-work";
import type { ConversationMessageAdmissionUnitOfWork } from "../conversation-message-admission.types";
import type { SubmitConversationMessageRequest } from "../types/conversation-request.types";

const _channelProjection = vi.hoisted(function _CreateChannelProjectionState()
{
	return { reconcileConversation: vi.fn().mockResolvedValue(0) };
});

vi.mock("@opencrane/backend/server/agents/channel-targets", function _MockChannelTargets()
{
	return { PrismaChannelTargetParticipantGrantProjectionRepository: class { async reconcileConversation(...argumentsList: unknown[]) { return _channelProjection.reconcileConversation(...argumentsList); } } };
});

vi.mock("@opencrane/backend/server/iam/authorization", function _MockAuthorization()
{
	return {
		PrismaAuthorizationAuthority: class
		{
			async admitPrincipal() { return { outcome: "allow", evidence: { decisionDigest: "digest" } }; }
			async listPrincipalEntitled(command: { readonly resources: readonly object[] }) { return command.resources; }
		},
		PrismaManagedAuthorizationGrantRepository: class
		{
			async reconcileManagedResourceGrants() { return undefined; }
		},
	};
});

/** Fixed caller and message request reused across authority assertions. */
const _CALLER = { siloId: "silo-1", principalId: "principal-1", issuer: "https://issuer.test", subjectId: "user-1" } as const;
const _REQUEST: SubmitConversationMessageRequest = { idempotencyKey: "request-1", blocks: [{ id: "block-1", kind: MessageContentBlockKinds.Text, value: "Hello" }] };

/** Builds a canonical persisted message timeline row. */
function _Entry(): object
{
	return { position: 2n, message: { id: "message-1", role: ConversationMessageRole.User, state: ConversationMessageState.Completed, source: MessageSources.UserInput, blocks: _REQUEST.blocks, runId: null, userId: "user-1", createdAt: new Date("2026-08-10T10:00:00.000Z"), completedAt: new Date("2026-08-10T10:00:00.000Z") } };
}

/** Builds the root client facade around one transaction-shaped test double. */
function _Prisma(transaction: Record<string, unknown>): object
{
	return { $transaction: vi.fn(async function _Transaction(work) { return work(transaction); }) };
}

/** Builds the active organisation-membership delegate required by every self authority snapshot. */
function _ActiveMembership(): object
{
	const rows = [{ id: "member-1", subject: "user-1" }, { id: "member-2", subject: "user-2" }];
	return { findFirst: vi.fn().mockResolvedValue({ id: "member-1", clusterTenant: "silo-1" }), findMany: vi.fn(async function _Memberships(command: { readonly where?: { readonly id?: { readonly in?: readonly string[] }; readonly subject?: { readonly in?: readonly string[] } } })
	{
		const ids = command.where?.id?.in;
		if (ids !== undefined) return rows.filter(function _Id(row): boolean { return ids.includes(row.id); });
		const subjects = command.where?.subject?.in;
		if (subjects !== undefined) return rows.filter(function _Subject(row): boolean { return subjects.includes(row.subject); });
		return rows;
	}) };
}

/** Builds one participant row whose aggregate can be projected as conversation detail. */
function _Participant(lifecycle: ConversationLifecycle = ConversationLifecycle.Open): object
{
	return { visibleFromPosition: 1n, accessEndedPosition: null, archivedAt: null, readThroughPosition: 0n, conversation: { id: "conversation-1", mode: ConversationMode.Direct, lifecycle, agentServiceId: null, updatedAt: new Date("2026-08-10T10:00:00.000Z"), participants: [{ userId: "user-1" }, { userId: "user-2" }] } };
}

/** Creates the aggregate authority with a replaceable message-admission collaborator. */
function _Authority(prisma: object, messageAdmission: Partial<ConversationMessageAdmissionUnitOfWork> = {}, runRetry: RunRetryAuthority = { retry: vi.fn().mockResolvedValue({ outcome: "denied", reason: "run_not_found" }) }): PrismaConversationUnitOfWork
{
	return new PrismaConversationUnitOfWork(prisma as never, messageAdmission as ConversationMessageAdmissionUnitOfWork, runRetry);
}

describe("PrismaConversationUnitOfWork", function _Suite()
{
	beforeEach(function _ResetChannelProjection()
	{
		vi.clearAllMocks();
	});

	it("returns opaque creation references and one caller-owned personal Agent", async function _ProjectsDirectory()
	{
		const transaction = {
			orgMembership: _ActiveMembership(),
			principal: { findMany: vi.fn().mockResolvedValue([{ id: "principal-1", subject: "user-1" }, { id: "principal-2", subject: "user-2" }]) },
			personaProfile: { findUnique: vi.fn().mockResolvedValue({ activeRevisionId: "persona-1" }) },
			agentService: { findMany: vi.fn().mockResolvedValue([{ id: "service-1", name: "My Agent" }]) },
		};

		await expect(_Authority(_Prisma(transaction)).directory(_CALLER)).resolves.toEqual({ participants: [{ participantRef: "member-1", isSelf: true }, { participantRef: "member-2", isSelf: false }], personalAgentStatus: "ready", personalAgent: { personalAgentRef: "service-1", displayName: "My Agent" } });
	});

	it("fails closed instead of choosing between matching personal Agents", async function _RejectsAmbiguousAgent()
	{
		const transaction = {
			orgMembership: _ActiveMembership(),
			principal: { findMany: vi.fn().mockResolvedValue([{ id: "principal-1", subject: "user-1" }, { id: "principal-2", subject: "user-2" }]) },
			personaProfile: { findUnique: vi.fn().mockResolvedValue({ activeRevisionId: "persona-1" }) },
			agentService: { findMany: vi.fn().mockResolvedValue([{ id: "service-1", name: "First" }, { id: "service-2", name: "Second" }]) },
		};

		await expect(_Authority(_Prisma(transaction)).directory(_CALLER)).resolves.toMatchObject({ personalAgentStatus: "ambiguous", personalAgent: null });
	});

	it("opens participant history inside one repeatable-read snapshot", async function _OpensInSnapshot()
	{
		const transaction = {
			orgMembership: _ActiveMembership(),
			conversationParticipant: { findFirst: vi.fn().mockResolvedValue({ visibleFromPosition: 1n, accessEndedPosition: 4n, archivedAt: null, readThroughPosition: 0n, conversation: { id: "conversation-1", mode: ConversationMode.Direct, lifecycle: ConversationLifecycle.Open, agentServiceId: null, updatedAt: new Date("2026-08-10T10:00:00.000Z"), participants: [{ userId: "user-1" }, { userId: "user-2" }] } }) },
			conversationTimelineEntry: { findMany: vi.fn().mockResolvedValue([]) },
		};
		const execute = vi.fn(async function _Transaction(work) { return work(transaction); });
		const authority = _Authority({ $transaction: execute });

		await expect(authority.open(_CALLER, "conversation-1")).resolves.toEqual(expect.objectContaining({ id: "conversation-1", accessEndedPosition: "4" }));
		expect(execute).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead" });
		expect(transaction.conversationTimelineEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ position: { gte: 1n, lte: 4n } }) }));
	});

	it("fails closed when persistence contains a message source outside the model vocabulary", async function _RejectsUnknownSource()
	{
		const entry = _Entry() as { readonly position: bigint; readonly message: Record<string, unknown> };
		const transaction = {
			orgMembership: _ActiveMembership(),
			conversationParticipant: { findFirst: vi.fn().mockResolvedValue(_Participant()) },
			conversationTimelineEntry: { findMany: vi.fn().mockResolvedValue([{ ...entry, message: { ...entry.message, source: "future_unreviewed_source" } }]) },
		};

		await expect(_Authority(_Prisma(transaction)).open(_CALLER, "conversation-1")).rejects.toThrow("Persisted conversation message source is unsupported");
	});

	it("delegates message admission without opening an aggregate transaction", async function _DelegatesMessageAdmission()
	{
		const submit = vi.fn().mockResolvedValue({ outcome: "denied", reason: "conversation_unavailable" });
		const transaction = vi.fn();
		const authority = _Authority({ $transaction: transaction }, { submit } as never);

		await expect(authority.submitMessage(_CALLER, "conversation-1", _REQUEST)).resolves.toEqual({ outcome: "denied", reason: "conversation_unavailable" });
		expect(submit).toHaveBeenCalledWith(_CALLER, "conversation-1", _REQUEST);
		expect(transaction).not.toHaveBeenCalled();
	});

	it("delegates retries through the injected run authority without opening an aggregate transaction", async function _DelegatesRunRetry()
	{
		const retry = vi.fn().mockResolvedValue({ outcome: "started", run: { id: "run-1", attempt: 2 } });
		const transaction = vi.fn();
		const authority = _Authority({ $transaction: transaction }, {}, { retry } as never);

		await expect(authority.retryRun(_CALLER, "conversation-1", "run-1", { expectedAttempt: 1 })).resolves.toMatchObject({ outcome: "started", run: { attempt: 2 } });
		expect(retry).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-1", expectedAttempt: 1, siloId: "silo-1", conversationId: "conversation-1", requestedBy: "user-1" }));
		expect(transaction).not.toHaveBeenCalled();
	});

	it("returns the active-run closure conflict only after a durable foreground-run check", async function _RefusesCloseWithRun()
	{
		const transaction = {
			orgMembership: _ActiveMembership(),
			conversation: { findFirst: vi.fn().mockResolvedValue({ mode: ConversationMode.AgentSession, lifecycle: ConversationLifecycle.Open, agentServiceId: "service-1", runs: [{ id: "run-active" }] }), updateMany: vi.fn() },
		};
		await expect(_Authority(_Prisma(transaction)).close(_CALLER, "conversation-1")).resolves.toEqual({ outcome: "denied", reason: "active_run" });
		expect(transaction.conversation.updateMany).not.toHaveBeenCalled();
	});

	it("does not let an access-ended participant close the shared conversation", async function _RejectsRemovedParticipantClose()
	{
		const transaction = {
			orgMembership: _ActiveMembership(),
			conversation: { findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn() },
		};
		await expect(_Authority(_Prisma(transaction)).close(_CALLER, "conversation-1")).resolves.toEqual({ outcome: "denied", reason: "conversation_unavailable" });
		expect(transaction.conversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ participants: { some: { userId: "user-1", accessEndedPosition: null } } }) }));
		expect(transaction.conversation.updateMany).not.toHaveBeenCalled();
	});

	it("fails list and open closed when active organisation membership is revoked", async function _RejectsRevokedReads()
	{
		const participants = { findMany: vi.fn(), findFirst: vi.fn() };
		const transaction = { orgMembership: { findFirst: vi.fn().mockResolvedValue(null) }, conversationParticipant: participants };
		const authority = _Authority(_Prisma(transaction));

		await expect(authority.list(_CALLER, false)).resolves.toEqual([]);
		await expect(authority.open(_CALLER, "conversation-1")).resolves.toBeNull();
		expect(participants.findMany).not.toHaveBeenCalled();
		expect(participants.findFirst).not.toHaveBeenCalled();
	});

	it("does not open a child Agent session after parent participant access ends", async function _RejectsParentAccessEnd()
	{
		const findFirst = vi.fn().mockResolvedValue(null);
		const transaction = { orgMembership: _ActiveMembership(), conversationParticipant: { findFirst } };

		await expect(_Authority(_Prisma(transaction)).open(_CALLER, "child-1")).resolves.toBeNull();
		expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ conversationId: "child-1", conversation: expect.objectContaining({ OR: expect.arrayContaining([{ originAgentThread: { is: { parentConversation: { participants: { some: { userId: "user-1", accessEndedPosition: null } } } } } }]) }) }) }));
	});

	it("opens a bounded Agent thread without advancing its cursor past omitted events", async function _OpensBoundedAgentThread()
	{
		const entries = Array.from({ length: 100 }, function _Timeline(_, index)
		{
			const entry = _Entry() as { readonly message: Record<string, unknown> };
			return { position: BigInt(index + 1), message: { ...entry.message, id: `message-${index + 1}`, invokedAgentThread: null } };
		});
		const findMany = vi.fn().mockResolvedValue(entries);
		const findFirst = vi.fn().mockResolvedValue({ position: 150n });
		const transaction = {
			orgMembership: _ActiveMembership(),
			conversationAgentThread: { findFirst: vi.fn().mockResolvedValue({
				rootConversationId: "parent-1", parentMessageId: "parent-message-1", initiatorUserId: "user-1", agentServiceId: "service-1", createdAt: new Date("2026-08-10T10:00:00.000Z"),
				parentMessage: { blocks: _REQUEST.blocks, createdAt: new Date("2026-08-10T10:00:00.000Z") },
				parentConversation: { participants: [{ userId: "user-1" }] },
				childConversation: { lifecycle: ConversationLifecycle.Open, service: { name: "Research Agent" }, _count: { messages: 150, runs: 105 }, participants: [{ userId: "user-1", readThroughPosition: 90n }, { userId: "removed-user", readThroughPosition: 0n }], runs: [{ id: "run-105", attempt: 2, state: AgentRunState.RecoveryRequired, acceptedAt: new Date("2026-08-10T10:05:00.000Z"), finishedAt: null }] },
				deliveries: [],
			}) },
			conversationTimelineEntry: { findMany, findFirst, count: vi.fn().mockResolvedValue(60) },
		};

		const snapshot = await _Authority(_Prisma(transaction)).openAgentThread(_CALLER, "parent-1", "child-1");

		expect(snapshot).toMatchObject({ latestPosition: "150", representedThroughPosition: "100", messageCount: 150, unreadMessageCount: 60, participantCount: 1, runs: [{ ordinal: 105, state: "retrying" }] });
		expect(snapshot).not.toHaveProperty("initiatorUserId");
		expect(snapshot).not.toHaveProperty("participantUserIds");
		expect(__DecodeConversationProjectionCursor(snapshot?.cursor)).toEqual({ conversationId: "child-1", position: "100" });
		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { position: "asc" }, take: 100 }));
		expect(transaction.conversationTimelineEntry.count).toHaveBeenCalledWith({ where: { conversationId: "child-1", messageId: { not: null }, message: { is: { role: { in: [ConversationMessageRole.User, ConversationMessageRole.Assistant] } } }, position: { gt: 90n } } });
		expect(transaction.conversationAgentThread.findFirst).toHaveBeenCalledWith(expect.objectContaining({ include: expect.objectContaining({ deliveries: expect.objectContaining({ take: 100 }), childConversation: expect.objectContaining({ select: expect.objectContaining({ runs: expect.objectContaining({ take: 100 }) }) }) }) }));
	});

	it("keeps a stream-only event behind the Agent-thread snapshot cursor", async function _KeepsStreamOnlyEventVisible()
	{
		const first = { position: 1n, messageId: "message-1", message: { ...(_Entry() as { readonly message: Record<string, unknown> }).message, id: "message-1", invokedAgentThread: null } };
		const streamOnly = { position: 2n, messageId: null, message: null };
		const later = { position: 3n, messageId: "message-3", message: { ...(_Entry() as { readonly message: Record<string, unknown> }).message, id: "message-3", invokedAgentThread: null } };
		const transaction = {
			orgMembership: _ActiveMembership(),
			conversationAgentThread: { findFirst: vi.fn().mockResolvedValue({
				rootConversationId: "parent-1", parentMessageId: "parent-message-1", agentServiceId: "service-1", createdAt: new Date("2026-08-10T10:00:00.000Z"),
				parentMessage: { blocks: _REQUEST.blocks, createdAt: new Date("2026-08-10T10:00:00.000Z") }, parentConversation: { participants: [{ userId: "user-1" }] }, deliveries: [],
				childConversation: { lifecycle: ConversationLifecycle.Open, service: { name: "Research Agent" }, _count: { messages: 2, runs: 1 }, participants: [{ userId: "user-1", readThroughPosition: 0n }], runs: [] },
			}) },
			conversationTimelineEntry: { findMany: vi.fn().mockResolvedValue([first, streamOnly, later]), findFirst: vi.fn().mockResolvedValue({ position: 3n }), count: vi.fn().mockResolvedValue(2) },
		};

		const snapshot = await _Authority(_Prisma(transaction)).openAgentThread(_CALLER, "parent-1", "child-1");

		expect(snapshot?.messages).toHaveLength(2);
		expect(snapshot?.representedThroughPosition).toBe("1");
		expect(__DecodeConversationProjectionCursor(snapshot?.cursor)).toEqual({ conversationId: "child-1", position: "1" });
		expect(transaction.conversationTimelineEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { conversationId: "child-1" } }));
	});

	it("advances one Agent-thread read coordinate monotonically", async function _MarksRead()
	{
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { orgMembership: _ActiveMembership(), conversationAgentThread: { findFirst: vi.fn().mockResolvedValue({ childConversation: { participants: [{ readThroughPosition: 3n }] } }) }, conversationTimelineEntry: { findFirst: vi.fn().mockResolvedValue({ position: 6n }) }, conversationParticipant: { updateMany } };

		await expect(_Authority(_Prisma(transaction)).markAgentThreadRead(_CALLER, "parent-1", "child-1", "5")).resolves.toEqual({ outcome: "changed", readThroughPosition: "5" });
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ conversationId: "child-1", userId: "user-1", readThroughPosition: { lt: 5n }, conversation: expect.objectContaining({ originAgentThread: { is: expect.objectContaining({ parentConversationId: "parent-1" }) } }) }), data: { readThroughPosition: 5n } }));
	});

	it("keeps stale Agent-thread read repeats idempotent", async function _StaleRead()
	{
		const updateMany = vi.fn();
		const transaction = { orgMembership: _ActiveMembership(), conversationAgentThread: { findFirst: vi.fn().mockResolvedValue({ childConversation: { participants: [{ readThroughPosition: 5n }] } }) }, conversationTimelineEntry: { findFirst: vi.fn().mockResolvedValue({ position: 6n }) }, conversationParticipant: { updateMany } };

		await expect(_Authority(_Prisma(transaction)).markAgentThreadRead(_CALLER, "parent-1", "child-1", "3")).resolves.toEqual({ outcome: "idempotent", readThroughPosition: "5" });
		expect(updateMany).not.toHaveBeenCalled();
	});

	it("rejects foreign, access-ended, and future Agent-thread read coordinates", async function _RejectsReadEscalation()
	{
		const thread = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce({ childConversation: { participants: [{ readThroughPosition: 2n }] } });
		const timeline = vi.fn().mockResolvedValue({ position: 5n });
		const transaction = { orgMembership: _ActiveMembership(), conversationAgentThread: { findFirst: thread }, conversationTimelineEntry: { findFirst: timeline }, conversationParticipant: { updateMany: vi.fn() } };
		const authority = _Authority(_Prisma(transaction));

		await expect(authority.markAgentThreadRead(_CALLER, "foreign-parent", "child-1", "2")).resolves.toEqual({ outcome: "denied", reason: "conversation_unavailable" });
		await expect(authority.markAgentThreadRead(_CALLER, "parent-1", "child-1", "2")).resolves.toEqual({ outcome: "denied", reason: "conversation_unavailable" });
		await expect(authority.markAgentThreadRead(_CALLER, "parent-1", "child-1", "6")).resolves.toEqual({ outcome: "denied", reason: "observed_position_unavailable" });
		expect(thread).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ parentConversation: { participants: { some: { userId: "user-1", accessEndedPosition: null } } }, childConversation: { participants: { some: { userId: "user-1", accessEndedPosition: null } } } }) }));
		expect(transaction.conversationParticipant.updateMany).not.toHaveBeenCalled();
	});

	it("orders visible conversations by the database-global activity allocation", async function _OrdersByGlobalActivity()
	{
		const findMany = vi.fn().mockResolvedValue([]);
		const transaction = { orgMembership: _ActiveMembership(), conversationParticipant: { findMany } };

		await expect(_Authority(_Prisma(transaction)).list(_CALLER, false)).resolves.toEqual([]);
		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: [{ conversation: { activitySequence: "desc" } }, { conversationId: "desc" }] }));
	});

	it("fails archive and close closed after membership revocation", async function _RejectsRevokedMutations()
	{
		const updateParticipant = vi.fn();
		const updateConversation = vi.fn();
		const transaction = {
			orgMembership: { findFirst: vi.fn().mockResolvedValue(null) },
			conversationParticipant: { updateMany: updateParticipant },
			conversation: { findFirst: vi.fn(), updateMany: updateConversation },
		};
		const authority = _Authority(_Prisma(transaction));

		await expect(authority.setArchived(_CALLER, "conversation-1", true)).resolves.toEqual({ outcome: "denied", reason: "conversation_unavailable" });
		await expect(authority.close(_CALLER, "conversation-1")).resolves.toEqual({ outcome: "denied", reason: "conversation_unavailable" });
		expect(updateParticipant).not.toHaveBeenCalled();
		expect(updateConversation).not.toHaveBeenCalled();
	});

	it("creates a direct conversation and projects it in one serializable unit of work", async function _CreatesConversation()
	{
		const createConversation = vi.fn().mockResolvedValue({});
		const createParticipant = vi.fn().mockResolvedValue({});
		const transaction = {
			orgMembership: _ActiveMembership(),
			conversation: { create: createConversation },
			principal: { findMany: vi.fn().mockResolvedValue([{ id: "principal-1", subject: "user-1" }, { id: "principal-2", subject: "user-2" }]) },
			conversationParticipant: { create: createParticipant, findFirst: vi.fn().mockResolvedValue(_Participant()) },
			conversationTimelineEntry: { findMany: vi.fn().mockResolvedValue([]) },
		};
		const prisma = _Prisma(transaction) as { readonly $transaction: ReturnType<typeof vi.fn> };

		await expect(_Authority(prisma).create(_CALLER, { mode: ConversationModes.Direct, participantRefs: ["member-2"] })).resolves.toEqual(expect.objectContaining({ outcome: "created", conversation: expect.objectContaining({ id: "conversation-1", mode: ConversationModes.Direct, participantRefs: ["member-1", "member-2"] }) }));
		expect(prisma.$transaction).toHaveBeenCalledTimes(1);
		expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
		expect(createConversation).toHaveBeenCalledWith({ data: expect.objectContaining({ siloId: "silo-1", mode: ConversationMode.Direct, agentServiceId: null }) });
		expect(createParticipant).toHaveBeenCalledTimes(2);
		expect(_channelProjection.reconcileConversation).not.toHaveBeenCalled();
	});

	it("projects exact ChannelTarget grants with a new Agent-session participant relation", async function _ProjectsAgentSessionTarget()
	{
		const transaction = {
			orgMembership: _ActiveMembership(),
			personaProfile: { findUnique: vi.fn().mockResolvedValue({ id: "persona-profile-1", activeRevisionId: "persona-revision-1" }) },
			agentService: { findMany: vi.fn().mockResolvedValue([{ id: "service-1" }]) },
			conversation: { create: vi.fn().mockResolvedValue({}) },
			principal: { findMany: vi.fn().mockResolvedValue([{ id: "principal-1", subject: "user-1" }]) },
			conversationParticipant: { create: vi.fn().mockResolvedValue({}), findFirst: vi.fn().mockResolvedValue({ ..._Participant(), conversation: { ...(_Participant() as { readonly conversation: object }).conversation, mode: ConversationMode.AgentSession, agentServiceId: "service-1", participants: [{ userId: "user-1" }] } }) },
			conversationTimelineEntry: { findMany: vi.fn().mockResolvedValue([]) },
		};

		await expect(_Authority(_Prisma(transaction)).create(_CALLER, { mode: ConversationModes.AgentSession, personalAgentRef: "service-1" })).resolves.toMatchObject({ outcome: "created" });
		expect(_channelProjection.reconcileConversation).toHaveBeenCalledWith(expect.any(String), "silo-1", expect.any(Date));
	});

	it("archives a participant and projects the result in one serializable unit of work", async function _ArchivesConversation()
	{
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = {
			orgMembership: _ActiveMembership(),
			conversationParticipant: { updateMany, findFirst: vi.fn().mockResolvedValue({ ..._Participant(), archivedAt: new Date("2026-08-10T10:05:00.000Z") }) },
			conversationTimelineEntry: { findMany: vi.fn().mockResolvedValue([]) },
		};
		const prisma = _Prisma(transaction) as { readonly $transaction: ReturnType<typeof vi.fn> };

		await expect(_Authority(prisma).setArchived(_CALLER, "conversation-1", true)).resolves.toEqual(expect.objectContaining({ outcome: "changed", conversation: expect.objectContaining({ id: "conversation-1" }) }));
		expect(prisma.$transaction).toHaveBeenCalledTimes(1);
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ accessEndedPosition: null }) }));
	});

	it("closes through the command decision and projects the result in one serializable unit of work", async function _ClosesConversation()
	{
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = {
			orgMembership: _ActiveMembership(),
			conversation: { findFirst: vi.fn().mockResolvedValue({ mode: ConversationMode.Direct, lifecycle: ConversationLifecycle.Open, agentServiceId: null, runs: [] }), updateMany },
			conversationParticipant: { findFirst: vi.fn().mockResolvedValue(_Participant(ConversationLifecycle.Closed)) },
			conversationTimelineEntry: { findMany: vi.fn().mockResolvedValue([]) },
		};
		const prisma = _Prisma(transaction) as { readonly $transaction: ReturnType<typeof vi.fn> };

		await expect(_Authority(prisma).close(_CALLER, "conversation-1")).resolves.toEqual(expect.objectContaining({ outcome: "changed", conversation: expect.objectContaining({ lifecycle: "closed" }) }));
		expect(prisma.$transaction).toHaveBeenCalledTimes(1);
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ lifecycle: ConversationLifecycle.Open }), data: expect.objectContaining({ lifecycle: ConversationLifecycle.Closed }) }));
	});

	it("revokes stale ChannelTarget projections when an Agent session closes", async function _RevokesClosedAgentSessionTarget()
	{
		const transaction = {
			orgMembership: _ActiveMembership(),
			conversation: { findFirst: vi.fn().mockResolvedValue({ mode: ConversationMode.AgentSession, lifecycle: ConversationLifecycle.Open, agentServiceId: "service-1", runs: [] }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
			conversationParticipant: { findFirst: vi.fn().mockResolvedValue({ ..._Participant(ConversationLifecycle.Closed), conversation: { ...(_Participant(ConversationLifecycle.Closed) as { readonly conversation: object }).conversation, mode: ConversationMode.AgentSession, agentServiceId: "service-1" } }) },
			conversationTimelineEntry: { findMany: vi.fn().mockResolvedValue([]) },
		};

		await expect(_Authority(_Prisma(transaction)).close(_CALLER, "conversation-1")).resolves.toMatchObject({ outcome: "changed" });
		expect(_channelProjection.reconcileConversation).toHaveBeenCalledWith("conversation-1", "silo-1", expect.any(Date));
	});

	it("rolls back by throwing when a written conversation cannot be projected", async function _RejectsMissingWriteProjection()
	{
		const transaction = {
			orgMembership: _ActiveMembership(),
			conversation: { create: vi.fn().mockResolvedValue({}) },
			principal: { findMany: vi.fn().mockResolvedValue([{ id: "principal-1", subject: "user-1" }, { id: "principal-2", subject: "user-2" }]) },
			conversationParticipant: { create: vi.fn().mockResolvedValue({}), findFirst: vi.fn().mockResolvedValue(null) },
		};

		await expect(_Authority(_Prisma(transaction)).create(_CALLER, { mode: ConversationModes.Direct, participantRefs: ["member-2"] })).rejects.toThrow("Written conversation projection unavailable");
	});
});
