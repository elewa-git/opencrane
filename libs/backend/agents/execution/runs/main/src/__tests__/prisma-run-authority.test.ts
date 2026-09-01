import { ChildRunCompletionDeliveryOutcome, Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";
import type { ExecutionSubject } from "@opencrane/models/agents";
import type { RunInputSnapshot } from "@opencrane/contracts";
import { PrismaAgentRunAuthorityRepository } from "../prisma-run-authority";
import { PrismaAgentRunRetryUnitOfWork } from "../prisma-run-retry-unit-of-work";
import { RetryRunInputCompileOutcomes, type RetryRunInputCompiler } from "../retry-run-input.types";
import type { AtomicStartNextRunAttemptCommand } from "../run-authority.types";

/** Creates one participant-authorized atomic retry command. */
function _command(): AtomicStartNextRunAttemptCommand
{
	return { runId: "run-1", expectedAttempt: 1, siloId: "silo-1", conversationId: "conversation-1", requestedBy: "user-1", requestedByPrincipalId: "principal-1", expectedAgentServiceId: "service-1", expectedAgentServiceSiloId: "silo-1", expectedAgentServiceState: "active", expectedActiveAgentRevisionId: "revision-1", acceptedAt: "2026-07-18T01:00:00.000Z", nextInputSnapshot: _snapshot(2) };
}

/** Creates one fully bound evidence subject for a single run attempt. */
function _subject(attempt: number): ExecutionSubject
{
	return { schemaVersion: 1, siloId: "silo-1", agentIdentityId: "identity-1", principalId: "principal-1", identity: { agentIdentityId: "identity-1", principalId: "principal-1", siloId: "silo-1", headRevision: "1", headDigest: `sha256:${"a".repeat(64)}`, decisionEvidenceId: "identity-decision", verifiedAt: "2026-07-18T00:00:00.000Z" }, membership: { principalId: "principal-1", siloId: "silo-1", revision: 1, assertionId: "membership", payloadDigest: `sha256:${"b".repeat(64)}`, decisionEvidenceId: "membership-decision", trustedUntil: "2099-07-18T00:00:00.000Z" }, capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: `sha256:${"c".repeat(64)}`, effectiveContractDigest: `sha256:${"d".repeat(64)}`, decisionEvidenceId: "capability-decision", decidedAt: "2026-07-18T00:00:00.000Z" }, runScope: { siloId: "silo-1", runId: "run-1", attempt, agentServiceId: "service-1", agentRevisionId: "revision-1" }, computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: `lease-${attempt}`, leaseGeneration: attempt }, requester: { siloId: "silo-1", requesterPrincipalId: "requester-1", requestIdempotencyKey: "request-1", authenticatedAt: "2026-07-18T00:00:00.000Z" }, admission: { authorizingPrincipalId: "authorizer-1", decisionEvidenceId: "admission-decision", admittedAt: "2026-07-18T00:00:00.000Z" } };
}

/** Creates the next immutable snapshot which owns the fresh computer lease. */
function _snapshot(attempt: number): RunInputSnapshot
{
	return { runId: "run-1", attempt, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", snapshotVersion: 1, conversationId: "conversation-1", messageIds: [], personaRevisionId: null, preferenceFactIds: [], artifactRevisionIds: [], skillRevisionIds: [], memoryQueryPolicy: {}, mcpTools: [], modelRoute: {}, budgetPolicy: {}, executionSubject: _subject(attempt), promptCompilerVersion: "prompt-v1", digest: `sha256:${String(attempt).repeat(64)}`, compiledAt: "2026-07-18T01:00:00.000Z" };
}

/** Supplies a compiler for transaction-retry tests whose transactions roll back before compiling. */
function _retryCompiler(): RetryRunInputCompiler
{
	return { compile: vi.fn().mockResolvedValue({ outcome: RetryRunInputCompileOutcomes.Compiled, nextInputSnapshot: _snapshot(2) }) };
}

/** Creates one retryable Prisma run row. */
function _runRow(attempt: number = 1)
{
	return { id: "run-1", siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", conversationId: "conversation-1", trigger: "Interactive", agentIdentityId: "identity-1", principalId: "principal-1", executionSubject: _subject(attempt), requestIdempotencyKey: "request-1", rootRunId: "run-1", parentRunId: null, attempt, state: "Failed", inputSnapshotDigest: `sha256:${String(attempt).repeat(64)}`, acceptedAt: new Date("2026-07-18T00:00:00.000Z"), startedAt: new Date("2026-07-18T00:01:00.000Z"), finishedAt: new Date("2026-07-18T00:02:00.000Z"), terminalReason: "RuntimeFailure", costAmount: null, costCurrency: null };
}

/** Creates the exact Active service authority required by a retry. */
function _serviceRow()
{
	return { id: "service-1", siloId: "silo-1", state: "Active", activeRevisionId: "revision-1" };
}

/** Creates the current participant and membership delegates for a retry transaction. */
function _authority()
{
	return {
		conversationParticipant: { findFirst: vi.fn().mockResolvedValue({ conversationId: "conversation-1" }) },
		childRunCompletionDelivery: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn(), create: vi.fn() },
	};
}

/** Allows the current exact AgentRun retry grant in lifecycle-focused tests. */
function _authorization()
{
	return { admitPrincipal: vi.fn().mockResolvedValue({ outcome: "allow" }) } as never;
}

/** Returns one transaction-bound receipt writer for the current retry task. */
function _workflow(): Pick<IWorkflowEngine, "spawn">
{
	return {
		async spawn(_transaction, task)
		{
			return { taskId: "task-1", taskName: task.taskName, idempotencyKey: task.idempotencyKey };
		},
	};
}

/** Returns task-record delegates that bind the current retry receipt once. */
function _taskStore()
{
	return {
		agentRunWorkflowTask: {
			upsert: vi.fn().mockResolvedValue({ runId: "run-1", attempt: 2, siloId: "silo-1", taskKey: "agent-run:silo-1:run-1:attempt:2", taskName: "agent-runs.execute/v1" }),
			updateMany: vi.fn().mockResolvedValue({ count: 1 }),
			findUnique: vi.fn(),
		},
		runInputSnapshot: { create: vi.fn().mockResolvedValue({ id: "snapshot-2" }) },
	};
}

describe("Prisma AgentRun authority adapter", function _suite()
{
	it("commits a single next attempt and its workflow task atomically", async function _retry()
	{
		const run = _runRow();
		const updated = { ...run, attempt: 2, state: "Accepted", agentIdentityId: "identity-1", principalId: "principal-1", executionSubject: _subject(2), inputSnapshotDigest: _snapshot(2).digest, acceptedAt: new Date("2026-07-18T01:00:00.000Z"), startedAt: null, finishedAt: null, terminalReason: null };
		const transaction = { ..._taskStore(), ..._authority(), agentService: { findUnique: vi.fn().mockResolvedValue(_serviceRow()) }, agentRun: { findUnique: vi.fn().mockResolvedValueOnce(run).mockResolvedValueOnce(updated).mockResolvedValue(updated), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
		const result = await new PrismaAgentRunAuthorityRepository(transaction as never, _workflow(), _authorization()).startNextAttemptAtomically(_command());

		expect(result.status).toBe("started");
		expect(transaction.agentRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", state: { in: ["Failed", "Cancelled"] } }) }));
		expect(transaction.agentRunWorkflowTask.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { runId_attempt: { runId: "run-1", attempt: 2 } } }));
	});

	it("redelivers a terminal child that the previous parent attempt had to suppress", async function _RedeliversSuppressedChild()
	{
		const run = _runRow();
		const updated = { ..._runRow(2), state: "Accepted", acceptedAt: new Date("2026-07-18T01:00:00.000Z"), startedAt: null, finishedAt: null, terminalReason: null };
		const child = { ...run, id: "child-1", conversationId: null, parentRunId: "run-1", rootRunId: "run-1", attempt: 1, state: "Completed", terminalReason: "Success", finishedAt: new Date("2026-07-18T00:30:00.000Z") };
		const authority = _authority();
		authority.childRunCompletionDelivery.findMany.mockResolvedValue([{ childRunId: "child-1" }]);
		authority.childRunCompletionDelivery.findUnique
			.mockResolvedValueOnce({ parentRunId: "run-1", outcome: ChildRunCompletionDeliveryOutcome.ParentStreamTerminal, parentEventSequence: null })
			.mockResolvedValueOnce(null);
		const transaction = {
			..._taskStore(),
			...authority,
			agentService: { findUnique: vi.fn().mockResolvedValue(_serviceRow()) },
			agentRun: { findUnique: vi.fn().mockResolvedValueOnce(run).mockResolvedValueOnce(updated).mockResolvedValueOnce(child).mockResolvedValueOnce(updated).mockResolvedValue(updated), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
			childRunReservation: { findUnique: vi.fn().mockResolvedValue({ childRunId: "child-1", parentRunId: "run-1", rootRunId: "run-1" }) },
			conversationRunEvent: { aggregate: vi.fn().mockResolvedValue({ _max: { sequence: 4 } }), findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
		};

		await expect(new PrismaAgentRunAuthorityRepository(transaction as never, _workflow(), _authorization()).startNextAttemptAtomically(_command())).resolves.toMatchObject({ status: "started", run: { attempt: 2 } });
		expect(transaction.childRunCompletionDelivery.findMany).toHaveBeenCalledWith({ where: { parentRunId: "run-1", parentAttempt: { lte: 1 }, outcome: ChildRunCompletionDeliveryOutcome.ParentStreamTerminal }, select: { childRunId: true } });
		expect(transaction.childRunCompletionDelivery.create).toHaveBeenCalledWith({ data: expect.objectContaining({ childRunId: "child-1", childAttempt: 1, parentAttempt: 2, outcome: ChildRunCompletionDeliveryOutcome.Delivered }) });
		expect(transaction.conversationRunEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ runId: "run-1", attempt: 2, type: "child.run.completed", payload: expect.objectContaining({ childRunId: "child-1", childAttempt: 1 }) }) });
	});

	it("denies a retry before mutation when current participant authority is absent", async function _Unauthorized()
	{
		const transaction = { ..._authority(), agentService: { findUnique: vi.fn() }, agentRun: { findUnique: vi.fn(), updateMany: vi.fn() } };
		transaction.conversationParticipant.findFirst.mockResolvedValue(null);
		await expect(new PrismaAgentRunAuthorityRepository(transaction as never, _workflow(), _authorization()).startNextAttemptAtomically(_command())).resolves.toEqual({ status: "unauthorized" });
		expect(transaction.agentRun.updateMany).not.toHaveBeenCalled();
	});

	it("replays the deterministic workflow task for the next attempt", async function _Idempotency()
	{
		const run = { ..._runRow(2), state: "Accepted", acceptedAt: new Date("2026-07-18T01:00:00.000Z"), startedAt: null, finishedAt: null, terminalReason: null };
		const transaction = { ..._taskStore(), ..._authority(), agentService: { findUnique: vi.fn().mockResolvedValue(_serviceRow()) }, agentRun: { findUnique: vi.fn().mockResolvedValue(run), updateMany: vi.fn() } };
		transaction.agentRunWorkflowTask.findUnique.mockResolvedValue({ taskKey: "agent-run:silo-1:run-1:attempt:2" });
		const repository = new PrismaAgentRunAuthorityRepository(transaction as never, _workflow(), _authorization());

		await expect(repository.startNextAttemptAtomically(_command())).resolves.toMatchObject({ status: "idempotent", run: { attempt: 2 } });
		await expect(repository.startNextAttemptAtomically(_command())).resolves.toMatchObject({ status: "idempotent", run: { attempt: 2 } });
		expect(transaction.agentRun.updateMany).not.toHaveBeenCalled();
	});

	it("returns the same retry when another transaction wins the conditional update", async function _ConcurrentIdempotency()
	{
		const initial = _runRow();
		const updated = { ..._runRow(2), state: "Accepted", acceptedAt: new Date("2026-07-18T01:00:00.000Z"), startedAt: null, finishedAt: null, terminalReason: null };
		const transaction = { ..._taskStore(), ..._authority(), agentService: { findUnique: vi.fn().mockResolvedValue(_serviceRow()) }, agentRun: { findUnique: vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(updated), updateMany: vi.fn().mockResolvedValue({ count: 0 }) } };
		transaction.agentRunWorkflowTask.findUnique.mockResolvedValue({ taskKey: "agent-run:silo-1:run-1:attempt:2" });
		await expect(new PrismaAgentRunAuthorityRepository(transaction as never, _workflow(), _authorization()).startNextAttemptAtomically(_command())).resolves.toMatchObject({ status: "idempotent", run: { attempt: 2 } });
		expect(transaction.agentRunWorkflowTask.upsert).not.toHaveBeenCalled();
	});

	it("does not mutate when the service authority changed", async function _serviceConflict()
	{
		const transaction = { ..._authority(), agentService: { findUnique: vi.fn().mockResolvedValue({ ..._serviceRow(), activeRevisionId: "revision-2" }) }, agentRun: { findUnique: vi.fn().mockResolvedValue(_runRow()), updateMany: vi.fn() } };
		await expect(new PrismaAgentRunAuthorityRepository(transaction as never, _workflow(), _authorization()).startNextAttemptAtomically(_command())).resolves.toEqual({ status: "agent_service_authority_conflict", currentAgentServiceState: "active", currentAgentServiceSiloId: "silo-1", currentActiveAgentRevisionId: "revision-2" });
		expect(transaction.agentRun.updateMany).not.toHaveBeenCalled();
	});

	it("reads the committed next attempt after three rolled-back transactions", async function _ReadsWinner()
	{
		const uniqueConflict = new Prisma.PrismaClientKnownRequestError("unique conflict", { code: "P2002", clientVersion: "test" });
		const serializationConflict = new Prisma.PrismaClientKnownRequestError("serialization conflict", { code: "P2034", clientVersion: "test" });
		const run = { ..._runRow(2), state: "Accepted", acceptedAt: new Date("2026-07-18T01:00:00.000Z"), startedAt: null, finishedAt: null, terminalReason: null };
		const winnerTransaction = { ..._authority(), agentRun: { findUnique: vi.fn().mockResolvedValue(run) }, agentRunWorkflowTask: { findUnique: vi.fn().mockResolvedValue({ taskKey: "agent-run:silo-1:run-1:attempt:2" }) } };
		const prisma = { $transaction: vi.fn().mockRejectedValueOnce(uniqueConflict).mockRejectedValueOnce(serializationConflict).mockRejectedValueOnce(serializationConflict).mockImplementationOnce(async function _Winner(work) { return work(winnerTransaction); }) };

		await expect(new PrismaAgentRunRetryUnitOfWork(prisma as never, _workflow(), _retryCompiler()).retry(_command())).resolves.toMatchObject({ outcome: "idempotent", run: { attempt: 2 } });
		expect(prisma.$transaction).toHaveBeenCalledTimes(4);
	});

	it("rethrows the third rollback when no next-attempt winner committed", async function _ExhaustsRetry()
	{
		const conflict = new Prisma.PrismaClientKnownRequestError("serialization conflict", { code: "P2034", clientVersion: "test" });
		const last = new Prisma.PrismaClientKnownRequestError("serialization conflict", { code: "P2034", clientVersion: "test" });
		const noWinnerTransaction = { ..._authority(), agentRun: { findUnique: vi.fn().mockResolvedValue(_runRow()) }, agentRunWorkflowTask: { findUnique: vi.fn() } };
		const prisma = { $transaction: vi.fn().mockRejectedValueOnce(conflict).mockRejectedValueOnce(conflict).mockRejectedValueOnce(last).mockImplementationOnce(async function _Winner(work) { return work(noWinnerTransaction); }) };

		await expect(new PrismaAgentRunRetryUnitOfWork(prisma as never, _workflow(), _retryCompiler()).retry(_command())).rejects.toBe(last);
	});
});
