import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ConversationComputerRealizationKinds } from "@opencrane/contracts";

import { PrismaConversationComputerActivationProjectionRepository } from "../db/prisma-conversation-computer-activation-repository";
import { PrismaConversationComputerLifecycleProjectionRepository } from "../db/prisma-conversation-computer-lifecycle-projection-repository";

/** Exact active lease copied from canonical Kurrent history. */
const _LEASE = { computer: { siloId: "silo-1", conversationId: "conversation-1", computerId: "computer-1", agentIdentityId: "identity-1" }, lease: { leaseId: "lease-2", leaseGeneration: 2, realization: { kind: ConversationComputerRealizationKinds.AgentSandbox, claimId: "computer-1-g2", sandboxId: "sandbox-1", serviceFQDN: "sandbox-1.computers.svc.cluster.local" }, expiresAt: "2099-09-05T13:00:00.000Z" } } as const;
/** The same lease as the flat `ConversationComputerActiveLease` row Prisma returns. */
const _ROW = { ..._LEASE.computer, leaseId: "lease-2", leaseGeneration: 2, expiresAt: new Date(_LEASE.lease.expiresAt) };

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
		const { repository, upsert, findUnique } = _Repository(_ROW);
		await expect(repository.publishActiveLease(_LEASE)).resolves.toBeUndefined();
		expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { computerId: "computer-1" }, update: {} }));
		expect(upsert.mock.invocationCallOrder[0]).toBeLessThan(findUnique.mock.invocationCallOrder[0]!);
	});

	it("rejects a conflicting projection instead of overwriting a replacement generation", async function _RejectsReplacement()
	{
		const { repository } = _Repository({ ..._ROW, leaseId: "lease-3", leaseGeneration: 3 });
		await expect(repository.publishActiveLease(_LEASE)).rejects.toThrow("conflicts with current authority");
	});

	it("rebuilds an expired canonical lease after delayed activation redelivery", async function _RebuildsExpiredLease()
	{
		const expired = { ..._LEASE, lease: { ..._LEASE.lease, expiresAt: "2026-09-05T11:00:00.000Z" } };
		const { repository, upsert } = _Repository({ ..._ROW, expiresAt: new Date(expired.lease.expiresAt) });
		await expect(repository.publishActiveLease(expired)).resolves.toBeUndefined();
		expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ expiresAt: new Date(expired.lease.expiresAt) }) }));
	});
});

describe("PrismaConversationComputerLifecycleProjectionRepository", function _LifecycleSuite()
{
	it("advances stable pages past every inspected conversation", async function _EnumeratesPage()
	{
		const rows = [
			{ id: "conversation-051", computerId: "computer-51", computerAgentIdentityId: "identity-51", computerProfileRevisionId: "profile-1" },
			{ id: "conversation-052", computerId: "computer-52", computerAgentIdentityId: "identity-52", computerProfileRevisionId: "profile-1" },
		];
		const findMany = vi.fn().mockResolvedValue(rows);
		const transaction = { conversation: { findMany } } as unknown as Prisma.TransactionClient;
		const repository = new PrismaConversationComputerLifecycleProjectionRepository(transaction);
		await expect(repository.enumerate("silo-1", "conversation-050", 2)).resolves.toEqual({
			items: [
				{ computer: { siloId: "silo-1", computerId: "computer-51", conversationId: "conversation-051", agentIdentityId: "identity-51" }, profileRevisionId: "profile-1" },
				{ computer: { siloId: "silo-1", computerId: "computer-52", conversationId: "conversation-052", agentIdentityId: "identity-52" }, profileRevisionId: "profile-1" },
			],
			nextCursor: "conversation-052",
		});
		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { id: "asc" }, take: 2, where: expect.objectContaining({ id: { gt: "conversation-050" } }) }));
	});

	it("extends only the exact projected lease and only to a later expiry", async function _ExtendsLease()
	{
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { conversationComputerActiveLease: { updateMany } } as unknown as Prisma.TransactionClient;
		const repository = new PrismaConversationComputerLifecycleProjectionRepository(transaction);
		const extended = { ..._LEASE, lease: { ..._LEASE.lease, expiresAt: "2099-09-05T14:00:00.000Z" } };
		await expect(repository.extendActiveLease(extended)).resolves.toBe(true);
		expect(updateMany).toHaveBeenCalledWith({ where: { siloId: "silo-1", conversationId: "conversation-1", computerId: "computer-1", agentIdentityId: "identity-1", leaseId: "lease-2", leaseGeneration: 2, expiresAt: { lt: new Date("2099-09-05T14:00:00.000Z") } }, data: { expiresAt: new Date("2099-09-05T14:00:00.000Z") } });
		updateMany.mockResolvedValue({ count: 0 });
		await expect(repository.extendActiveLease(extended)).resolves.toBe(false);
		await expect(repository.extendActiveLease({ ..._LEASE, lease: { ..._LEASE.lease, expiresAt: "not a date" } })).rejects.toThrow("valid expiry");
	});

	it("keeps the lease fenced when a contending approval became pending", async function _KeepsPendingApprovalLease()
	{
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const count = vi.fn().mockResolvedValue(1);
		const deleteMany = vi.fn();
		const transaction = { conversationComputerActiveLease: { updateMany, deleteMany }, approvalRequest: { count }, conversationComputerAttemptCredential: { count: vi.fn().mockResolvedValue(0) } } as unknown as Prisma.TransactionClient;
		const repository = new PrismaConversationComputerLifecycleProjectionRepository(transaction);
		await expect(repository.clearActiveLease({ computer: _LEASE.computer, lease: { leaseId: "lease-2", leaseGeneration: 2 } })).resolves.toBe(false);
		expect(updateMany.mock.invocationCallOrder[0]).toBeLessThan(count.mock.invocationCallOrder[0]!);
		expect(deleteMany).not.toHaveBeenCalled();
	});

	it("deletes only after its write fence observes no pending approval", async function _ClearsIdleLease()
	{
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const count = vi.fn().mockResolvedValue(0);
		const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
		const attemptCount = vi.fn().mockResolvedValue(0);
		const transaction = { conversationComputerActiveLease: { updateMany, deleteMany }, approvalRequest: { count }, conversationComputerAttemptCredential: { count: attemptCount } } as unknown as Prisma.TransactionClient;
		const repository = new PrismaConversationComputerLifecycleProjectionRepository(transaction);
		await expect(repository.clearActiveLease({ computer: _LEASE.computer, lease: { leaseId: "lease-2", leaseGeneration: 2 } })).resolves.toBe(true);
		expect(updateMany.mock.invocationCallOrder[0]).toBeLessThan(count.mock.invocationCallOrder[0]!);
		expect(count.mock.invocationCallOrder[0]).toBeLessThan(deleteMany.mock.invocationCallOrder[0]!);
		expect(attemptCount.mock.invocationCallOrder[0]).toBeLessThan(deleteMany.mock.invocationCallOrder[0]!);
	});

	it("keeps the fenced lease when credential admission won the transaction ordering", async function _KeepsAdmittedAttemptLease()
	{
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const deleteMany = vi.fn();
		const transaction = { conversationComputerActiveLease: { updateMany, deleteMany }, approvalRequest: { count: vi.fn().mockResolvedValue(0) }, conversationComputerAttemptCredential: { count: vi.fn().mockResolvedValue(1) } } as unknown as Prisma.TransactionClient;
		const repository = new PrismaConversationComputerLifecycleProjectionRepository(transaction);
		await expect(repository.clearActiveLease({ computer: _LEASE.computer, lease: { leaseId: "lease-2", leaseGeneration: 2 } })).resolves.toBe(false);
		expect(deleteMany).not.toHaveBeenCalled();
	});
});
