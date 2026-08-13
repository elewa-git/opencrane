import { ConversationLifecycle, ConversationMessageRole, ConversationMessageState, ConversationMode } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PersonalRunAdmissionOutcomes, type PersonalRunAdmissionPort } from "@opencrane/backend/agents/execution/admission";
import type { RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { MessageContentBlockKinds, MessageSources } from "@opencrane/models/conversations";

import { PrismaConversationMessageAdmissionUnitOfWork } from "../db/prisma-conversation-message-admission-unit-of-work.js";
import { PrismaConversationMutationRepository } from "../db/prisma-conversation-mutation-repository.js";
import type { SubmitConversationMessageRequest } from "../types/conversation-request.types.js";

/** Fixed caller and message request reused across mode-strategy assertions. */
const _CALLER = { siloId: "silo-1", subjectId: "user-1" } as const;
const _REQUEST: SubmitConversationMessageRequest = { idempotencyKey: "request-1", blocks: [{ id: "block-1", kind: MessageContentBlockKinds.Text, value: "Hello" }] };

/** Builds a canonical persisted message timeline row. */
function _Entry(runId: string | null, invokedAgentThread: object | null = null): object
{
	return { position: 2n, message: { id: "message-1", role: ConversationMessageRole.User, state: ConversationMessageState.Completed, source: MessageSources.UserInput, blocks: _REQUEST.blocks, runId, userId: "user-1", createdAt: new Date("2026-08-10T10:00:00.000Z"), completedAt: new Date("2026-08-10T10:00:00.000Z"), invokedAgentThread } };
}

/** Builds the root client facade around one transaction-shaped test double. */
function _Prisma(transaction: Record<string, unknown>): object
{
	return { $transaction: vi.fn(async function _Transaction(work) { return work(transaction); }) };
}

/** Builds the active organisation-membership delegate required by every self authority snapshot. */
function _ActiveMembership(): object
{
	return { findFirst: vi.fn().mockResolvedValue({ clusterTenant: "silo-1" }), findMany: vi.fn().mockResolvedValue([{ id: "member-1", subject: "user-1" }]) };
}

/** Creates the no-op attachment port used by text-only conversation tests. */
function _CreateAttachmentAdmission(): { readonly bindReadyAssets: () => Promise<void>; readonly mirrorReadyAssets: () => Promise<void> }
{
	return { bindReadyAssets: vi.fn().mockResolvedValue(undefined), mirrorReadyAssets: vi.fn().mockResolvedValue(undefined) };
}

/** Creates message admission over deliberately narrow Prisma and run-admission test doubles. */
function _Admission(prisma: object, runAdmission: Partial<PersonalRunAdmissionPort>): PrismaConversationMessageAdmissionUnitOfWork
{
	return new PrismaConversationMessageAdmissionUnitOfWork(prisma as never, runAdmission as PersonalRunAdmissionPort, _CreateMutationRepository, _CreateAttachmentAdmission);
}

describe("PrismaConversationMessageAdmissionUnitOfWork", function _Suite()
{
	it("routes a structured group target through one prepared first-run transaction", async function _AdmitsAgentThread()
	{
		const request = { ..._REQUEST, agentTarget: { agentServiceId: "service-1" } };
		const origin = { childConversationId: "child-1", parentConversationId: "conversation-1", rootConversationId: "conversation-1", parentMessageId: "message-1", initiatorUserId: "user-1", agentServiceId: "service-1", personaRevisionId: "persona-1", firstRunId: "run-1" };
		const transaction = { orgMembership: _ActiveMembership(), conversationTimelineEntry: { findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(_Entry(null, origin)) }, conversation: { findFirst: vi.fn().mockResolvedValue({ mode: ConversationMode.Group, lifecycle: ConversationLifecycle.Open, agentServiceId: null, runs: [] }) } };
		const prepareAgentThread = vi.fn().mockResolvedValue({ personaProfileId: "profile-1", personaRevisionId: "persona-1" });
		const persistAgentThread = vi.fn().mockResolvedValue(undefined);
		const runAdmission = { admitFirstAgentThreadRun: vi.fn(async function _Admit(command, serviceId, prepare, commit)
		{
			const runTransaction = { prisma: {} };
			await prepare(runTransaction);
			await commit(runTransaction, { snapshot: { runId: "run-1", personaRevisionId: "persona-1" } });
			return { outcome: PersonalRunAdmissionOutcomes.Accepted, runId: "run-1" };
		}) };
		const admission = new PrismaConversationMessageAdmissionUnitOfWork(_Prisma(transaction) as never, runAdmission as never, function _Repository(): never { return { prepareAgentThread, persistAgentThread } as never; }, _CreateAttachmentAdmission);

		await expect(admission.submit(_CALLER, "conversation-1", request)).resolves.toEqual(expect.objectContaining({ outcome: "accepted", agentThread: expect.objectContaining({ firstRunId: "run-1" }) }));
		expect(runAdmission.admitFirstAgentThreadRun).toHaveBeenCalledWith(expect.objectContaining({ conversationId: expect.any(String) }), "service-1", expect.any(Function), expect.any(Function));
		expect(prepareAgentThread).toHaveBeenCalledOnce();
		expect(persistAgentThread).toHaveBeenCalledWith(_CALLER, expect.objectContaining({ firstRunId: "run-1", personaRevisionId: "persona-1" }), "profile-1", expect.any(String), request, expect.objectContaining({ blocks: request.blocks }), expect.any(Object));
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
		const admission = _Admission(_Prisma(transaction), { admitPersonalRun } as never);

		await expect(admission.submit(_CALLER, "conversation-1", _REQUEST)).resolves.toEqual(expect.objectContaining({ outcome: "accepted", message: expect.objectContaining({ runId: "run-1", position: "2" }) }));
		expect(admitPersonalRun).toHaveBeenCalledWith(expect.objectContaining({ siloId: "silo-1", executionSubjectId: "user-1", conversationId: "conversation-1", requestIdempotencyKey: "request-1", inputMessageBlocks: _REQUEST.blocks, inputMessageId: expect.any(String) }), expect.any(Function));
		expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ conversationId: "conversation-1", runId: "run-1", userId: "user-1", idempotencyKey: "request-1", source: "user_input" }) });
	});

	it("persists direct input without creating an AgentRun", async function _AdmitsDirectMessage()
	{
		const create = vi.fn().mockResolvedValue({});
		const findFirst = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(_Entry(null));
		const context = { mode: ConversationMode.Direct, lifecycle: ConversationLifecycle.Open, agentServiceId: null, runs: [] };
		const transaction = { orgMembership: _ActiveMembership(), conversation: { findFirst: vi.fn().mockResolvedValue(context) }, conversationMessage: { create } };
		Object.assign(transaction, { conversationTimelineEntry: { findFirst } });
		const admitPersonalRun = vi.fn();
		const prisma = _Prisma(transaction) as { readonly $transaction: ReturnType<typeof vi.fn> };

		await expect(_Admission(prisma, { admitPersonalRun }).submit(_CALLER, "conversation-1", _REQUEST)).resolves.toEqual(expect.objectContaining({ outcome: "accepted", message: expect.objectContaining({ runId: null }) }));
		expect(admitPersonalRun).not.toHaveBeenCalled();
		expect(prisma.$transaction).toHaveBeenNthCalledWith(2, expect.any(Function), { isolationLevel: "Serializable" });
		expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ runId: null, role: ConversationMessageRole.User, state: ConversationMessageState.Completed }) });
	});

	it("returns an exact same-body retry from the participant-scoped preflight", async function _ReturnsDuplicate()
	{
		const transaction = {
			orgMembership: _ActiveMembership(),
			conversationTimelineEntry: { findFirst: vi.fn().mockResolvedValue(_Entry(null)) },
		};
		const admitPersonalRun = vi.fn();

		await expect(_Admission(_Prisma(transaction), { admitPersonalRun }).submit(_CALLER, "conversation-1", _REQUEST)).resolves.toEqual(expect.objectContaining({ outcome: "idempotent", message: expect.objectContaining({ id: "message-1" }) }));
		expect(admitPersonalRun).not.toHaveBeenCalled();
	});

	it("rejects changed-body reuse of a participant-owned idempotency key", async function _RejectsChangedDuplicate()
	{
		const transaction = {
			orgMembership: _ActiveMembership(),
			conversationTimelineEntry: { findFirst: vi.fn().mockResolvedValue(_Entry(null)) },
		};
		const changedRequest: SubmitConversationMessageRequest = { ..._REQUEST, blocks: [{ id: "block-1", kind: MessageContentBlockKinds.Text, value: "Changed" }] };

		await expect(_Admission(_Prisma(transaction), {}).submit(_CALLER, "conversation-1", changedRequest)).resolves.toEqual({ outcome: "denied", reason: "idempotency_conflict" });
	});

	it.each([
		["conversation_unavailable", "conversation_unavailable"],
		["authority_conflict", "idempotency_conflict"],
		["admission_concurrency_limited", "capacity_limited"],
		["active_run", "active_run"],
		["run_not_admittable", "agent_service_unavailable"],
		["revision_unavailable", "agent_service_unavailable"],
		["persona_unavailable", "agent_service_unavailable"],
		["future_failure", "persistence_unavailable"],
	])("maps run-admission refusal %s to %s", async function _MapsAdmissionRefusal(reason, expected)
	{
		const transaction = {
			orgMembership: _ActiveMembership(),
			conversationTimelineEntry: { findFirst: vi.fn().mockResolvedValue(null) },
			conversation: { findFirst: vi.fn().mockResolvedValue({ mode: ConversationMode.AgentSession, lifecycle: ConversationLifecycle.Open, agentServiceId: "service-1", runs: [] }) },
		};
		const runAdmission = { admitPersonalRun: vi.fn().mockResolvedValue({ outcome: PersonalRunAdmissionOutcomes.Denied, reason }) };

		await expect(_Admission(_Prisma(transaction), runAdmission).submit(_CALLER, "conversation-1", _REQUEST)).resolves.toEqual({ outcome: "denied", reason: expected });
	});

	it("returns the caller's canonical message after losing a concurrent insert race", async function _RecoversOwnConcurrentInsert()
	{
		const create = vi.fn().mockRejectedValue(new Error("unique"));
		const timeline = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(_Entry(null));
		const transaction = {
			orgMembership: _ActiveMembership(),
			conversationTimelineEntry: { findFirst: timeline },
			conversation: { findFirst: vi.fn().mockResolvedValue({ mode: ConversationMode.Direct, lifecycle: ConversationLifecycle.Open, agentServiceId: null, runs: [] }) },
			conversationMessage: { create, findFirst: vi.fn() },
		};

		await expect(_Admission(_Prisma(transaction), {}).submit(_CALLER, "conversation-1", _REQUEST)).resolves.toEqual(expect.objectContaining({ outcome: "idempotent", message: expect.objectContaining({ id: "message-1" }) }));
		expect(create).toHaveBeenCalledTimes(1);
		expect(timeline).toHaveBeenCalledTimes(2);
	});

	it("rejects a conversation-scoped idempotency key already owned by another participant", async function _RejectsForeignKey()
	{
		const context = { mode: ConversationMode.Direct, lifecycle: ConversationLifecycle.Open, agentServiceId: null, runs: [] };
		const create = vi.fn().mockRejectedValue(new Error("unique"));
		const transaction = {
			orgMembership: _ActiveMembership(),
			conversation: { findFirst: vi.fn().mockResolvedValue(context) },
			conversationTimelineEntry: { findFirst: vi.fn().mockResolvedValue(null) },
			conversationMessage: { create, findFirst: vi.fn().mockResolvedValue({ id: "message-other" }) },
		};

		await expect(_Admission(_Prisma(transaction), {}).submit(_CALLER, "conversation-1", _REQUEST)).resolves.toEqual({ outcome: "denied", reason: "idempotency_conflict" });
		expect(create).toHaveBeenCalledTimes(1);
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

		await expect(_Admission(_Prisma(transaction), {}).submit(_CALLER, "conversation-1", _REQUEST)).resolves.toEqual({ outcome: "denied", reason: "conversation_unavailable" });
		expect(timeline).not.toHaveBeenCalled();
		expect(create).not.toHaveBeenCalled();
	});
});
/** Creates the transaction-scoped mutation adapter used by run admission callbacks. */
function _CreateMutationRepository(transaction: RunAdmissionTransaction): PrismaConversationMutationRepository
{
	return new PrismaConversationMutationRepository(transaction.prisma);
}
