import { AgentRunCancellationDecision, AgentRunState, AgentRunTerminalReason } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ExecutionSubjectMembershipKinds } from "@opencrane/contracts";

import { ConversationRunCancellationDecisions } from "../conversation-run-cancellation.types";
import { ConversationRunCancellationDenied } from "../conversation-run-cancellation-denied";
import { PrismaConversationRunCancellationRepository } from "../prisma-conversation-run-cancellation";

const _COMMAND = { runId: "run-1", siloId: "silo-1", conversationId: "conversation-1", attempt: 2, computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 3, expectedOriginalTurnTaskName: "conversation-computer-turn", bootstrapId: "bootstrap-1", commandId: "stop-1", commandDigest: "sha256:command", requesterPrincipalId: "principal-1", authorizationDecisionDigest: "sha256:decision", requestedAt: new Date("2026-09-11T10:00:00.000Z"), originalTurnTask: { taskId: "turn-task-1", taskName: "conversation-computer-turn", idempotencyKey: "activation-1" }, cancellationTask: { taskId: "stop-task-1", taskName: "conversation-computer-stop", idempotencyKey: "stop-1" } };

function _Run(overrides: Record<string, unknown> = {})
{
	const membership = { kind: ExecutionSubjectMembershipKinds.Fleet, principalId: "principal-1", siloId: "silo-1", revision: 1, assertionId: "membership-1", payloadDigest: `sha256:${"b".repeat(64)}`, decisionEvidenceId: "membership-decision", trustedUntil: "2099-09-11T10:00:00.000Z" } as const;
	const executionSubject = { schemaVersion: 1, siloId: "silo-1", agentIdentityId: "identity-1", principalId: "principal-1", identity: { agentIdentityId: "identity-1", principalId: "principal-1", siloId: "silo-1", headRevision: "1", headDigest: `sha256:${"a".repeat(64)}`, decisionEvidenceId: "identity-decision", verifiedAt: "2026-09-11T10:00:00.000Z" }, membership, capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: `sha256:${"c".repeat(64)}`, effectiveContractDigest: `sha256:${"d".repeat(64)}`, decisionEvidenceId: "capability-decision", decidedAt: "2026-09-11T10:00:00.000Z" }, runScope: { siloId: "silo-1", runId: "run-1", attempt: 2, agentServiceId: "service-1", agentRevisionId: "revision-1" }, computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 3 }, requester: { membership, siloId: "silo-1", requesterPrincipalId: "principal-1", requestIdempotencyKey: "request-1", authenticatedAt: "2026-09-11T10:00:00.000Z" }, admission: { authorizingPrincipalId: "principal-1", decisionEvidenceId: "admission-decision", admittedAt: "2026-09-11T10:00:00.000Z" } };
	return { id: "run-1", siloId: "silo-1", conversationId: "conversation-1", attempt: 2, state: AgentRunState.Running, executionSubject, workflowTaskId: "turn-task-1", workflowTaskName: "conversation-computer-turn", workflowTaskKey: "activation-1", cancellationCommandId: null, ...overrides };
}

describe("Prisma conversation run cancellation", function _Suite()
{
	it("stores the complete immutable cancellation bundle from an active run", async function _Admits()
	{
		const run = _Run();
		const admitted = _Run({ state: AgentRunState.Cancelling, cancellationCommandId: "stop-1", cancellationCommandDigest: "sha256:command", cancellationBootstrapId: "bootstrap-1", cancellationRequestedByPrincipalId: "principal-1", cancellationRequestedAt: _COMMAND.requestedAt, cancellationAuthorizationDecisionDigest: "sha256:decision", cancellationWorkflowTaskId: "stop-task-1", cancellationWorkflowTaskName: "conversation-computer-stop", cancellationWorkflowTaskKey: "stop-1" });
		const findUnique = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(admitted);
		const transaction = { agentRun: { findUnique, findFirst: vi.fn().mockResolvedValue(run), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
		const repository = new PrismaConversationRunCancellationRepository(transaction as never);
		await expect(repository.admit(_COMMAND)).resolves.toMatchObject({ commandId: "stop-1", cancellationTask: _COMMAND.cancellationTask });
		expect(transaction.agentRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ state: AgentRunState.Running, cancellationCommandId: null }), data: expect.objectContaining({ state: AgentRunState.Cancelling, cancellationAuthorizationDecisionDigest: "sha256:decision" }) }));
	});

	it("returns a permanent denial when the run completes before the admission fence", async function _CompletedRace()
	{
		const run = _Run();
		const transaction = { agentRun: { findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce({ state: AgentRunState.Completed, cancellationCommandId: null }), findFirst: vi.fn().mockResolvedValue(run), updateMany: vi.fn().mockResolvedValue({ count: 0 }) } };
		const repository = new PrismaConversationRunCancellationRepository(transaction as never);
		await expect(repository.admit(_COMMAND)).rejects.toBeInstanceOf(ConversationRunCancellationDenied);
	});

	it("rejects a selected run whose saved workflow is not the conversation turn", async function _WrongWorkflow()
	{
		const transaction = { agentRun: { findFirst: vi.fn().mockResolvedValue(_Run({ workflowTaskName: "another-workflow" })) } };
		const repository = new PrismaConversationRunCancellationRepository(transaction as never);
		await expect(repository.verifyTarget(_COMMAND)).rejects.toBeInstanceOf(ConversationRunCancellationDenied);
	});

	it("converges an output winner directly to successful completion", async function _CompletesOutputWinner()
	{
		const transaction = { agentRun: { findUnique: vi.fn().mockResolvedValue(_Run({ state: AgentRunState.Cancelling, cancellationCommandId: "stop-1", cancellationCommandDigest: "sha256:command", cancellationDecision: null })), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
		const repository = new PrismaConversationRunCancellationRepository(transaction as never);
		await repository.recordDecision({ commandId: "stop-1", commandDigest: "sha256:command", decision: ConversationRunCancellationDecisions.OutputWon, decidedAt: _COMMAND.requestedAt });
		expect(transaction.agentRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: AgentRunState.Completed, terminalReason: AgentRunTerminalReason.Success }) }));
	});

	it("recovers a previously finalized cancellation", async function _RecoversFinalization()
	{
		const transaction = { agentRun: { findUnique: vi.fn().mockResolvedValue(_Run({ state: AgentRunState.Cancelled, terminalReason: AgentRunTerminalReason.UserCancelled, finishedAt: _COMMAND.requestedAt, cancellationCommandId: "stop-1", cancellationCommandDigest: "sha256:command", cancellationDecision: AgentRunCancellationDecision.CancellationWon })) } };
		const repository = new PrismaConversationRunCancellationRepository(transaction as never);
		await expect(repository.finalize("stop-1", "sha256:command", _COMMAND.requestedAt)).resolves.toBe(true);
	});
});
