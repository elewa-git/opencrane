import { AgentRunState, ConversationLifecycle, ConversationMessageRole, ConversationMessageState, ConversationMode } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PersonalRunAdmissionOutcomes } from "@opencrane/backend/agents/execution/admission";
import type { RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { MessageContentBlockKinds } from "@opencrane/models/conversations";

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
			await commit({ prisma: { conversationMessage: { create } } }, { snapshot: { runId: "run-1" } });
			return { outcome: PersonalRunAdmissionOutcomes.Accepted, runId: "run-1" };
		});
		const transaction = {
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
		const transaction = { conversation: { findFirst: vi.fn().mockResolvedValue(context) }, conversationMessage: { create } };
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
			conversationTimelineEntry: { findFirst: vi.fn().mockResolvedValue(null) },
			conversation: { findFirst: vi.fn().mockResolvedValue({ mode: ConversationMode.AgentSession, lifecycle: ConversationLifecycle.Open, agentServiceId: "service-1", runs: [{ id: "run-active", state: AgentRunState.Running }] }) },
		};

		await expect(new PrismaConversationUnitOfWork(_Prisma(transaction) as never, { admitPersonalRun } as never, _CreateMutationRepository).submitMessage(_CALLER, "conversation-1", _REQUEST)).resolves.toEqual({ outcome: "denied", reason: "active_run" });
		expect(admitPersonalRun).not.toHaveBeenCalled();
	});

	it("does not misreport run-admission infrastructure refusal as an active run", async function _MapsAdmissionRefusal()
	{
		const transaction = {
			conversationTimelineEntry: { findFirst: vi.fn().mockResolvedValue(null) },
			conversation: { findFirst: vi.fn().mockResolvedValue({ mode: ConversationMode.AgentSession, lifecycle: ConversationLifecycle.Open, agentServiceId: "service-1", runs: [] }) },
		};
		const admission = { admitPersonalRun: vi.fn().mockResolvedValue({ outcome: PersonalRunAdmissionOutcomes.Denied, reason: "admission_concurrency_limited" }) };

		await expect(new PrismaConversationUnitOfWork(_Prisma(transaction) as never, admission as never, _CreateMutationRepository).submitMessage(_CALLER, "conversation-1", _REQUEST)).resolves.toEqual({ outcome: "denied", reason: "persistence_unavailable" });
	});

	it("rejects a conversation-scoped idempotency key already owned by another participant", async function _RejectsForeignKey()
	{
		const context = { mode: ConversationMode.Direct, lifecycle: ConversationLifecycle.Open, agentServiceId: null, runs: [] };
		const transaction = { conversation: { findFirst: vi.fn().mockResolvedValue(context) }, conversationMessage: { create: vi.fn().mockRejectedValue(new Error("unique")) } };
		Object.assign(transaction, {
			conversationTimelineEntry: { findFirst: vi.fn().mockResolvedValue(null) },
			conversationMessage: { findFirst: vi.fn().mockResolvedValue({ id: "message-other" }) },
		});

		await expect(new PrismaConversationUnitOfWork(_Prisma(transaction) as never, {} as never, _CreateMutationRepository).submitMessage(_CALLER, "conversation-1", _REQUEST)).resolves.toEqual({ outcome: "denied", reason: "idempotency_conflict" });
	});

	it("returns the active-run closure conflict only after a durable foreground-run check", async function _RefusesCloseWithRun()
	{
		const transaction = {
			conversationParticipant: { findFirst: vi.fn().mockResolvedValue({ conversationId: "conversation-1" }) },
			agentRun: { findFirst: vi.fn().mockResolvedValue({ id: "run-active" }) },
			conversation: { updateMany: vi.fn() },
		};
		await expect(new PrismaConversationUnitOfWork(_Prisma(transaction) as never, {} as never, _CreateMutationRepository).close(_CALLER, "conversation-1")).resolves.toEqual({ outcome: "denied", reason: "active_run" });
		expect(transaction.conversation.updateMany).not.toHaveBeenCalled();
	});

	it("does not let an access-ended participant close the shared conversation", async function _RejectsRemovedParticipantClose()
	{
		const transaction = {
			conversationParticipant: { findFirst: vi.fn().mockResolvedValue(null) },
			agentRun: { findFirst: vi.fn() },
			conversation: { updateMany: vi.fn() },
		};
		await expect(new PrismaConversationUnitOfWork(_Prisma(transaction) as never, {} as never, _CreateMutationRepository).close(_CALLER, "conversation-1")).resolves.toEqual({ outcome: "denied", reason: "conversation_unavailable" });
		expect(transaction.conversationParticipant.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ accessEndedPosition: null }) }));
		expect(transaction.agentRun.findFirst).not.toHaveBeenCalled();
		expect(transaction.conversation.updateMany).not.toHaveBeenCalled();
	});
});
