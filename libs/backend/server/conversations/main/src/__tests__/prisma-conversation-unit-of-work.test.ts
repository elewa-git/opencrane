import { AgentRunState, ConversationLifecycle, ConversationMessageRole, ConversationMessageState, ConversationMode } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PersonalRunAdmissionOutcomes } from "@opencrane/backend/agents/execution/admission";
import type { RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { ConversationModes, MessageContentBlockKinds } from "@opencrane/models/conversations";

import { PrismaConversationUnitOfWork } from "../prisma-conversation-unit-of-work.js";
import { PrismaConversationMutationRepository } from "../prisma-conversation-mutation-repository.js";
import type { SubmitConversationMessageRequest } from "../conversation-authority.types.js";

/** Fixed caller and message request reused across mode-strategy assertions. */
const _CALLER = { siloId: "silo-1", subjectId: "user-1" } as const;
const _REQUEST: SubmitConversationMessageRequest = { idempotencyKey: "request-1", blocks: [{ id: "block-1", kind: MessageContentBlockKinds.Text, value: "Hello" }] };

/** Builds a canonical persisted message timeline row. */
function _Entry(runId: string | null): object
{
	return { position: 2n, message: { id: "message-1", role: ConversationMessageRole.User, state: ConversationMessageState.Completed, source: "user_input", blocks: _REQUEST.blocks, runId, userId: "user-1", createdAt: new Date("2026-08-10T10:00:00.000Z"), completedAt: new Date("2026-08-10T10:00:00.000Z") } };
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

/** Creates the transaction-scoped mutation adapter used by run admission callbacks. */
function _CreateMutationRepository(transaction: RunAdmissionTransaction): PrismaConversationMutationRepository
{
	return new PrismaConversationMutationRepository(transaction.prisma);
}

describe("PrismaConversationUnitOfWork message admission", function _Suite()
{
	it("opens participant history inside one repeatable-read snapshot", async function _OpensInSnapshot()
	{
		const transaction = {
			orgMembership: _ActiveMembership(),
			conversationParticipant: { findFirst: vi.fn().mockResolvedValue({ visibleFromPosition: 1n, accessEndedPosition: 4n, archivedAt: null, readThroughPosition: 0n, conversation: { id: "conversation-1", mode: ConversationMode.Direct, lifecycle: ConversationLifecycle.Open, agentServiceId: null, updatedAt: new Date("2026-08-10T10:00:00.000Z"), participants: [{ userId: "user-1" }, { userId: "user-2" }] } }) },
			conversationTimelineEntry: { findMany: vi.fn().mockResolvedValue([]) },
		};
		const execute = vi.fn(async function _Transaction(work) { return work(transaction); });
		const authority = new PrismaConversationUnitOfWork({ $transaction: execute } as never, {} as never, _CreateMutationRepository);

		await expect(authority.open(_CALLER, "conversation-1")).resolves.toEqual(expect.objectContaining({ id: "conversation-1", accessEndedPosition: "4" }));
		expect(execute).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead" });
		expect(transaction.conversationTimelineEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ position: { gte: 1n, lte: 4n } }) }));
	});

	it("routes agent-session input through run admission and persists the message in its transaction", async function _AdmitsAgentMessage()
	{
		const create = vi.fn().mockResolvedValue({});
		const findFirst = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(_Entry("run-1"));
		const admitPersonalRun = vi.fn(async function _Admit(command, commit)
		{
			await commit({ prisma: { orgMembership: _ActiveMembership(), conversation: { findFirst: vi.fn().mockResolvedValue({ mode: ConversationMode.AgentSession, lifecycle: ConversationLifecycle.Open, agentServiceId: "service-1", runs: [{ id: "run-1" }] }) }, conversationMessage: { create } } }, { snapshot: { runId: "run-1" } });
			return { outcome: PersonalRunAdmissionOutcomes.Accepted, runId: "run-1" };
		});
		const transaction = {
			orgMembership: _ActiveMembership(),
			conversationTimelineEntry: { findFirst },
			conversation: { findFirst: vi.fn().mockResolvedValue({ mode: ConversationMode.AgentSession, lifecycle: ConversationLifecycle.Open, agentServiceId: "service-1", runs: [] }) },
		};
		const authority = new PrismaConversationUnitOfWork(_Prisma(transaction) as never, { admitPersonalRun } as never, _CreateMutationRepository);

		await expect(authority.submitMessage(_CALLER, "conversation-1", _REQUEST)).resolves.toEqual(expect.objectContaining({ outcome: "accepted", message: expect.objectContaining({ runId: "run-1", position: "2" }) }));
		expect(admitPersonalRun).toHaveBeenCalledWith(expect.objectContaining({ siloId: "silo-1", executionSubjectId: "user-1", conversationId: "conversation-1", requestIdempotencyKey: "request-1", inputMessageBlocks: _REQUEST.blocks, inputMessageId: expect.any(String) }), expect.any(Function));
		expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ conversationId: "conversation-1", runId: "run-1", userId: "user-1", idempotencyKey: "request-1", source: "user_input" }) });
	});

	it("persists direct input without creating an AgentRun", async function _AdmitsDirectMessage()
	{
		const create = vi.fn().mockResolvedValue({});
		const findFirst = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(_Entry(null));
		const context = { mode: ConversationMode.Direct, lifecycle: ConversationLifecycle.Open, agentServiceId: null, runs: [] };
		const transaction = { orgMembership: _ActiveMembership(), conversation: { findFirst: vi.fn().mockResolvedValue(context) }, conversationMessage: { create } };
		Object.assign(transaction, {
			conversationTimelineEntry: { findFirst },
		});
		const admitPersonalRun = vi.fn();
		const authority = new PrismaConversationUnitOfWork(_Prisma(transaction) as never, { admitPersonalRun } as never, _CreateMutationRepository);

		await expect(authority.submitMessage(_CALLER, "conversation-1", _REQUEST)).resolves.toEqual(expect.objectContaining({ outcome: "accepted", message: expect.objectContaining({ runId: null }) }));
		expect(admitPersonalRun).not.toHaveBeenCalled();
		expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ runId: null, role: ConversationMessageRole.User, state: ConversationMessageState.Completed }) });
	});

	it("rejects a second agent-session question while one foreground run is active", async function _RejectsActiveRun()
	{
		const admitPersonalRun = vi.fn();
		const transaction = {
			orgMembership: _ActiveMembership(),
			conversationTimelineEntry: { findFirst: vi.fn().mockResolvedValue(null) },
			conversation: { findFirst: vi.fn().mockResolvedValue({ mode: ConversationMode.AgentSession, lifecycle: ConversationLifecycle.Open, agentServiceId: "service-1", runs: [{ id: "run-active", state: AgentRunState.Running }] }) },
		};

		await expect(new PrismaConversationUnitOfWork(_Prisma(transaction) as never, { admitPersonalRun } as never, _CreateMutationRepository).submitMessage(_CALLER, "conversation-1", _REQUEST)).resolves.toEqual({ outcome: "denied", reason: "active_run" });
		expect(admitPersonalRun).not.toHaveBeenCalled();
	});

	it("does not misreport run-admission infrastructure refusal as an active run", async function _MapsAdmissionRefusal()
	{
		const transaction = {
			orgMembership: _ActiveMembership(),
			conversationTimelineEntry: { findFirst: vi.fn().mockResolvedValue(null) },
			conversation: { findFirst: vi.fn().mockResolvedValue({ mode: ConversationMode.AgentSession, lifecycle: ConversationLifecycle.Open, agentServiceId: "service-1", runs: [] }) },
		};
		const admission = { admitPersonalRun: vi.fn().mockResolvedValue({ outcome: PersonalRunAdmissionOutcomes.Denied, reason: "admission_concurrency_limited" }) };

		await expect(new PrismaConversationUnitOfWork(_Prisma(transaction) as never, admission as never, _CreateMutationRepository).submitMessage(_CALLER, "conversation-1", _REQUEST)).resolves.toEqual({ outcome: "denied", reason: "capacity_limited" });
	});

	it("maps execution admission's stable active-run denial without degrading it to persistence", async function _MapsAdmissionActiveRun()
	{
		const transaction = {
			orgMembership: _ActiveMembership(),
			conversationTimelineEntry: { findFirst: vi.fn().mockResolvedValue(null) },
			conversation: { findFirst: vi.fn().mockResolvedValue({ mode: ConversationMode.AgentSession, lifecycle: ConversationLifecycle.Open, agentServiceId: "service-1", runs: [] }) },
		};
		const admission = { admitPersonalRun: vi.fn().mockResolvedValue({ outcome: PersonalRunAdmissionOutcomes.Denied, reason: "active_run" }) };

		await expect(new PrismaConversationUnitOfWork(_Prisma(transaction) as never, admission as never, _CreateMutationRepository).submitMessage(_CALLER, "conversation-1", _REQUEST)).resolves.toEqual({ outcome: "denied", reason: "active_run" });
	});

	it("rejects a conversation-scoped idempotency key already owned by another participant", async function _RejectsForeignKey()
	{
		const context = { mode: ConversationMode.Direct, lifecycle: ConversationLifecycle.Open, agentServiceId: null, runs: [] };
		const transaction = { orgMembership: _ActiveMembership(), conversation: { findFirst: vi.fn().mockResolvedValue(context) }, conversationMessage: { create: vi.fn().mockRejectedValue(new Error("unique")) } };
		Object.assign(transaction, {
			conversationTimelineEntry: { findFirst: vi.fn().mockResolvedValue(null) },
			conversationMessage: { findFirst: vi.fn().mockResolvedValue({ id: "message-other" }) },
		});

		await expect(new PrismaConversationUnitOfWork(_Prisma(transaction) as never, {} as never, _CreateMutationRepository).submitMessage(_CALLER, "conversation-1", _REQUEST)).resolves.toEqual({ outcome: "denied", reason: "idempotency_conflict" });
	});

	it("returns the active-run closure conflict only after a durable foreground-run check", async function _RefusesCloseWithRun()
	{
		const transaction = {
			orgMembership: _ActiveMembership(),
			conversation: { findFirst: vi.fn().mockResolvedValue({ mode: ConversationMode.AgentSession, lifecycle: ConversationLifecycle.Open, agentServiceId: "service-1", runs: [{ id: "run-active" }] }), updateMany: vi.fn() },
		};
		await expect(new PrismaConversationUnitOfWork(_Prisma(transaction) as never, {} as never, _CreateMutationRepository).close(_CALLER, "conversation-1")).resolves.toEqual({ outcome: "denied", reason: "active_run" });
		expect(transaction.conversation.updateMany).not.toHaveBeenCalled();
	});

	it("does not let an access-ended participant close the shared conversation", async function _RejectsRemovedParticipantClose()
	{
		const transaction = {
			orgMembership: _ActiveMembership(),
			conversation: { findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn() },
		};
		await expect(new PrismaConversationUnitOfWork(_Prisma(transaction) as never, {} as never, _CreateMutationRepository).close(_CALLER, "conversation-1")).resolves.toEqual({ outcome: "denied", reason: "conversation_unavailable" });
		expect(transaction.conversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ participants: { some: { userId: "user-1", accessEndedPosition: null } } }) }));
		expect(transaction.conversation.updateMany).not.toHaveBeenCalled();
	});

	it("fails list and open closed when active organisation membership is revoked", async function _RejectsRevokedReads()
	{
		const participants = { findMany: vi.fn(), findFirst: vi.fn() };
		const transaction = { orgMembership: { findFirst: vi.fn().mockResolvedValue(null) }, conversationParticipant: participants };
		const authority = new PrismaConversationUnitOfWork(_Prisma(transaction) as never, {} as never, _CreateMutationRepository);

		await expect(authority.list(_CALLER, false)).resolves.toEqual([]);
		await expect(authority.open(_CALLER, "conversation-1")).resolves.toBeNull();
		expect(participants.findMany).not.toHaveBeenCalled();
		expect(participants.findFirst).not.toHaveBeenCalled();
	});

	it("fails direct writes and idempotency replay closed after membership revocation", async function _RejectsRevokedMessage()
	{
		const timeline = vi.fn().mockResolvedValue(_Entry(null));
		const create = vi.fn();
		const transaction = {
			orgMembership: { findFirst: vi.fn().mockResolvedValue(null) },
			conversationTimelineEntry: { findFirst: timeline },
			conversation: { findFirst: vi.fn() },
			conversationMessage: { create },
		};

		await expect(new PrismaConversationUnitOfWork(_Prisma(transaction) as never, {} as never, _CreateMutationRepository).submitMessage(_CALLER, "conversation-1", _REQUEST)).resolves.toEqual({ outcome: "denied", reason: "conversation_unavailable" });
		expect(timeline).not.toHaveBeenCalled();
		expect(create).not.toHaveBeenCalled();
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
		const authority = new PrismaConversationUnitOfWork(_Prisma(transaction) as never, {} as never, _CreateMutationRepository);

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
		const authority = new PrismaConversationUnitOfWork(prisma as never, {} as never, _CreateMutationRepository);

		await expect(authority.create(_CALLER, { mode: ConversationModes.Direct, participantUserIds: ["user-2"] })).resolves.toEqual(expect.objectContaining({ outcome: "created", conversation: expect.objectContaining({ id: "conversation-1", mode: ConversationModes.Direct }) }));
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

		await expect(new PrismaConversationUnitOfWork(prisma as never, {} as never, _CreateMutationRepository).setArchived(_CALLER, "conversation-1", true)).resolves.toEqual(expect.objectContaining({ outcome: "changed", conversation: expect.objectContaining({ id: "conversation-1" }) }));
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

		await expect(new PrismaConversationUnitOfWork(prisma as never, {} as never, _CreateMutationRepository).close(_CALLER, "conversation-1")).resolves.toEqual(expect.objectContaining({ outcome: "changed", conversation: expect.objectContaining({ lifecycle: "closed" }) }));
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

		await expect(new PrismaConversationUnitOfWork(_Prisma(transaction) as never, {} as never, _CreateMutationRepository).create(_CALLER, { mode: ConversationModes.Direct, participantUserIds: ["user-2"] })).rejects.toThrow("Written conversation projection unavailable");
	});
});
