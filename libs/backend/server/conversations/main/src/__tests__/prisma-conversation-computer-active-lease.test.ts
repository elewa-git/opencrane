import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaConversationComputerActivationProjectionRepository } from "../db/prisma-conversation-computer-activation-repository";
import { PrismaConversationComputerLifecycleProjectionRepository } from "../db/prisma-conversation-computer-lifecycle-projection-repository";

/** Exact active lease copied from canonical Kurrent history. */
const _LEASE = { siloId: "silo-1", conversationId: "conversation-1", computerId: "computer-1", agentIdentityId: "identity-1", leaseId: "lease-2", leaseGeneration: 2, expiresAt: "2099-09-05T13:00:00.000Z" };

/** Build a transaction-shaped projection repository around controlled delegate operations. */
function _Repository(existing: Readonly<Record<string, unknown>>)
{
	const upsert = vi.fn().mockResolvedValue(existing);
	const findUnique = vi.fn().mockResolvedValue(existing);
	const transaction = { conversationComputerActiveLease: { upsert, findUnique } } as unknown as Prisma.TransactionClient;
	return { repository: new PrismaConversationComputerActivationProjectionRepository(transaction), upsert, findUnique };
}

describe("PrismaConversationComputerActivationProjectionRepository", function _Suite()
{
	it("publishes and idempotently verifies the exact active lease without a uniqueness error", async function _Publishes()
	{
		const persisted = { ..._LEASE, expiresAt: new Date(_LEASE.expiresAt) };
		const { repository, upsert, findUnique } = _Repository(persisted);
		await expect(repository.publishActiveLease(_LEASE)).resolves.toBeUndefined();
		expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { computerId: "computer-1" }, update: {} }));
		expect(upsert.mock.invocationCallOrder[0]).toBeLessThan(findUnique.mock.invocationCallOrder[0]!);
	});

	it("rejects a conflicting projection instead of overwriting a replacement generation", async function _RejectsReplacement()
	{
		const persisted = { ..._LEASE, leaseId: "lease-3", leaseGeneration: 3, expiresAt: new Date(_LEASE.expiresAt) };
		const { repository } = _Repository(persisted);
		await expect(repository.publishActiveLease(_LEASE)).rejects.toThrow("conflicts with current authority");
	});
});

describe("PrismaConversationComputerLifecycleProjectionRepository", function _LifecycleSuite()
{
	it("keeps the lease fenced when a contending approval became pending", async function _KeepsPendingApprovalLease()
	{
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const count = vi.fn().mockResolvedValue(1);
		const deleteMany = vi.fn();
		const transaction = { conversationComputerActiveLease: { updateMany, deleteMany }, approvalRequest: { count } } as unknown as Prisma.TransactionClient;
		const repository = new PrismaConversationComputerLifecycleProjectionRepository(transaction);
		await expect(repository.clearActiveLease({ ..._LEASE, leaseGeneration: 2 })).resolves.toBe(false);
		expect(updateMany.mock.invocationCallOrder[0]).toBeLessThan(count.mock.invocationCallOrder[0]!);
		expect(deleteMany).not.toHaveBeenCalled();
	});

	it("deletes only after its write fence observes no pending approval", async function _ClearsIdleLease()
	{
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const count = vi.fn().mockResolvedValue(0);
		const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { conversationComputerActiveLease: { updateMany, deleteMany }, approvalRequest: { count } } as unknown as Prisma.TransactionClient;
		const repository = new PrismaConversationComputerLifecycleProjectionRepository(transaction);
		await expect(repository.clearActiveLease({ ..._LEASE, leaseGeneration: 2 })).resolves.toBe(true);
		expect(updateMany.mock.invocationCallOrder[0]).toBeLessThan(count.mock.invocationCallOrder[0]!);
		expect(count.mock.invocationCallOrder[0]).toBeLessThan(deleteMany.mock.invocationCallOrder[0]!);
	});
});
