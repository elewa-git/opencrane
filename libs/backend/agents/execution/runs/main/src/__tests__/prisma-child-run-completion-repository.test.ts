import { AgentRunState, ChildRunCompletionDeliveryOutcome } from "@prisma/client";
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
	return { id: "parent-1", rootRunId: "root-1", siloId: "silo-1", attempt: 1, conversationId: "conversation-1", ...overrides };
}

/** Builds a transaction client with independently controlled authority rows. */
function _transaction(child: Record<string, unknown> | null, parent: Record<string, unknown> | null, reservation: Record<string, unknown> | null, deliveries: Array<Record<string, unknown>> = [], terminalEvents: Array<{ type: string; attempt: number }> = [])
{
	const findCurrent = vi.fn().mockImplementation(async function _FindCurrent({ where }: { readonly where: { readonly childRunId_childAttempt_parentAttempt: { readonly childRunId: string; readonly childAttempt: number; readonly parentAttempt: number } } })
	{
		const key = where.childRunId_childAttempt_parentAttempt;
		return deliveries.find(function _Matches(delivery) { return delivery["childRunId"] === key.childRunId && delivery["childAttempt"] === key.childAttempt && delivery["parentAttempt"] === key.parentAttempt; }) ?? null;
	});
	const findTerminalEvents = vi.fn().mockImplementation(async function _FindTerminalEvents({ where }: { readonly where: { readonly attempt: number } })
	{
		return terminalEvents.filter(function _CurrentAttempt(event) { return event.attempt === where.attempt; });
	});
	const transaction = { agentRun: { findUnique: vi.fn().mockResolvedValueOnce(child).mockResolvedValueOnce(parent) }, childRunCompletionDelivery: { findUnique: findCurrent, create: vi.fn() }, childRunReservation: { findUnique: vi.fn().mockResolvedValue(reservation) }, conversationRunEvent: { aggregate: vi.fn().mockResolvedValue({ _max: { sequence: 4 } }), findMany: findTerminalEvents, create: vi.fn() } };
	return transaction;
}

/** Binds the repository under test to one controlled Prisma transaction double. */
function _repository(transaction: unknown): PrismaChildRunCompletionRepository
{
	return new PrismaChildRunCompletionRepository(transaction as never);
}

describe("child-run completion transaction", function _describeCompletionDelivery()
{
	it("appends the terminal child result and immutable receipt in one transaction", async function _delivers()
	{
		const transaction = _transaction(_child(), _parent(), { childRunId: "child-1", parentRunId: "parent-1", rootRunId: "root-1" });

		await expect(_repository(transaction).deliver({ childRunId: "child-1" })).resolves.toEqual({ outcome: "delivered", parentRunId: "parent-1", parentEventSequence: 5 });
		expect(transaction.childRunCompletionDelivery.create).toHaveBeenCalledWith({ data: { childRunId: "child-1", childAttempt: 1, parentRunId: "parent-1", parentAttempt: 1, parentEventSequence: 5, outcome: ChildRunCompletionDeliveryOutcome.Delivered } });
		expect(transaction.childRunCompletionDelivery.create.mock.invocationCallOrder[0]).toBeLessThan(transaction.conversationRunEvent.create.mock.invocationCallOrder[0]!);
		expect(transaction.conversationRunEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ conversationId: "conversation-1", runId: "parent-1", attempt: 1, sequence: 5, type: "child.run.completed", payload: expect.objectContaining({ childRunId: "child-1", childAttempt: 1, childState: "completed" }) }) });
	});

	it("returns the existing receipt instead of appending the child twice", async function _deduplicates()
	{
		const transaction = _transaction(_child(), _parent(), { childRunId: "child-1", parentRunId: "parent-1", rootRunId: "root-1" }, [{ childRunId: "child-1", childAttempt: 1, parentRunId: "parent-1", parentAttempt: 1, outcome: ChildRunCompletionDeliveryOutcome.Delivered, parentEventSequence: 5 }]);

		await expect(_repository(transaction).deliver({ childRunId: "child-1" })).resolves.toEqual({ outcome: "idempotent", parentRunId: "parent-1", parentEventSequence: 5, delivery: "delivered" });
		expect(transaction.conversationRunEvent.create).not.toHaveBeenCalled();
	});

	it("replays a delivered child attempt after the parent itself moves to another attempt", async function _DeduplicatesAcrossParentRetry()
	{
		const earlier = { childRunId: "child-1", childAttempt: 1, parentRunId: "parent-1", parentAttempt: 1, outcome: ChildRunCompletionDeliveryOutcome.Delivered, parentEventSequence: 5 };
		const transaction = _transaction(_child(), _parent({ attempt: 2 }), { childRunId: "child-1", parentRunId: "parent-1", rootRunId: "root-1" }, [earlier]);

		await expect(_repository(transaction).deliver({ childRunId: "child-1" })).resolves.toEqual({ outcome: "idempotent", parentRunId: "parent-1", parentEventSequence: 5, delivery: "delivered" });
		expect(transaction.childRunCompletionDelivery.create).not.toHaveBeenCalled();
		expect(transaction.conversationRunEvent.create).not.toHaveBeenCalled();
	});

	it("rejects a forged reservation before it can append to another root stream", async function _rejectsForgedLineage()
	{
		const transaction = _transaction(_child(), _parent(), { childRunId: "child-1", parentRunId: "parent-1", rootRunId: "other-root" });

		await expect(_repository(transaction).deliver({ childRunId: "child-1" })).resolves.toEqual({ outcome: "denied", reason: "lineage_conflict" });
		expect(transaction.conversationRunEvent.create).not.toHaveBeenCalled();
	});

	it("durably suppresses delivery when the parent has no conversation stream", async function _recordsNoParentStream()
	{
		const transaction = _transaction(_child(), _parent({ conversationId: null }), { childRunId: "child-1", parentRunId: "parent-1", rootRunId: "root-1" });

		await expect(_repository(transaction).deliver({ childRunId: "child-1" })).resolves.toEqual({ outcome: "suppressed", parentRunId: "parent-1", reason: "no_parent_stream" });
		expect(transaction.childRunCompletionDelivery.create).toHaveBeenCalledWith({ data: { childRunId: "child-1", childAttempt: 1, parentRunId: "parent-1", parentAttempt: 1, parentEventSequence: null, outcome: ChildRunCompletionDeliveryOutcome.NoParentStream } });
	});

	it("delivers a later child attempt even when the earlier attempt was already delivered", async function _DeliversChildRetry()
	{
		const earlier = { childRunId: "child-1", childAttempt: 1, parentRunId: "parent-1", parentAttempt: 1, outcome: ChildRunCompletionDeliveryOutcome.Delivered, parentEventSequence: 3 };
		const transaction = _transaction(_child({ attempt: 2 }), _parent({ attempt: 2 }), { childRunId: "child-1", parentRunId: "parent-1", rootRunId: "root-1" }, [earlier]);

		await expect(_repository(transaction).deliver({ childRunId: "child-1" })).resolves.toEqual({ outcome: "delivered", parentRunId: "parent-1", parentEventSequence: 5 });
		expect(transaction.childRunCompletionDelivery.create).toHaveBeenCalledWith({ data: expect.objectContaining({ childRunId: "child-1", childAttempt: 2, parentAttempt: 2, outcome: ChildRunCompletionDeliveryOutcome.Delivered }) });
	});

	it("does not let an earlier parent attempt's terminal event suppress the current attempt", async function _IgnoresEarlierParentTerminal()
	{
		const transaction = _transaction(_child(), _parent({ attempt: 2 }), { childRunId: "child-1", parentRunId: "parent-1", rootRunId: "root-1" }, [], [{ type: "run.failed", attempt: 1 }]);

		await expect(_repository(transaction).deliver({ childRunId: "child-1" })).resolves.toEqual({ outcome: "delivered", parentRunId: "parent-1", parentEventSequence: 5 });
		expect(transaction.conversationRunEvent.findMany).toHaveBeenCalledWith({ where: { runId: "parent-1", attempt: 2, type: { in: ["run.completed", "run.failed", "run.cancelled"] } }, select: { type: true } });
		expect(transaction.conversationRunEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ attempt: 2, payload: expect.objectContaining({ childAttempt: 1 }) }) });
	});

	it("suppresses delivery after the current parent attempt is terminal", async function _SuppressesCurrentParentTerminal()
	{
		const transaction = _transaction(_child({ attempt: 2 }), _parent({ attempt: 2 }), { childRunId: "child-1", parentRunId: "parent-1", rootRunId: "root-1" }, [], [{ type: "run.failed", attempt: 2 }]);

		await expect(_repository(transaction).deliver({ childRunId: "child-1" })).resolves.toEqual({ outcome: "suppressed", parentRunId: "parent-1", reason: "parent_stream_terminal" });
		expect(transaction.childRunCompletionDelivery.create).toHaveBeenCalledWith({ data: { childRunId: "child-1", childAttempt: 2, parentRunId: "parent-1", parentAttempt: 2, parentEventSequence: null, outcome: ChildRunCompletionDeliveryOutcome.ParentStreamTerminal } });
		expect(transaction.conversationRunEvent.create).not.toHaveBeenCalled();
	});
});
