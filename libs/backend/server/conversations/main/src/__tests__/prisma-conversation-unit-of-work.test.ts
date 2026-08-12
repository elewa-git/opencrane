import { AgentRunState, ConversationLifecycle, ConversationMessageRole, ConversationMessageState, ConversationMode } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { ConversationModes, MessageContentBlockKinds, MessageSources } from "@opencrane/models/conversations";
import { __DecodeConversationProjectionCursor } from "@opencrane/backend/conversations/projection";

import { PrismaConversationUnitOfWork } from "../prisma-conversation-unit-of-work.js";
import type { ConversationMessageAdmissionUnitOfWork } from "../conversation-message-admission.types.js";
import type { SubmitConversationMessageRequest } from "../conversation-authority.types.js";

/** Fixed caller and message request reused across authority assertions. */
const _CALLER = { siloId: "silo-1", subjectId: "user-1" } as const;
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
	return { findFirst: vi.fn().mockResolvedValue({ clusterTenant: "silo-1" }) };
}

/** Builds one participant row whose aggregate can be projected as conversation detail. */
function _Participant(lifecycle: ConversationLifecycle = ConversationLifecycle.Open): object
{
	return { visibleFromPosition: 1n, accessEndedPosition: null, archivedAt: null, readThroughPosition: 0n, conversation: { id: "conversation-1", mode: ConversationMode.Direct, lifecycle, agentServiceId: null, updatedAt: new Date("2026-08-10T10:00:00.000Z"), participants: [{ userId: "user-1" }, { userId: "user-2" }] } };
}

/** Creates the aggregate authority with a replaceable message-admission collaborator. */
function _Authority(prisma: object, messageAdmission: Partial<ConversationMessageAdmissionUnitOfWork> = {}): PrismaConversationUnitOfWork
{
	return new PrismaConversationUnitOfWork(prisma as never, messageAdmission as ConversationMessageAdmissionUnitOfWork);
}

describe("PrismaConversationUnitOfWork", function _Suite()
{
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

		expect(snapshot).toMatchObject({ latestPosition: "150", representedThroughPosition: "100", messageCount: 150, unreadMessageCount: 60, participantUserIds: ["user-1"], runs: [{ ordinal: 105, state: "retrying" }] });
		expect(__DecodeConversationProjectionCursor(snapshot?.cursor)).toEqual({ conversationId: "child-1", position: "100" });
		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { position: "asc" }, take: 100 }));
		expect(transaction.conversationAgentThread.findFirst).toHaveBeenCalledWith(expect.objectContaining({ include: expect.objectContaining({ deliveries: expect.objectContaining({ take: 100 }), childConversation: expect.objectContaining({ select: expect.objectContaining({ runs: expect.objectContaining({ take: 100 }) }) }) }) }));
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
			orgMembership: { count: vi.fn().mockResolvedValue(2), findFirst: vi.fn().mockResolvedValue({ clusterTenant: "silo-1" }) },
			conversation: { create: createConversation },
			conversationParticipant: { create: createParticipant, findFirst: vi.fn().mockResolvedValue(_Participant()) },
			conversationTimelineEntry: { findMany: vi.fn().mockResolvedValue([]) },
		};
		const prisma = _Prisma(transaction) as { readonly $transaction: ReturnType<typeof vi.fn> };

		await expect(_Authority(prisma).create(_CALLER, { mode: ConversationModes.Direct, participantUserIds: ["user-2"] })).resolves.toEqual(expect.objectContaining({ outcome: "created", conversation: expect.objectContaining({ id: "conversation-1", mode: ConversationModes.Direct }) }));
		expect(prisma.$transaction).toHaveBeenCalledTimes(1);
		expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
		expect(createConversation).toHaveBeenCalledWith({ data: expect.objectContaining({ siloId: "silo-1", mode: ConversationMode.Direct, agentServiceId: null }) });
		expect(createParticipant).toHaveBeenCalledTimes(2);
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

	it("rolls back by throwing when a written conversation cannot be projected", async function _RejectsMissingWriteProjection()
	{
		const transaction = {
			orgMembership: { count: vi.fn().mockResolvedValue(2), findFirst: vi.fn().mockResolvedValue({ clusterTenant: "silo-1" }) },
			conversation: { create: vi.fn().mockResolvedValue({}) },
			conversationParticipant: { create: vi.fn().mockResolvedValue({}), findFirst: vi.fn().mockResolvedValue(null) },
		};

		await expect(_Authority(_Prisma(transaction)).create(_CALLER, { mode: ConversationModes.Direct, participantUserIds: ["user-2"] })).rejects.toThrow("Written conversation projection unavailable");
	});
});
