import { AgentRunState } from "@prisma/client";

import { RunAdmissionMessageInputModes, RunExecutionPersonalMemoryPolicies, RunExecutionPersonaPolicies, type InteractiveRunAdmissionCommand, type RoutineRunAdmissionCommand } from "@opencrane/backend/agents/execution/runs";
import type { ExecutionSubject } from "@opencrane/models/agents";
import { describe, expect, it, vi } from "vitest";

import { PrismaConversationContextRepository } from "../prisma-conversation-context-repository";

/** Create one exact pre-persisted history admission command. */
function _Command(): InteractiveRunAdmissionCommand
{
	return { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", conversationId: "conversation-1", trigger: "interactive", requestIdempotencyKey: "message-2", messageInput: { mode: RunAdmissionMessageInputModes.PrePersistedHistory, messageId: "message-2", historyRevision: "8", orderedMessageIds: ["message-1", "message-2"], author: { principalId: "principal-1", issuer: "https://issuer.example", subjectId: "subject-1", authenticatedAt: "2026-09-01T00:00:00.000Z" } }, requester: { issuer: "https://issuer.example", subjectId: "subject-1", authenticatedAt: "2026-09-01T00:00:00.000Z" } };
}

/** Create one service-attested scheduled occurrence command with no browser requester. */
function _RoutineCommand(): RoutineRunAdmissionCommand
{
	return { runId: "run-routine-1", siloId: "silo-1", agentServiceId: "service-1", conversationId: "conversation-routine-1", trigger: "scheduled", requestIdempotencyKey: "firing-1", messageInput: null, routineInput: { routineId: "routine-1", routineRevision: 3, firingId: "firing-1", scheduledSlot: "2026-09-01T01:00:00.000Z", requesterPrincipalId: "principal-1", requesterIssuer: "https://issuer.example", requesterSubjectId: "subject-1", requesterAuthenticatedAt: "2026-08-20T00:00:00.000Z", workflowTaskId: "task-1", workflowTaskName: "routine-occurrence", workflowTaskKey: "firing-1" } };
}

/** Create the already verified execution subject used by conversation authorization. */
function _Subject(principalId = "principal-1", requesterPrincipalId = "principal-1"): ExecutionSubject
{
	return { principalId, requester: { requesterPrincipalId } } as ExecutionSubject;
}

/** Create the transaction delegates needed for one open, idle personal conversation. */
function _Transaction()
{
	return {
		orgMembership: { findFirst: vi.fn().mockResolvedValue({ clusterTenant: "silo-1" }) },
		conversation: { findFirst: vi.fn().mockResolvedValue({ id: "conversation-1", runs: [] }) },
	};
}

/** Create the current published run authority expected by the conversation. */
function _Run()
{
	return { agentServiceId: "service-1", agentRevisionId: "revision-1", executionPolicy: { persona: RunExecutionPersonaPolicies.Required, personalMemory: RunExecutionPersonalMemoryPolicies.Allowed }, promptCompilerVersion: "v1", trigger: "interactive" as const };
}

describe("PrismaConversationContextRepository", function _Suite()
{
	it("re-reads and returns only the exact Kurrent revision, order, final trigger, and human author", async function _LoadsExactHistory()
	{
		const transaction = _Transaction();
		const history = { read: vi.fn().mockResolvedValue({ historyRevision: "8", orderedMessageIds: ["message-1", "message-2"], finalMessageAuthor: _Command().messageInput!.author }) };
		const repository = new PrismaConversationContextRepository(transaction as never, history);

		await expect(repository.load(_Command(), _Run(), _Subject())).resolves.toEqual({ outcome: "loaded", value: { messageIds: ["message-1", "message-2"] } });
		expect(history.read).toHaveBeenCalledWith({ siloId: "silo-1", conversationId: "conversation-1", expectedRevision: "8" });
		expect(transaction.orgMembership.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ subject: "subject-1" }) }));
		expect(transaction.conversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ participants: { some: { userId: "subject-1", accessEndedPosition: null } } }) }));
	});

	it("refuses changed history or final author provenance", async function _RejectsChangedHistory()
	{
		const history = { read: vi.fn().mockResolvedValue({ historyRevision: "9", orderedMessageIds: ["message-2"], finalMessageAuthor: { ..._Command().messageInput!.author, principalId: "principal-other" } }) };
		const repository = new PrismaConversationContextRepository(_Transaction() as never, history);

		await expect(repository.load(_Command(), _Run(), _Subject())).resolves.toEqual({ outcome: "denied", reason: "conversation_unavailable" });
	});

	it("accepts the human requester's history when a company Principal executes the run", async function _LoadsCompanyHistory()
	{
		const history = { read: vi.fn().mockResolvedValue({ historyRevision: "8", orderedMessageIds: ["message-1", "message-2"], finalMessageAuthor: _Command().messageInput!.author }) };
		const repository = new PrismaConversationContextRepository(_Transaction() as never, history);
		await expect(repository.load(_Command(), _Run(), _Subject("company-principal"))).resolves.toEqual({ outcome: "loaded", value: { messageIds: ["message-1", "message-2"] } });
	});

	it.each([
		{ principalId: "company-principal" },
		{ principalId: "other-human" },
		{ issuer: "https://other-issuer.example" },
		{ subjectId: "other-subject" },
		{ authenticatedAt: "2026-09-01T00:01:00.000Z" },
	])("refuses company history with changed human author field %j", async function _RefusesChangedHuman(changed)
	{
		const history = { read: vi.fn().mockResolvedValue({ historyRevision: "8", orderedMessageIds: ["message-1", "message-2"], finalMessageAuthor: { ..._Command().messageInput!.author, ...changed } }) };
		const repository = new PrismaConversationContextRepository(_Transaction() as never, history);
		await expect(repository.load(_Command(), _Run(), _Subject("company-principal"))).resolves.toEqual({ outcome: "denied", reason: "conversation_unavailable" });
	});

	it("refuses an unchanged author when the verified requester is another human", async function _RefusesOtherRequester()
	{
		const history = { read: vi.fn().mockResolvedValue({ historyRevision: "8", orderedMessageIds: ["message-1", "message-2"], finalMessageAuthor: _Command().messageInput!.author }) };
		const repository = new PrismaConversationContextRepository(_Transaction() as never, history);
		await expect(repository.load(_Command(), _Run(), _Subject("company-principal", "other-human"))).resolves.toEqual({ outcome: "denied", reason: "conversation_unavailable" });
	});

	it("refuses while another non-terminal run owns the conversation", async function _RefusesActiveRun()
	{
		const transaction = _Transaction();
		transaction.conversation.findFirst.mockResolvedValue({ id: "conversation-1", runs: [{ id: "run-active", state: AgentRunState.Running }] } as never);
		const repository = new PrismaConversationContextRepository(transaction as never, { read: vi.fn() });

		await expect(repository.load(_Command(), _Run(), _Subject())).resolves.toEqual({ outcome: "denied", reason: "active_run" });
	});

	it("loads a service-attested routine prompt without reading browser membership or human history", async function _LoadsRoutinePrompt()
	{
		const transaction = _Transaction();
		transaction.conversation.findFirst.mockResolvedValue({ id: "conversation-routine-1", activeComputerLease: { leaseId: "lease-1" }, runs: [] } as never);
		const history = { read: vi.fn() };
		const routinePrompt = { read: vi.fn().mockResolvedValue({ historyRevision: "1", orderedMessageIds: ["service-prompt-1"] }) };
		const repository = new PrismaConversationContextRepository(transaction as never, history, routinePrompt);

		await expect(repository.load(_RoutineCommand(), _Run(), _Subject("company-principal"))).resolves.toEqual({ outcome: "loaded", value: { messageIds: ["service-prompt-1"] } });
		expect(routinePrompt.read).toHaveBeenCalledWith({ siloId: "silo-1", conversationId: "conversation-routine-1", agentServiceId: "service-1", trigger: "scheduled", routine: _RoutineCommand().routineInput });
		expect(history.read).not.toHaveBeenCalled();
		expect(transaction.orgMembership.findFirst).not.toHaveBeenCalled();
	});

	it("refuses a routine prompt until its occurrence computer has an active lease", async function _RefusesRoutineWithoutLease()
	{
		const transaction = _Transaction();
		transaction.conversation.findFirst.mockResolvedValue({ id: "conversation-routine-1", activeComputerLease: null, runs: [] } as never);
		const routinePrompt = { read: vi.fn() };
		const repository = new PrismaConversationContextRepository(transaction as never, { read: vi.fn() }, routinePrompt);

		await expect(repository.load(_RoutineCommand(), _Run(), _Subject("company-principal"))).resolves.toEqual({ outcome: "denied", reason: "conversation_unavailable" });
		expect(routinePrompt.read).not.toHaveBeenCalled();
	});
});
