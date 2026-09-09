import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PrismaConversationComputerCredentialUnitOfWork } from "../db/prisma-conversation-computer-credential-issuer";

const _NOW = Date.parse("2026-09-07T00:00:00.000Z");
const _EXPIRES = new Date(_NOW + 300_000).toISOString();
const _DIGEST = `sha256:${createHash("sha256").update("original-key").digest("hex")}`;
const _COMMAND = { bootstrapId: "bootstrap-1", keyAlias: "attempt-1", modelAlias: "model-1", computer: { siloId: "silo-1", conversationId: "conversation-1", computerId: "computer-1", agentIdentityId: "identity-1" }, lease: { leaseId: "lease-1", leaseGeneration: 1 }, expirySeconds: 300, notAfter: new Date(_NOW + 600_000).toISOString(), maxBudgetUsd: 0.1 };
const _REUSE = { ..._COMMAND, expectedCredentialDigest: _DIGEST, expectedExpiresAt: _EXPIRES };

beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(_NOW); });
afterEach(() => { vi.restoreAllMocks(); });

function _Ready()
{
	return { bootstrapId: "bootstrap-1", siloId: "silo-1", conversationId: "conversation-1", keyAlias: "attempt-1", modelAlias: "model-1", state: "ready", claimFence: "original-fence", claimExpiresAt: new Date(0), expiresAt: new Date(_EXPIRES), keyId: "key-1", nonce: Buffer.from("nonce"), authTag: Buffer.from("tag"), ciphertext: Buffer.from("original-key"), ciphertextDigest: _DIGEST, credentialDigest: _DIGEST };
}

function _Fixture(initial: Record<string, any> | null = _Ready())
{
	let row = initial;
	const lease = { updateMany: vi.fn().mockResolvedValue({ count: 1 }) };
	const credential = {
		findUnique: vi.fn(async () => row === null ? null : { ...row }),
		create: vi.fn(async ({ data }) =>
		{
			if (row !== null)
				throw new Error("unique conflict");
			row = { keyId: null, nonce: null, authTag: null, ciphertext: null, ciphertextDigest: null, credentialDigest: null, ...data };
			return row;
		}),
		updateMany: vi.fn(async ({ where, data }) =>
		{
			if (row === null || row.bootstrapId !== where.bootstrapId || where.claimFence !== undefined && row.claimFence !== where.claimFence)
				return { count: 0 };
			if (typeof where.state === "string" && row.state !== where.state || where.state?.in && !where.state.in.includes(row.state))
				return { count: 0 };
			row = { ...row, ...data };
			return { count: 1 };
		}),
	};
	const prisma = { $transaction: vi.fn(async (operation) => await operation({ conversationComputerActiveLease: lease, conversationComputerAttemptCredential: credential })) };
	const raw = { issue: vi.fn().mockResolvedValue({ key: "original-key", expiresAt: _EXPIRES }), revoke: vi.fn().mockResolvedValue(undefined), revokeByAlias: vi.fn().mockResolvedValue(undefined) };
	const cipher = {
		encrypt: vi.fn((key: string) => ({ keyId: "key-1", nonce: Buffer.from("nonce"), authTag: Buffer.from("tag"), ciphertext: Buffer.from(key), ciphertextDigest: _DIGEST })),
		decrypt: vi.fn((value: { readonly ciphertext: Uint8Array; readonly ciphertextDigest: string }) =>
		{
			if (`sha256:${createHash("sha256").update(value.ciphertext).digest("hex")}` !== value.ciphertextDigest)
				throw new Error("ciphertext digest mismatch");
			return Buffer.from(value.ciphertext).toString();
		}),
	};
	const authority = new PrismaConversationComputerCredentialUnitOfWork(prisma as never, cipher as never, raw, "silo-1");
	return { authority, credential, lease, prisma, raw, cipher, row: () => row };
}

	describe("attempt credential receipt reuse", function _CredentialReuse()
{
	it("issues once and reuses identical bytes and actual expiry after the first request window", async function _TwoSteps()
	{
		const f = _Fixture(null);
		const first = await f.authority.issueOnce(_COMMAND);
		expect(first).toEqual({ key: "original-key", credentialDigest: _DIGEST, expiresAt: _EXPIRES });
		vi.mocked(Date.now).mockReturnValue(_NOW + 40_000);
		await expect(f.authority.reuseExact({ ..._REUSE, expirySeconds: 1 })).resolves.toEqual(first);
		expect(f.raw.issue).toHaveBeenCalledTimes(1);
		expect(f.raw.issue).toHaveBeenCalledWith(expect.objectContaining({ maxBudgetUsd: 0.1, expirySeconds: 300, notAfter: _EXPIRES }));
		expect(f.raw.revoke).not.toHaveBeenCalled();
		expect(f.credential.create).toHaveBeenCalledTimes(1);
		expect(f.lease.updateMany).toHaveBeenLastCalledWith({ where: { siloId: "silo-1", conversationId: "conversation-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 1, expiresAt: { gte: new Date(_COMMAND.notAfter), gt: expect.any(Date) } }, data: { updatedAt: expect.any(Date) } });
		expect(f.prisma.$transaction).toHaveBeenLastCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
	});

	it.each(["ready", "custodied"])("recovers the %s first key without minting a new allowance", async function _OriginalCustody(state)
	{
		const f = _Fixture({ ..._Ready(), state });
		await expect(f.authority.issueOnce(_COMMAND)).resolves.toEqual({ key: "original-key", credentialDigest: _DIGEST, expiresAt: _EXPIRES });
		expect(f.row()).toMatchObject({ state: "ready", credentialDigest: _DIGEST, expiresAt: new Date(_EXPIRES) });
		expect(f.raw.issue).not.toHaveBeenCalled();
		expect(f.credential.create).not.toHaveBeenCalled();
	});

	it.each(["pending", "alias_cleanup", "custodied", "revoking", "revoked", "unknown"])("refuses %s custody without any mint or promotion", async function _State(state)
	{
		const f = _Fixture({ ..._Ready(), state });
		await expect(f.authority.reuseExact(_REUSE)).rejects.toThrow("not ready");
		expect(f.raw.issue).not.toHaveBeenCalled();
		expect(f.credential.create).not.toHaveBeenCalled();
		expect(f.credential.updateMany).not.toHaveBeenCalled();
	});

	it.each(["missing", "expired", "changed-digest", "changed-expiry", "foreign-silo", "foreign-conversation", "foreign-alias", "foreign-model", "missing-ciphertext", "corrupt-ciphertext", "wrong-key-digest"])("refuses %s custody without replacing it", async function _Mismatch(kind)
	{
		const row: Record<string, any> = _Ready();
		if (kind === "expired")
			row.expiresAt = new Date(_NOW);
		if (kind === "changed-digest")
			row.credentialDigest = "different";
		if (kind === "changed-expiry")
			row.expiresAt = new Date(_NOW + 290_000);
		if (kind === "foreign-silo")
			row.siloId = "silo-2";
		if (kind === "foreign-conversation")
			row.conversationId = "conversation-2";
		if (kind === "foreign-alias")
			row.keyAlias = "attempt-2";
		if (kind === "foreign-model")
			row.modelAlias = "model-2";
		if (kind === "missing-ciphertext")
			row.ciphertext = null;
		if (kind === "corrupt-ciphertext")
			row.ciphertextDigest = "corrupt";
		if (kind === "wrong-key-digest")
		{
			row.ciphertext = Buffer.from("replacement-key");
			row.ciphertextDigest = `sha256:${createHash("sha256").update(row.ciphertext).digest("hex")}`;
		}
		const f = _Fixture(kind === "missing" ? null : row);
		await expect(f.authority.reuseExact(_REUSE)).rejects.toThrow();
		expect(f.raw.issue).not.toHaveBeenCalled();
		expect(f.raw.revoke).not.toHaveBeenCalled();
		expect(f.raw.revokeByAlias).not.toHaveBeenCalled();
		expect(f.credential.create).not.toHaveBeenCalled();
		expect(f.credential.updateMany).not.toHaveBeenCalled();
	});

	it("refuses the current lease and shortened authority before returning key material", async function _CurrentAuthority()
	{
		const f = _Fixture();
		f.lease.updateMany.mockResolvedValueOnce({ count: 0 });
		await expect(f.authority.reuseExact(_REUSE)).rejects.toThrow("current active lease");
		await expect(f.authority.reuseExact({ ..._REUSE, notAfter: new Date(_NOW + 60_000).toISOString() })).rejects.toThrow("current authority expiry");
		await expect(f.authority.reuseExact({ ..._REUSE, notAfter: new Date(_NOW).toISOString() })).rejects.toThrow("unexpired authority");
		expect(f.cipher.decrypt).not.toHaveBeenCalled();
		expect(f.raw.issue).not.toHaveBeenCalled();
	});

	it("clears revoked secrets while preserving a marker that refuses future issuance and reuse", async function _RevokedMarker()
	{
		const f = _Fixture();
		await f.authority.revoke(_COMMAND.bootstrapId);
		expect(f.row()).toMatchObject({ state: "revoked", ciphertext: null, nonce: null, authTag: null, keyId: null, credentialDigest: null, ciphertextDigest: null });
		await f.authority.revoke(_COMMAND.bootstrapId);
		await expect(f.authority.issueOnce(_COMMAND)).rejects.toThrow("already revoked");
		await expect(f.authority.reuseExact(_REUSE)).rejects.toThrow("not ready");
		expect(f.raw.revoke).toHaveBeenCalledTimes(1);
		expect(f.raw.issue).not.toHaveBeenCalled();
	});

	it("retains an uncertain mint until alias cleanup and never mints its replacement", async function _UncertainMint()
	{
		const f = _Fixture(null);
		f.raw.issue.mockRejectedValue(new Error("mint response lost"));
		await expect(f.authority.issueOnce(_COMMAND)).rejects.toThrow("mint response lost");
		await expect(f.authority.issueOnce(_COMMAND)).rejects.toThrow("already in progress");
		vi.mocked(Date.now).mockReturnValue(_NOW + 31_000);
		await expect(f.authority.issueOnce(_COMMAND)).rejects.toThrow("cannot replace uncertain issuance");
		await expect(f.authority.issueOnce(_COMMAND)).rejects.toThrow("already revoked");
		expect(f.raw.issue).toHaveBeenCalledTimes(1);
		expect(f.raw.revokeByAlias).toHaveBeenCalledWith({ keyAlias: "attempt-1" });
		expect(f.row()).toMatchObject({ state: "revoked", ciphertext: null });
	});
});
