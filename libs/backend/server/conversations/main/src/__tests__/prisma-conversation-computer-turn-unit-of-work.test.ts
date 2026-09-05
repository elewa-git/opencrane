import type { ConversationEntry } from "@opencrane/contracts";
import type { HistoryRecordedEvent } from "@opencrane/backend/server/infra/history-store";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PrismaConversationComputerTurnUnitOfWork } from "../db/prisma-conversation-computer-turn-unit-of-work";
import { PrismaConversationProductAuthorizationRepository } from "../db/conversation-product-authorization";

const _COMMAND = { siloId: "silo-1", conversationId: "conversation-1", computerId: "computer-1", generation: 2, leaseId: "lease-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1", sandboxClaimId: "computer-1-g2" };

function _Entry(): ConversationEntry
{
	return { schemaVersion: 1, id: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", conversationId: "conversation-1", position: "1", author: { kind: "human", principalId: "principal-1", participantId: "user-1", name: "Jente", avatarArtifactRevisionId: null }, provenance: "human-authored", visibility: { audience: "conversation" }, runId: null, causationId: "source-1", correlationId: "request-1", idempotencyKey: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", occurredAt: "2026-09-05T00:00:00.000Z", attestation: null, kind: "message", state: "completed", blocks: [{ id: "block-1", kind: "text", payloadRef: "payload-1", ciphertextDigest: "sha256:cipher" }], replyToEntryId: null, addressedAgentIdentityId: null, activation: "start" };
}

function _Genesis(): HistoryRecordedEvent
{
	return { streamName: "conversation-conversation-1", id: "11c1f1dc-0010-4f13-9c2f-d3841ffd6651", type: "opencrane.conversation-created.v1", data: { genesis: { schemaVersion: 1, siloId: "silo-1", conversationId: "conversation-1", mode: "agent_session", agentServiceId: "service-1", createdByPrincipalId: "principal-1", createdAt: "2026-09-05T00:00:00.000Z" } }, metadata: { siloId: "silo-1", conversationId: "conversation-1" }, revision: 0n, recordedAt: new Date("2026-09-05T00:00:00.000Z") };
}

function _Event(): HistoryRecordedEvent
{
	const entry = _Entry();
	return { streamName: "conversation-conversation-1", id: entry.id, type: "opencrane.conversation-entry.v1", data: { entry }, metadata: { siloId: "silo-1", conversationId: "conversation-1", causationId: entry.causationId, correlationId: entry.correlationId, idempotencyKey: entry.idempotencyKey }, revision: 1n, recordedAt: new Date(entry.occurredAt) };
}

async function *_Events(): AsyncIterable<HistoryRecordedEvent>
{
	yield _Genesis();
	yield _Event();
}

function _Harness(payloads: readonly object[] = [_Payload()], memberships: readonly object[] = [{ subject: "user-1" }])
{
	const transaction = {
		conversation: { findFirst: vi.fn().mockResolvedValue({ participants: [{ userId: "user-1" }], service: { id: "service-1", name: "Ada", activeRevision: { id: "revision-1", state: "Published", publishedAt: new Date("2026-09-05T00:00:00.000Z"), promptPolicyVersion: "compiler-v1", personaRevisionId: null, budget: { maxTokens: 2048 }, modelDefinition: { publicModelName: "model-1", generatedOutputCapabilities: ["image_png"] } } } }) },
		orgMembership: { findMany: vi.fn().mockResolvedValue(memberships) },
		principal: { findMany: vi.fn().mockResolvedValue([{ id: "principal-1", subject: "user-1" }]) },
		personaRevision: { findUnique: vi.fn() },
		conversationPrivatePayload: { findMany: vi.fn().mockResolvedValue(payloads) },
	};
	const prisma = { $transaction: vi.fn(async (operation: (client: object) => Promise<unknown>) => await operation(transaction)) };
	const history = { readStream: vi.fn().mockImplementation(_Events) };
	const cipher = { decrypt: vi.fn().mockReturnValue("Hello"), encrypt: vi.fn() };
	return new PrismaConversationComputerTurnUnitOfWork(prisma as never, history, cipher as never, 75_000);
}

function _Payload(overrides: object = {})
{
	return { id: "payload-1", siloId: "silo-1", conversationId: "conversation-1", authorSubject: "user-1", keyId: "key-1", nonce: Buffer.from("nonce"), authTag: Buffer.from("tag"), ciphertext: Buffer.from("cipher"), ciphertextDigest: "sha256:cipher", ...overrides };
}

afterEach(function _RestoreSpies() { vi.restoreAllMocks(); });

describe("PrismaConversationComputerTurnUnitOfWork", function _PrismaConversationComputerTurnUnitOfWorkSuite()
{
	it("denies compilation after membership or current Use authority is revoked", async function _RevokedAuthority()
	{
		vi.spyOn(PrismaConversationProductAuthorizationRepository.prototype, "canAccess").mockResolvedValue(false);
		await expect(_Harness().compile(_COMMAND)).rejects.toThrow("currently authorized active participant");
		await expect(_Harness([_Payload()], []).compile(_COMMAND)).rejects.toThrow("currently authorized active participant");
	});

	it.each([
		[[], "missing"],
		[[_Payload({ authorSubject: "user-2" })], "foreign author"],
		[[_Payload(), _Payload()], "duplicate"],
	])("rejects %s private payload rows", async function _InvalidPayload(payloads)
	{
		vi.spyOn(PrismaConversationProductAuthorizationRepository.prototype, "canAccess").mockResolvedValue(true);
		await expect(_Harness(payloads as readonly object[]).compile(_COMMAND)).rejects.toThrow("every private payload exactly once");
	});

	it("freezes deterministic compiled capabilities and configured budget", async function _DeterministicCompilation()
	{
		vi.spyOn(PrismaConversationProductAuthorizationRepository.prototype, "canAccess").mockResolvedValue(true);
		const authority = _Harness();
		const first = await authority.compile(_COMMAND);
		const second = await authority.compile(_COMMAND);
		expect(second?.compiledInput).toEqual(first?.compiledInput);
		expect(first?.compiledInput.model.generatedOutputCapabilities).toEqual(["image_png"]);
		expect(first?.compiledInput.budget).toEqual({ maxTotalTokens: 2048, maxCostUsdMicros: 75_000, maxToolInvocations: 0, wallClockDeadlineEpochMs: null });
	});
});
