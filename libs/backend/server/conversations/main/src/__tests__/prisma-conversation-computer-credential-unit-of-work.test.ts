import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { PrismaConversationComputerCredentialUnitOfWork } from "../db/prisma-conversation-computer-credential-issuer";

const _INPUT = { bootstrapId: "bootstrap-1", keyAlias: "attempt-1", modelAlias: "model-1", siloId: "silo-1", conversationId: "conversation-1", expirySeconds: 300, maxBudgetUsd: 0.1 };

function _Cipher()
{
	return {
		encrypt: vi.fn((value: string) => ({ keyId: "key-1", nonce: Buffer.from("nonce"), authTag: Buffer.from("tag"), ciphertext: Buffer.from(value), ciphertextDigest: `sha256:${createHash("sha256").update(value).digest("hex")}` })),
		decrypt: vi.fn((value: { readonly ciphertext: Uint8Array }) => Buffer.from(value.ciphertext).toString()),
	};
}

function _UnitOfWork(repository: object, raw: { readonly issue: ReturnType<typeof vi.fn>; readonly revoke: ReturnType<typeof vi.fn> })
{
	const prisma = { $transaction: vi.fn(async (operation: (transaction: object) => Promise<unknown>) => await operation(repository)) };
	return new PrismaConversationComputerCredentialUnitOfWork(prisma as never, _Cipher() as never, raw as never, "silo-1");
}

describe("PrismaConversationComputerCredentialUnitOfWork", function _PrismaConversationComputerCredentialUnitOfWorkSuite()
{
	it("allows only one concurrent caller to own a missing credential mint", async function _ConcurrentMint()
	{
		let created = false;
		const repository = { conversationComputerAttemptCredential: {
			findUnique: vi.fn().mockResolvedValue(null),
			create: vi.fn(async ({ data }: { readonly data: object }) =>
			{
				if (created)
					throw new Error("unique conflict");
				created = true;
				return data;
			}),
			updateMany: vi.fn().mockResolvedValue({ count: 1 }),
		} };
		const raw = { issue: vi.fn().mockResolvedValue({ key: "secret" }), revoke: vi.fn() };
		const authority = _UnitOfWork(repository, raw);
		const outcomes = await Promise.allSettled([authority.issueOrRotate(_INPUT), authority.issueOrRotate(_INPUT)]);
		expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
		expect(outcomes.filter(outcome => outcome.status === "rejected")).toHaveLength(1);
		expect(raw.issue).toHaveBeenCalledTimes(1);
	});

	it("revokes a minted key when fenced persistence loses ownership", async function _FailedPersistence()
	{
		const repository = { conversationComputerAttemptCredential: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(async ({ data }: { readonly data: object }) => data), updateMany: vi.fn().mockResolvedValue({ count: 0 }) } };
		const raw = { issue: vi.fn().mockResolvedValue({ key: "secret" }), revoke: vi.fn().mockResolvedValue(undefined) };
		await expect(_UnitOfWork(repository, raw).issueOrRotate(_INPUT)).rejects.toThrow("lost custody");
		expect(raw.revoke).toHaveBeenCalledWith({ keyAlias: "attempt-1", key: "secret" });
	});

	it("makes concurrent credential revocation idempotent", async function _ConcurrentRevoke()
	{
		const row = { bootstrapId: "bootstrap-1", siloId: "silo-1", conversationId: "conversation-1", keyAlias: "attempt-1", modelAlias: "model-1", state: "ready", claimFence: "old", expiresAt: new Date(Date.now() + 60_000), claimExpiresAt: new Date(0), keyId: "key-1", nonce: Buffer.from("nonce"), authTag: Buffer.from("tag"), ciphertext: Buffer.from("secret"), ciphertextDigest: `sha256:${createHash("sha256").update("secret").digest("hex")}`, credentialDigest: `sha256:${createHash("sha256").update("secret").digest("hex")}` };
		let claimed = false;
		const repository = { conversationComputerAttemptCredential: {
			findUnique: vi.fn().mockResolvedValue(row),
			updateMany: vi.fn(async () => ({ count: claimed ? 0 : (claimed = true, 1) })),
			deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
		} };
		const raw = { issue: vi.fn(), revoke: vi.fn().mockResolvedValue(undefined) };
		const authority = _UnitOfWork(repository, raw);
		await Promise.all([authority.revoke("bootstrap-1"), authority.revoke("bootstrap-1")]);
		expect(raw.revoke).toHaveBeenCalledTimes(1);
	});
});
