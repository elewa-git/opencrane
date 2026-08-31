import { AgentRunState, ChildRunCompletionDeliveryOutcome, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaChildRunCompletionRepository } from "../prisma-child-run-completion-repository";

/** Builds one terminal child that inherits the exact direct-parent lineage. */
function _child(overrides: Record<string, unknown> = {})
{
	return { id: "child-1", parentRunId: "parent-1", rootRunId: "root-1", siloId: "silo-1", attempt: 1, state: AgentRunState.Completed, terminalReason: "Success", finishedAt: new Date("2026-07-26T00:00:00.000Z"), ...overrides };
}

/** Builds a live conversation-bound parent able to receive a child result event. */
function _parent(overrides: Record<string, unknown> = {})
{
	return { id: "parent-1", rootRunId: "root-1", siloId: "silo-1", conversationId: "conversation-1", ...overrides };
}

/** Builds a transaction-backed repository with independently controlled authority rows. */
function _repository(child: Record<string, unknown> | null, parent: Record<string, unknown> | null, reservation: Record<string, unknown> | null, delivery: Record<string, unknown> | null = null, terminalEvents: Array<{ type: string }> = [])
{
	const transaction = { agentRun: { findUnique: vi.fn().mockResolvedValueOnce(child).mockResolvedValueOnce(parent) }, childRunCompletionDelivery: { findUnique: vi.fn().mockResolvedValue(delivery), create: vi.fn() }, childRunReservation: { findUnique: vi.fn().mockResolvedValue(reservation) }, conversationRunEvent: { aggregate: vi.fn().mockResolvedValue({ _max: { sequence: 4 } }), findMany: vi.fn().mockResolvedValue(terminalEvents), create: vi.fn() } };
	const prisma = { $transaction: vi.fn(async function _transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
	return { repository: new PrismaChildRunCompletionRepository(prisma), transaction };
}

describe("PrismaChildRunCompletionRepository", function _describeCompletionDelivery()
{
	it("appends the terminal child result and immutable receipt in one transaction", async function _delivers()
	{
		const { repository, transaction } = _repository(_child(), _parent(), { childRunId: "child-1", parentRunId: "parent-1", rootRunId: "root-1" });

		await expect(repository.deliverAtomically({ childRunId: "child-1" })).resolves.toEqual({ outcome: "delivered", parentRunId: "parent-1", parentEventSequence: 5 });
		expect(transaction.childRunCompletionDelivery.create).toHaveBeenCalledWith({ data: { childRunId: "child-1", parentRunId: "parent-1", parentEventSequence: 5, outcome: ChildRunCompletionDeliveryOutcome.Delivered } });
		expect(transaction.childRunCompletionDelivery.create.mock.invocationCallOrder[0]).toBeLessThan(transaction.conversationRunEvent.create.mock.invocationCallOrder[0]!);
		expect(transaction.conversationRunEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ conversationId: "conversation-1", runId: "parent-1", sequence: 5, type: "child.run.completed", payload: expect.objectContaining({ childRunId: "child-1", childState: "completed" }) }) });
	});

	it("returns the existing receipt instead of appending the child twice", async function _deduplicates()
	{
		const { repository, transaction } = _repository(_child(), _parent(), { childRunId: "child-1", parentRunId: "parent-1", rootRunId: "root-1" }, { outcome: ChildRunCompletionDeliveryOutcome.Delivered, parentEventSequence: 5 });

		await expect(repository.deliverAtomically({ childRunId: "child-1" })).resolves.toEqual({ outcome: "idempotent", parentRunId: "parent-1", parentEventSequence: 5, delivery: "delivered" });
		expect(transaction.conversationRunEvent.create).not.toHaveBeenCalled();
	});

	it("rejects a forged reservation before it can append to another root stream", async function _rejectsForgedLineage()
	{
		const { repository, transaction } = _repository(_child(), _parent(), { childRunId: "child-1", parentRunId: "parent-1", rootRunId: "other-root" });

		await expect(repository.deliverAtomically({ childRunId: "child-1" })).resolves.toEqual({ outcome: "denied", reason: "lineage_conflict" });
		expect(transaction.conversationRunEvent.create).not.toHaveBeenCalled();
	});

	it("durably suppresses delivery when the parent has no conversation stream", async function _recordsNoParentStream()
	{
		const { repository, transaction } = _repository(_child(), _parent({ conversationId: null }), { childRunId: "child-1", parentRunId: "parent-1", rootRunId: "root-1" });

		await expect(repository.deliverAtomically({ childRunId: "child-1" })).resolves.toEqual({ outcome: "suppressed", parentRunId: "parent-1", reason: "no_parent_stream" });
		expect(transaction.childRunCompletionDelivery.create).toHaveBeenCalledWith({ data: { childRunId: "child-1", parentRunId: "parent-1", parentEventSequence: null, outcome: ChildRunCompletionDeliveryOutcome.NoParentStream } });
	});
});
