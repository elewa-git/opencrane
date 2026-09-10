import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { CONVERSATION_COMPUTER_TURN_TASK } from "../../turns/workflow/conversation-computer-turn-task";
import { PrismaConversationComputerActivationUnitOfWork } from "../db/prisma-conversation-computer-activation-unit-of-work";

const _ACTIVATION = { activationEventId: "11111111-1111-4111-8111-111111111111", causationId: "22222222-2222-4222-8222-222222222222", causationPosition: "1" };
const _LEASE = { computer: { siloId: "silo-1", conversationId: "conversation-1", computerId: "computer-1", agentIdentityId: "identity-1" }, lease: { leaseId: "lease-2", leaseGeneration: 2, expiresAt: "2099-09-05T13:00:00.000Z" } };

describe("PrismaConversationComputerActivationUnitOfWork", function _Suite()
{
	it("publishes the exact lease and admits its turn through the same serialisable transaction", async function _PublishesAndAdmits()
	{
		const row = { ..._LEASE.computer, leaseId: _LEASE.lease.leaseId, leaseGeneration: _LEASE.lease.leaseGeneration, expiresAt: new Date(_LEASE.lease.expiresAt) };
		const transaction = { conversationComputerActiveLease: { upsert: vi.fn().mockResolvedValue(row), findUnique: vi.fn().mockResolvedValue(row) } } as unknown as Prisma.TransactionClient;
		const $transaction = vi.fn(async function _Transaction(work: (client: Prisma.TransactionClient) => Promise<unknown>) { return work(transaction); });
		const spawn = vi.fn().mockResolvedValue({ taskId: "33333333-3333-4333-8333-333333333333", taskName: CONVERSATION_COMPUTER_TURN_TASK.taskName, idempotencyKey: _ACTIVATION.activationEventId });
		const unit = new PrismaConversationComputerActivationUnitOfWork({ $transaction } as never, { spawn });

		await unit.publishActiveLease(_LEASE, _ACTIVATION);

		expect($transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "Serializable" }));
		expect(spawn).toHaveBeenCalledWith({ client: transaction }, { taskName: CONVERSATION_COMPUTER_TURN_TASK.taskName, idempotencyKey: _ACTIVATION.activationEventId, input: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-2", leaseGeneration: 2, activationEventId: _ACTIVATION.activationEventId, causationId: _ACTIVATION.causationId, causationPosition: _ACTIVATION.causationPosition } });
		expect((transaction.conversationComputerActiveLease.findUnique as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]).toBeLessThan(spawn.mock.invocationCallOrder[0]!);
	});
});
