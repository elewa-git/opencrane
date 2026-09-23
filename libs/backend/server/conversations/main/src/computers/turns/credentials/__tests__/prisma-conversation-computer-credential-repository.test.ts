import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConversationComputerCredentialIssueCommand } from "../../conversation-computer-turn.types";
import { ConversationComputerCredentialPreparationOutcomes as Outcomes, ConversationComputerCredentialStates as States, type ConversationComputerCredentialCustody } from "../../db/conversation-computer-credential-persistence.types";
import { PrismaConversationComputerCredentialRepository } from "../prisma-conversation-computer-credential-repository";

/** Keeps repository expiry checks independent of the machine's clock. */
const _NOW = Date.parse("2026-09-07T00:00:00.000Z");
/** Uses different values for the bootstrap and run so the repository must bind both. */
const _INPUT: ConversationComputerCredentialIssueCommand = { bootstrapId: "bootstrap-1", runId: "run-1", attempt: 2, keyAlias: "attempt-key", modelAlias: "model-1", computer: { siloId: "silo-1", conversationId: "conversation-1", computerId: "computer-1", agentIdentityId: "identity-1" }, lease: { leaseId: "lease-1", leaseGeneration: 3 }, expirySeconds: 300, notAfter: new Date(_NOW + 600_000).toISOString(), maxBudgetUsd: 0.1 };
/** Selects every immutable coordinate checked when an existing row is recovered. */
const _CHANGED_COORDINATES = [{ runId: "run-2" }, { attempt: 3 }, { siloId: "silo-2" }, { conversationId: "conversation-2" }, { keyAlias: "changed-key" }, { modelAlias: "changed-model" }];

beforeEach(function _Clock() { vi.useFakeTimers(); vi.setSystemTime(_NOW); });
afterEach(function _RestoreClock() { vi.useRealTimers(); vi.restoreAllMocks(); });

/** Supplies a saved key without authorizing its use. */
function _row(state = States.Ready): ConversationComputerCredentialCustody
{
	return { bootstrapId: _INPUT.bootstrapId, runId: _INPUT.runId, attempt: _INPUT.attempt, siloId: _INPUT.computer.siloId, conversationId: _INPUT.computer.conversationId, keyAlias: _INPUT.keyAlias, modelAlias: _INPUT.modelAlias, state, claimFence: "saved-fence", claimExpiresAt: new Date(_NOW + 30_000), expiresAt: new Date(_NOW + 300_000), keyId: "key-1", nonce: Buffer.from("nonce"), authTag: Buffer.from("tag"), ciphertext: Buffer.from("secret"), ciphertextDigest: "cipher-digest", credentialDigest: "key-digest" };
}

/** Exercises the real repository with mocked ORM delegates; database triggers are tested separately. */
function _fixture(row: ConversationComputerCredentialCustody | null = _row())
{
	const run = { findFirst: vi.fn().mockResolvedValue({ id: _INPUT.runId }) };
	const lease = { updateMany: vi.fn().mockResolvedValue({ count: 1 }) };
	const credential = { findUnique: vi.fn().mockResolvedValue(row), create: vi.fn().mockResolvedValue(undefined), updateMany: vi.fn().mockResolvedValue({ count: 1 }) };
	const repository = new PrismaConversationComputerCredentialRepository({ agentRun: run, conversationComputerActiveLease: lease, conversationComputerAttemptCredential: credential } as never, "silo-1");
	return { repository, run, lease, credential };
}

/** Replays the saved receipt while retaining the original issue coordinates. */
function _reuseInput()
{
	return { ..._INPUT, expectedCredentialDigest: "key-digest", expectedExpiresAt: new Date(_NOW + 300_000).toISOString() };
}

describe("PrismaConversationComputerCredentialRepository run identity", function _RunIdentity()
{
	it("checks the exact current run before claiming and persists its attempt with custody", async function _Admission()
	{
		const { repository, run, credential } = _fixture(null);
		await expect(repository.prepare(_INPUT)).resolves.toMatchObject({ outcome: Outcomes.Claim });
		expect(run.findFirst).toHaveBeenCalledWith({ where: { id: "run-1", attempt: 2, siloId: "silo-1", conversationId: "conversation-1" }, select: { id: true } });
		expect(credential.create).toHaveBeenCalledWith({ data: expect.objectContaining({ bootstrapId: "bootstrap-1", runId: "run-1", attempt: 2, siloId: "silo-1", conversationId: "conversation-1", keyAlias: "attempt-key", modelAlias: "model-1", state: States.Pending }) });
	});

	it.each(_CHANGED_COORDINATES)("refuses existing custody with changed coordinates %j before preparation or reuse", async function _ChangedCustody(changed)
	{
		const { repository, credential } = _fixture({ ..._row(), ...changed });
		await expect(repository.prepare(_INPUT)).rejects.toThrow("changed its frozen coordinates");
		await expect(repository.reuseExact(_reuseInput())).rejects.toThrow("changed its frozen coordinates");
		expect(credential.create).not.toHaveBeenCalled();
		expect(credential.updateMany).not.toHaveBeenCalled();
	});

	it("refuses preparation, reuse and finalization if the current run no longer matches", async function _MissingCurrentRun()
	{
		const { repository, run, credential } = _fixture();
		run.findFirst.mockResolvedValue(null);
		await expect(repository.prepare(_INPUT)).rejects.toThrow("current run and attempt");
		await expect(repository.reuseExact(_reuseInput())).rejects.toThrow("current run and attempt");
		await expect(repository.finalize(_INPUT, "saved-fence")).rejects.toThrow("current run and attempt");
		expect(run.findFirst).toHaveBeenCalledTimes(3);
		expect(credential.findUnique).not.toHaveBeenCalled();
		expect(credential.create).not.toHaveBeenCalled();
		expect(credential.updateMany).not.toHaveBeenCalled();
	});

	it.each([{ runId: "" }, { attempt: 0 }, { attempt: 1.5 }])("refuses incomplete run identity %j without querying for a broader match", async function _InvalidIdentity(changed)
	{
		const { repository, run, credential } = _fixture(null);
		await expect(repository.prepare({ ..._INPUT, ...changed })).rejects.toThrow("current run and attempt");
		expect(run.findFirst).not.toHaveBeenCalled();
		expect(credential.create).not.toHaveBeenCalled();
	});

	it("rejects another silo before touching lease, run or custody", async function _ConfiguredSilo()
	{
		const { repository, run, lease, credential } = _fixture();
		await expect(repository.prepare({ ..._INPUT, computer: { ..._INPUT.computer, siloId: "silo-2" } })).rejects.toThrow("configured silo");
		expect(run.findFirst).not.toHaveBeenCalled();
		expect(lease.updateMany).not.toHaveBeenCalled();
		expect(credential.findUnique).not.toHaveBeenCalled();
	});

	it("preserves the active-lease gate ahead of run and receipt disclosure", async function _MissingLease()
	{
		const { repository, run, lease, credential } = _fixture();
		lease.updateMany.mockResolvedValue({ count: 0 });
		await expect(repository.reuseExact(_reuseInput())).rejects.toThrow("current active lease");
		expect(run.findFirst).not.toHaveBeenCalled();
		expect(credential.findUnique).not.toHaveBeenCalled();
	});

	it("binds storage and promotion to all original coordinates and the claim fence", async function _WritePredicates()
	{
		const { repository, credential } = _fixture();
		const encrypted = { keyId: "key-1", nonce: Buffer.from("nonce"), authTag: Buffer.from("tag"), ciphertext: Buffer.from("secret"), ciphertextDigest: "cipher-digest" };
		const coordinates = { bootstrapId: "bootstrap-1", runId: "run-1", attempt: 2, siloId: "silo-1", conversationId: "conversation-1", keyAlias: "attempt-key", modelAlias: "model-1", claimFence: "saved-fence" };
		await repository.storeCustody(_INPUT, "saved-fence", encrypted, "key-digest", new Date(_NOW + 300_000).toISOString());
		await repository.finalize(_INPUT, "saved-fence");
		expect(credential.updateMany).toHaveBeenNthCalledWith(1, { where: { ...coordinates, state: States.Pending }, data: expect.objectContaining({ state: States.Custodied, credentialDigest: "key-digest" }) });
		expect(credential.updateMany).toHaveBeenNthCalledWith(2, { where: { ...coordinates, state: States.Custodied, expiresAt: { gt: new Date(_NOW), lte: new Date(_INPUT.notAfter) } }, data: { state: States.Ready } });
	});

	it("requires the original receipt even when run and lease identity still match", async function _SavedReceipt()
	{
		const { repository } = _fixture();
		await expect(repository.reuseExact(_reuseInput())).resolves.toEqual(_row());
		await expect(repository.reuseExact({ ..._reuseInput(), expectedCredentialDigest: "changed" })).rejects.toThrow("changed its saved receipt");
		await expect(repository.reuseExact({ ..._reuseInput(), expectedExpiresAt: new Date(_NOW + 60_000).toISOString() })).rejects.toThrow("changed its saved receipt");
	});

	it("retains late provider custody and permits cleanup without a current run or lease", async function _CleanupAfterStop()
	{
		const row = { ..._row(), expiresAt: new Date(0) };
		const { repository, run, lease, credential } = _fixture(row);
		run.findFirst.mockRejectedValue(new Error("run must not be needed for cleanup"));
		lease.updateMany.mockRejectedValue(new Error("lease must not be needed for cleanup"));
		const encrypted = { keyId: "key-1", nonce: Buffer.from("nonce"), authTag: Buffer.from("tag"), ciphertext: Buffer.from("secret"), ciphertextDigest: "cipher-digest" };
		await repository.storeCustody(_INPUT, "saved-fence", encrypted, "key-digest", new Date(0).toISOString());
		const claimed = await repository.claimRevocation(_INPUT.bootstrapId);
		expect(claimed).toMatchObject({ runId: "run-1", attempt: 2, state: States.Revoking });
		await repository.finishRevocation(_INPUT.bootstrapId, claimed!.claimFence);
		expect(credential.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: States.Revoked, ciphertext: null }) }));
		expect(run.findFirst).not.toHaveBeenCalled();
		expect(lease.updateMany).not.toHaveBeenCalled();
	});
});
