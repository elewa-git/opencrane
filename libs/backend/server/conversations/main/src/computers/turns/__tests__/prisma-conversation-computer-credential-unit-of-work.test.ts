import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PrismaConversationComputerCredentialUnitOfWork } from "../db/prisma-conversation-computer-credential-issuer";
import { PrismaConversationComputerCredentialRepository } from "../credentials/prisma-conversation-computer-credential-repository";

const _NOW = Date.parse("2026-09-07T00:00:00.000Z");
const _EXPIRES_AT = new Date(_NOW + 300_000).toISOString();
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(_NOW); });
afterEach(() => { vi.restoreAllMocks(); });

const _INPUT = { bootstrapId: "bootstrap-1", keyAlias: "attempt-1", modelAlias: "model-1", computer: { siloId: "silo-1", conversationId: "conversation-1", computerId: "computer-1", agentIdentityId: "identity-1" }, lease: { leaseId: "lease-1", leaseGeneration: 1 }, expirySeconds: 300, notAfter: new Date(_NOW + 600_000).toISOString(), maxBudgetUsd: 0.1 };

function _Cipher()
{
	return {
		encrypt: vi.fn((value: string) => ({ keyId: "key-1", nonce: Buffer.from("nonce"), authTag: Buffer.from("tag"), ciphertext: Buffer.from(value), ciphertextDigest: `sha256:${createHash("sha256").update(value).digest("hex")}` })),
		decrypt: vi.fn((value: { readonly ciphertext: Uint8Array }) => Buffer.from(value.ciphertext).toString()),
	};
}

function _UnitOfWork(repository: object, raw: { readonly issue: ReturnType<typeof vi.fn>; readonly revoke: ReturnType<typeof vi.fn> }, cipher = _Cipher())
{
	const transaction = { conversationComputerActiveLease: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, ...repository };
	const prisma = { $transaction: vi.fn(async (operation: (transaction: object) => Promise<unknown>) => await operation(transaction)) };
	return new PrismaConversationComputerCredentialUnitOfWork(prisma as never, cipher as never, raw as never, "silo-1");
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
		const raw = { issue: vi.fn().mockResolvedValue({ key: "secret", expiresAt: _EXPIRES_AT }), revoke: vi.fn() };
		const authority = _UnitOfWork(repository, raw);
		const outcomes = await Promise.allSettled([authority.issueOnce(_INPUT), authority.issueOnce(_INPUT)]);
		expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
		expect(outcomes.filter(outcome => outcome.status === "rejected")).toHaveLength(1);
		expect(raw.issue).toHaveBeenCalledTimes(1);
	});

	it("revokes a minted key when fenced persistence loses ownership", async function _FailedPersistence()
	{
		const repository = { conversationComputerAttemptCredential: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(async ({ data }: { readonly data: object }) => data), updateMany: vi.fn().mockResolvedValue({ count: 0 }) } };
		const raw = { issue: vi.fn().mockResolvedValue({ key: "secret", expiresAt: _EXPIRES_AT }), revoke: vi.fn().mockResolvedValue(undefined) };
		await expect(_UnitOfWork(repository, raw).issueOnce(_INPUT)).rejects.toThrow("lost custody");
		expect(raw.revoke).toHaveBeenCalledWith({ keyAlias: "attempt-1", key: "secret" });
	});

	it("revokes a minted key when encryption fails before custody persistence", async function _FailedEncryption()
	{
		const repository = { conversationComputerAttemptCredential: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(async ({ data }: { readonly data: object }) => data), updateMany: vi.fn() } };
		const raw = { issue: vi.fn().mockResolvedValue({ key: "secret", expiresAt: _EXPIRES_AT }), revoke: vi.fn().mockResolvedValue(undefined) };
		const cipher = { ..._Cipher(), encrypt: vi.fn().mockImplementation(function _FailEncryption() { throw new Error("cipher unavailable"); }) };
		await expect(_UnitOfWork(repository, raw, cipher).issueOnce(_INPUT)).rejects.toThrow("cipher unavailable");
		expect(raw.revoke).toHaveBeenCalledWith({ keyAlias: "attempt-1", key: "secret" });
	});

	it("revokes a minted key when custody persistence throws", async function _FailedUpdate()
	{
		const repository = { conversationComputerAttemptCredential: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(async ({ data }: { readonly data: object }) => data), updateMany: vi.fn().mockRejectedValue(new Error("database unavailable")) } };
		const raw = { issue: vi.fn().mockResolvedValue({ key: "secret", expiresAt: _EXPIRES_AT }), revoke: vi.fn().mockResolvedValue(undefined) };
		await expect(_UnitOfWork(repository, raw).issueOnce(_INPUT)).rejects.toThrow("database unavailable");
		expect(raw.revoke).toHaveBeenCalledWith({ keyAlias: "attempt-1", key: "secret" });
	});

	it("retains encrypted custody when finalization and cleanup revocation both fail", async function _RetainsCustody()
	{
		let row: Record<string, any> | null = null;
		const credential = {
			findUnique: vi.fn(async () => row),
			create: vi.fn(async ({ data }: { readonly data: Record<string, unknown> }) => (row = { ...data, keyId: null, nonce: null, authTag: null, ciphertext: null, ciphertextDigest: null, credentialDigest: null })),
			updateMany: vi.fn(async ({ data }: { readonly data: Record<string, unknown> }) =>
			{
				if (data.state === "ready")
					throw new Error("finalize unavailable");
				row = { ...row, ...data };
				return { count: 1 };
			}),
		};
		const transaction = { conversationComputerActiveLease: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, conversationComputerAttemptCredential: credential };
		const prisma = { $transaction: vi.fn(async (operation: (value: object) => Promise<unknown>) => await operation(transaction)) };
		const raw = { issue: vi.fn().mockResolvedValue({ key: "secret", expiresAt: _EXPIRES_AT }), revoke: vi.fn().mockRejectedValue(new Error("gateway unavailable")), revokeByAlias: vi.fn() };
		const authority = new PrismaConversationComputerCredentialUnitOfWork(prisma as never, _Cipher() as never, raw, "silo-1");
		await expect(authority.issueOnce(_INPUT)).rejects.toThrow("finalize unavailable");
		expect(row).toMatchObject({ state: "revoking", ciphertext: Buffer.from("secret") });
	});

	it.each(["encryption", "custody"] as const)("cleans up a %s failure by durable alias without allowing another mint", async function _AliasRecovery(failure)
	{
		let row: Record<string, any> | null = null;
		let fail = true;
		const credential = {
			findUnique: vi.fn(async () => row),
			create: vi.fn(async ({ data }: { readonly data: Record<string, unknown> }) => (row = { ...data, keyId: null, nonce: null, authTag: null, ciphertext: null, ciphertextDigest: null, credentialDigest: null })),
			updateMany: vi.fn(async ({ data }: { readonly data: Record<string, unknown> }) =>
			{
				if (failure === "custody" && data.state === "custodied" && fail)
				{
					fail = false;
					throw new Error("custody unavailable");
				}
				row = { ...row, ...data };
				return { count: 1 };
			}),
		};
		const cipher = _Cipher();
		if (failure === "encryption")
			cipher.encrypt.mockImplementationOnce(function _Fail() { fail = false; throw new Error("cipher unavailable"); });
		const transaction = { conversationComputerActiveLease: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, conversationComputerAttemptCredential: credential };
		const prisma = { $transaction: vi.fn(async (operation: (value: object) => Promise<unknown>) => await operation(transaction)) };
		const raw = { issue: vi.fn().mockResolvedValue({ key: "lost-secret", expiresAt: _EXPIRES_AT }), revoke: vi.fn().mockRejectedValueOnce(new Error("gateway unavailable")), revokeByAlias: vi.fn().mockResolvedValue(undefined) };
		const authority = new PrismaConversationComputerCredentialUnitOfWork(prisma as never, cipher as never, raw, "silo-1");
		await expect(authority.issueOnce(_INPUT)).rejects.toThrow(failure === "encryption" ? "cipher unavailable" : "custody unavailable");
		expect(row).toMatchObject({ state: "alias_cleanup", keyAlias: "attempt-1" });
		await expect(authority.issueOnce(_INPUT)).rejects.toThrow("cannot replace uncertain issuance");
		expect(row).toMatchObject({ state: "revoked", ciphertext: null });
		await expect(authority.issueOnce(_INPUT)).rejects.toThrow("already revoked");
		expect(raw.issue).toHaveBeenCalledTimes(1);
		expect(raw.revokeByAlias).toHaveBeenCalledWith({ keyAlias: "attempt-1" });
	});

	it("uses the configured silo authority independently of the sandbox namespace", async function _ConfiguredSilo()
	{
		const repository = { conversationComputerAttemptCredential: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(async ({ data }: { readonly data: object }) => data), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
		const raw = { issue: vi.fn().mockResolvedValue({ key: "secret", expiresAt: _EXPIRES_AT }), revoke: vi.fn() };
		await expect(_UnitOfWork(repository, raw).issueOnce(_INPUT)).resolves.toMatchObject({ key: "secret" });
		expect(repository.conversationComputerAttemptCredential.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ siloId: "silo-1" }) }));
	});

	it("rejects admission after lifecycle cleared the exact active lease", async function _RejectsReleasedLease()
	{
		const repository = { conversationComputerActiveLease: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, conversationComputerAttemptCredential: { findUnique: vi.fn() } };
		const raw = { issue: vi.fn(), revoke: vi.fn() };
		await expect(_UnitOfWork(repository, raw).issueOnce(_INPUT)).rejects.toThrow("current active lease");
		expect(raw.issue).not.toHaveBeenCalled();
	});

	it("rechecks the exact active lease inside finalization before returning the key", async function _FinalizeLeaseFence()
	{
		let row: Record<string, any> | null = null;
		const credential = {
			findUnique: vi.fn(async () => row),
			create: vi.fn(async ({ data }: { readonly data: Record<string, unknown> }) => (row = { ...data, keyId: null, nonce: null, authTag: null, ciphertext: null, ciphertextDigest: null, credentialDigest: null })),
			updateMany: vi.fn(async ({ data }: { readonly data: Record<string, unknown> }) => { row = { ...row, ...data }; return { count: 1 }; }),
		};
		const lease = { updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }) };
		const prisma = { $transaction: vi.fn(async (operation: (value: object) => Promise<unknown>) => await operation({ conversationComputerActiveLease: lease, conversationComputerAttemptCredential: credential })) };
		const raw = { issue: vi.fn().mockResolvedValue({ key: "secret", expiresAt: _EXPIRES_AT }), revoke: vi.fn().mockResolvedValue(undefined), revokeByAlias: vi.fn() };
		await expect(new PrismaConversationComputerCredentialUnitOfWork(prisma as never, _Cipher() as never, raw, "silo-1").issueOnce(_INPUT)).rejects.toThrow("finalization requires the current active lease");
		expect(raw.revoke).toHaveBeenCalledWith({ keyAlias: "attempt-1", key: "secret" });
	});

	it("expires custodied keys and fences ready promotion against elapsed expiry", async function _ExpiredCustody()
	{
		const row = { bootstrapId: "bootstrap-1", siloId: "silo-1", conversationId: "conversation-1", keyAlias: "attempt-1", modelAlias: "model-1", state: "custodied", claimFence: "fence-1", expiresAt: new Date(0), claimExpiresAt: new Date(0), keyId: "key-1", nonce: Buffer.from("nonce"), authTag: Buffer.from("tag"), ciphertext: Buffer.from("secret"), ciphertextDigest: `sha256:${createHash("sha256").update("secret").digest("hex")}`, credentialDigest: `sha256:${createHash("sha256").update("secret").digest("hex")}` };
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const repository = new PrismaConversationComputerCredentialRepository({ conversationComputerActiveLease: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, conversationComputerAttemptCredential: { findUnique: vi.fn().mockResolvedValue(row), updateMany } } as never, "silo-1");
		await expect(repository.prepare(_INPUT)).resolves.toEqual({ outcome: "expired", row });
		await repository.finalize(_INPUT, "fence-1");
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ expiresAt: { gt: expect.any(Date), lte: new Date(_INPUT.notAfter) } }) }));
	});

	it("makes concurrent credential revocation idempotent", async function _ConcurrentRevoke()
	{
		const row = { bootstrapId: "bootstrap-1", siloId: "silo-1", conversationId: "conversation-1", keyAlias: "attempt-1", modelAlias: "model-1", state: "ready", claimFence: "old", expiresAt: new Date(Date.now() + 60_000), claimExpiresAt: new Date(0), keyId: "key-1", nonce: Buffer.from("nonce"), authTag: Buffer.from("tag"), ciphertext: Buffer.from("secret"), ciphertextDigest: `sha256:${createHash("sha256").update("secret").digest("hex")}`, credentialDigest: `sha256:${createHash("sha256").update("secret").digest("hex")}` };
		let claimed = false;
		const repository = { conversationComputerAttemptCredential: {
			findUnique: vi.fn().mockResolvedValue(row),
			updateMany: vi.fn(async () => ({ count: claimed ? 0 : (claimed = true, 1) })),
		} };
		const raw = { issue: vi.fn(), revoke: vi.fn().mockResolvedValue(undefined) };
		const authority = _UnitOfWork(repository, raw);
		await Promise.all([authority.revoke("bootstrap-1"), authority.revoke("bootstrap-1")]);
		expect(raw.revoke).toHaveBeenCalledTimes(1);
	});
	it("refuses expired authority before minting or disclosing a key", async function ()
	{
		const raw = { issue: vi.fn(), revoke: vi.fn() };
		await expect(_UnitOfWork({}, raw).issueOnce({ ..._INPUT, notAfter: new Date(_NOW).toISOString() })).rejects.toThrow("unexpired authority");
		expect(raw.issue).not.toHaveBeenCalled();
	});

	it("revokes a provider key whose actual expiry exceeds the absolute authority bound", async function ()
	{
		const repository = { conversationComputerAttemptCredential: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(async ({ data }) => data), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
		const raw = { issue: vi.fn().mockResolvedValue({ key: "too-long", expiresAt: new Date(_NOW + 120_000).toISOString() }), revoke: vi.fn().mockResolvedValue(undefined) };
		await expect(_UnitOfWork(repository, raw).issueOnce({ ..._INPUT, notAfter: new Date(_NOW + 30_000).toISOString() })).rejects.toThrow("exceeds its current authority expiry");
		expect(raw.issue).toHaveBeenCalledWith(expect.objectContaining({ expirySeconds: 30, notAfter: new Date(_NOW + 30_000).toISOString() }));
		expect(raw.revoke).toHaveBeenCalledWith({ keyAlias: "attempt-1", key: "too-long" });
		expect(repository.conversationComputerAttemptCredential.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: "custodied" }) }));
	});

	it("revokes custody that outlives shortened authority without replacing its spent budget", async function ()
	{
		const secret = "old-secret";
		let row: any = { bootstrapId: "bootstrap-1", siloId: "silo-1", conversationId: "conversation-1", keyAlias: "attempt-1", modelAlias: "model-1", state: "ready", claimFence: "old", expiresAt: new Date(_NOW + 120_000), claimExpiresAt: new Date(0), keyId: "key-1", nonce: Buffer.from("nonce"), authTag: Buffer.from("tag"), ciphertext: Buffer.from(secret), ciphertextDigest: `sha256:${createHash("sha256").update(secret).digest("hex")}`, credentialDigest: `sha256:${createHash("sha256").update(secret).digest("hex")}` };
		const credential = { findUnique: vi.fn(async () => row), create: vi.fn(async ({ data }) => { row = { ...data }; return row; }), updateMany: vi.fn(async ({ data }) => { row = { ...row, ...data }; return { count: 1 }; }) };
		const raw = { issue: vi.fn(), revoke: vi.fn().mockResolvedValue(undefined) };
		const authority = _UnitOfWork({ conversationComputerAttemptCredential: credential }, raw);
		await expect(authority.issueOnce({ ..._INPUT, notAfter: new Date(_NOW + 20_000).toISOString() })).rejects.toThrow("cannot replace expired");
		expect(raw.revoke).toHaveBeenCalledWith({ keyAlias: "attempt-1", key: secret });
		expect(row).toMatchObject({ state: "revoked", ciphertext: null, credentialDigest: null });
		await expect(authority.issueOnce(_INPUT)).rejects.toThrow("already revoked");
		expect(raw.issue).not.toHaveBeenCalled();
	});

});
