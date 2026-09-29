import { ConversationLifecycle, ConversationMode } from "@prisma/client";

import { PrismaManagedAgentConversationResolver } from "@opencrane/backend/server/agents/agent-services";
import type { PrepareRoutineOccurrenceCommand } from "@opencrane/backend/server/agents/scheduling/contract";
import { AesGcmConversationPrivatePayloadCipher } from "@opencrane/backend/server/conversations/history";
import { RoutineFiringTrigger } from "@opencrane/models/agents";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PrismaConversationProductAuthorizationRepository } from "../../authorization/db/conversation-product-authorization";
import { PrismaRoutineOccurrenceProjectionRepository } from "../prisma-routine-occurrence-projection-repository";
import { _RoutineEventId } from "../routine-occurrence-history.mapper";
import { _RoutineComputerId, _RoutineInstructionCoordinates } from "../routine-occurrence-preparation.mapper";

/** Stable creation time returned by the hidden conversation projection. */
const _CREATED = new Date("2026-09-25T10:00:01.000Z");
/** Complete routine occurrence input owned by scheduling. */
const _COMMAND: PrepareRoutineOccurrenceCommand = {
	siloId: "silo-1", routineId: "routine-1", routineRevision: 2, firingId: "firing-1",
	task: { taskId: "task-1", taskName: "agents.routines.occurrence/v1", idempotencyKey: "occurrence-1" },
	admittedRunId: null, trigger: RoutineFiringTrigger.Automatic, scheduledSlot: "2026-09-25T10:00:00.000Z",
	conversationId: "occurrence-1", destinationConversationId: "destination-1", selectedManagedServiceId: "service-1",
	requesterPrincipalId: "principal-1", requesterIssuer: "https://issuer.test", requesterSubjectId: "subject-1",
	requesterAuthenticatedAt: "2026-09-24T12:00:00.000Z", audiencePrincipalIds: ["principal-1", "principal-2"],
	instruction: "Prepare the weekly report",
};
/** Current managed service identity and profile resolved inside the transaction. */
const _CANDIDATE = { agentServiceId: "service-1", agentRevisionId: "revision-1", agentIdentityId: "identity-1", principalId: "service-principal", name: "Company", workloadProfile: "company", profileRevisionId: "profile-1" };

afterEach(function _Restore() { vi.restoreAllMocks(); });

/** Creates the real AES-GCM owner with a deterministic test key and random production nonces. */
function _Cipher(): AesGcmConversationPrivatePayloadCipher
{
	return new AesGcmConversationPrivatePayloadCipher("key-1", { "key-1": Buffer.alloc(32, 7).toString("base64url") });
}

/** Builds the hidden occurrence row selected by the production repository. */
function _Conversation(overrides: Record<string, unknown> = {})
{
	return { id: _COMMAND.conversationId, siloId: _COMMAND.siloId, mode: ConversationMode.AgentSession, lifecycle: ConversationLifecycle.Open, agentServiceId: _COMMAND.selectedManagedServiceId, computerId: _RoutineComputerId(_COMMAND.conversationId), computerAgentIdentityId: _CANDIDATE.agentIdentityId, computerProfileRevisionId: _CANDIDATE.profileRevisionId, createdAt: _CREATED, participants: [], ...overrides };
}

/** Creates narrow stateful Prisma delegates used by the actual projection and payload repositories. */
function _Fixture(initialConversation: ReturnType<typeof _Conversation> | null = null)
{
	let conversation = initialConversation;
	let payload: ReturnType<typeof _PayloadRow> | null = null;
	const participants: Array<{ readonly conversationId: string; readonly userId: string; readonly visibleFromPosition: bigint; readonly readThroughPosition: bigint }> = [];
	const principals = [{ id: "principal-2", subject: "subject-2" }, { id: "principal-1", subject: "subject-1" }];
	const transaction = {
		conversation: {
			findUnique: vi.fn(async function _Find() { return conversation; }),
			create: vi.fn(async function _Create({ data }: { readonly data: Record<string, unknown> }) { conversation = _Conversation(data); return conversation; }),
			update: vi.fn(async function _Update() { return { id: _COMMAND.conversationId }; }),
		},
		conversationPrivatePayload: {
			findUnique: vi.fn(async function _FindPayload() { return payload; }),
			create: vi.fn(async function _CreatePayload({ data }: { readonly data: ReturnType<typeof _PayloadRow> }) { payload = { ...data }; return payload; }),
		},
		principal: { findMany: vi.fn(async function _Principals() { return principals; }) },
		conversationParticipant: { createMany: vi.fn(async function _Participants({ data }: { readonly data: typeof participants }) { participants.push(...data); return { count: data.length }; }) },
	};
	const cipher = _Cipher();
	const eligible = vi.spyOn(PrismaManagedAgentConversationResolver.prototype, "eligible").mockResolvedValue(_CANDIDATE);
	const reconcileParticipants = vi.spyOn(PrismaConversationProductAuthorizationRepository.prototype, "reconcileParticipants").mockResolvedValue(undefined);
	const reconcileCreator = vi.spyOn(PrismaConversationProductAuthorizationRepository.prototype, "reconcileCreator").mockResolvedValue(undefined);
	const dependencies = { identityHistory: {} as never, membershipConfig: {} as never, profiles: [] };
	const repository = new PrismaRoutineOccurrenceProjectionRepository(transaction as never, cipher, dependencies);
	return { repository, transaction, cipher, eligible, reconcileParticipants, reconcileCreator, participants, principals, conversation: function _CurrentConversation() { return conversation; }, payload: function _CurrentPayload() { return payload; }, setPayload: function _SetPayload(value: ReturnType<typeof _PayloadRow> | null) { payload = value; } };
}

/** Maps an encrypted payload into the exact Prisma row returned to the payload owner. */
function _PayloadRow(overrides: Record<string, unknown> = {})
{
	const encrypted = _Cipher().encrypt(_COMMAND.instruction, _RoutineInstructionCoordinates(_COMMAND.siloId, _COMMAND.conversationId));
	return { id: _RoutineEventId("payload", _COMMAND.conversationId), siloId: _COMMAND.siloId, conversationId: _COMMAND.conversationId, authorSubject: "opencrane", idempotencyKey: _RoutineEventId("instruction", _COMMAND.conversationId), keyId: encrypted.keyId, nonce: Buffer.from(encrypted.nonce), authTag: Buffer.from(encrypted.authTag), ciphertext: Buffer.from(encrypted.ciphertext), ciphertextDigest: encrypted.ciphertextDigest, ...overrides };
}

describe("PrismaRoutineOccurrenceProjectionRepository", function _Suite()
{
	it("stores a hidden projection and real encrypted instruction without participants, grants, or plaintext", async function _StageHidden()
	{
		const fixture = _Fixture();
		const coordinates = _RoutineInstructionCoordinates(_COMMAND.siloId, _COMMAND.conversationId);
		const encrypted = fixture.cipher.encrypt(_COMMAND.instruction, coordinates);

		await expect(fixture.repository.stage({ command: _COMMAND, payload: encrypted, requireExisting: false, published: false })).resolves.toMatchObject({ siloId: _COMMAND.siloId, conversationId: _COMMAND.conversationId, payloadRef: coordinates.payloadRef, agentIdentityId: _CANDIDATE.agentIdentityId, profileRevisionId: _CANDIDATE.profileRevisionId });
		expect(fixture.transaction.conversation.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ id: _COMMAND.conversationId, siloId: _COMMAND.siloId, mode: ConversationMode.AgentSession }) }));
		expect(fixture.transaction.conversationPrivatePayload.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id: coordinates.payloadRef, siloId: _COMMAND.siloId, conversationId: _COMMAND.conversationId, authorSubject: "opencrane", ciphertextDigest: encrypted.ciphertextDigest }) });
		expect(fixture.transaction.conversation.update).toHaveBeenCalledOnce();
		expect(fixture.participants).toEqual([]);
		expect(fixture.reconcileParticipants).not.toHaveBeenCalled();
		expect(fixture.reconcileCreator).not.toHaveBeenCalled();
		expect(JSON.stringify(fixture.transaction.conversation.create.mock.calls)).not.toContain(_COMMAND.instruction);
		expect(JSON.stringify(fixture.transaction.conversationPrivatePayload.create.mock.calls)).not.toContain(_COMMAND.instruction);
		expect(fixture.cipher.decrypt(fixture.payload()!, coordinates)).toBe(_COMMAND.instruction);
	});

	it("reuses the first ciphertext and rejects a changed plaintext on retry", async function _RetryIntegrity()
	{
		const fixture = _Fixture(_Conversation());
		fixture.setPayload(_PayloadRow());
		const coordinates = _RoutineInstructionCoordinates(_COMMAND.siloId, _COMMAND.conversationId);
		const retryPayload = fixture.cipher.encrypt(_COMMAND.instruction, coordinates);

		await expect(fixture.repository.stage({ command: _COMMAND, payload: retryPayload, requireExisting: false, published: false })).resolves.toMatchObject({ ciphertextDigest: fixture.payload()!.ciphertextDigest });
		expect(fixture.transaction.conversationPrivatePayload.create).not.toHaveBeenCalled();
		expect(fixture.transaction.conversation.update).not.toHaveBeenCalled();
		const changed = { ..._COMMAND, instruction: "Substituted instruction" };
		await expect(fixture.repository.stage({ command: changed, payload: fixture.cipher.encrypt(changed.instruction, coordinates), requireExisting: true, published: false })).rejects.toThrow("differs from its saved ciphertext");
	});

	it("never recreates a missing payload in required-existing recovery mode", async function _RequireExisting()
	{
		const fixture = _Fixture(_Conversation());
		const coordinates = _RoutineInstructionCoordinates(_COMMAND.siloId, _COMMAND.conversationId);

		await expect(fixture.repository.stage({ command: _COMMAND, payload: fixture.cipher.encrypt(_COMMAND.instruction, coordinates), requireExisting: true, published: true })).rejects.toThrow("recovery requires its stored ciphertext");
		expect(fixture.transaction.conversationPrivatePayload.create).not.toHaveBeenCalled();
		expect(fixture.transaction.conversation.update).not.toHaveBeenCalled();
		expect(fixture.eligible).not.toHaveBeenCalled();
	});

	it("returns null when managed eligibility disappears or the saved profile no longer agrees", async function _EligibilityLoss()
	{
		const absent = _Fixture();
		absent.eligible.mockResolvedValueOnce(null);
		const encrypted = absent.cipher.encrypt(_COMMAND.instruction, _RoutineInstructionCoordinates(_COMMAND.siloId, _COMMAND.conversationId));
		await expect(absent.repository.stage({ command: _COMMAND, payload: encrypted, requireExisting: false, published: false })).resolves.toBeNull();
		expect(absent.transaction.conversation.create).not.toHaveBeenCalled();

		const changed = _Fixture(_Conversation({ computerProfileRevisionId: "profile-old" }));
		await expect(changed.repository.stage({ command: _COMMAND, payload: encrypted, requireExisting: false, published: false })).resolves.toBeNull();
		expect(changed.transaction.conversationPrivatePayload.create).not.toHaveBeenCalled();
	});

	it("publishes the frozen audience in principal order and projects only the exact subjects", async function _Publish()
	{
		const fixture = _Fixture(_Conversation());
		fixture.setPayload(_PayloadRow());
		const encrypted = fixture.cipher.encrypt(_COMMAND.instruction, _RoutineInstructionCoordinates(_COMMAND.siloId, _COMMAND.conversationId));
		const record = await fixture.repository.stage({ command: _COMMAND, payload: encrypted, requireExisting: true, published: true });

		await fixture.repository.publish(record!);

		expect(fixture.participants.map(value => value.userId)).toEqual(["subject-1", "subject-2"]);
		expect(fixture.participants.every(value => value.visibleFromPosition === 1n && value.readThroughPosition === 0n)).toBe(true);
		expect(fixture.reconcileParticipants).toHaveBeenCalledWith(_COMMAND.siloId, _COMMAND.conversationId, ["subject-1", "subject-2"], _COMMAND.requesterPrincipalId, expect.any(Date));
		expect(fixture.reconcileCreator).toHaveBeenCalledWith(_COMMAND.siloId, _COMMAND.conversationId, _COMMAND.requesterPrincipalId, expect.any(Date));
		expect(JSON.stringify(fixture.reconcileParticipants.mock.calls)).not.toContain(_COMMAND.instruction);
	});

	it.each([
		["missing principal", [{ id: "principal-1", subject: "subject-1" }]],
		["ambiguous subject", [{ id: "principal-1", subject: "same-subject" }, { id: "principal-2", subject: "same-subject" }]],
	])("rejects a %s before participant or grant mutation", async function _AudienceFailure(_name, principals)
	{
		const fixture = _Fixture(_Conversation());
		fixture.setPayload(_PayloadRow());
		fixture.principals.splice(0, fixture.principals.length, ...principals);
		const record = await fixture.repository.stage({ command: _COMMAND, payload: fixture.cipher.encrypt(_COMMAND.instruction, _RoutineInstructionCoordinates(_COMMAND.siloId, _COMMAND.conversationId)), requireExisting: true, published: true });

		await expect(fixture.repository.publish(record!)).rejects.toThrow("missing or ambiguous");
		expect(fixture.participants).toEqual([]);
		expect(fixture.reconcileParticipants).not.toHaveBeenCalled();
		expect(fixture.reconcileCreator).not.toHaveBeenCalled();
	});
});
