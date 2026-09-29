import { isDeepStrictEqual } from "node:util";

import { ConversationLifecycle, ConversationMode, type Prisma } from "@prisma/client";

import { PrismaManagedAgentConversationResolver } from "@opencrane/backend/server/agents/agent-services";
import type { PrepareRoutineOccurrenceCommand, RoutineOccurrenceCommand, RoutineOccurrencePreparationReceipt, RoutineOccurrencePreparationRepository } from "@opencrane/backend/server/agents/scheduling/contract";
import { AesGcmConversationPrivatePayloadCipher } from "@opencrane/backend/server/conversations/history";
import { RoutineFiringTrigger } from "@opencrane/models/agents";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PrismaConversationProductAuthorizationRepository } from "../../authorization/db/conversation-product-authorization";
import { PrismaRoutineOccurrencePreparationUnitOfWork } from "../prisma-routine-occurrence-preparation";
import { _RoutineEventId, _RoutinePreparationReceipt } from "../routine-occurrence-history.mapper";
import type { RoutineOccurrenceHistoryRecord } from "../routine-occurrence-history.types";
import { _RoutineComputerId, _RoutineInstructionCoordinates } from "../routine-occurrence-preparation.mapper";

/** Stable projection creation time used by every transaction attempt. */
const _CREATED = new Date("2026-09-25T10:00:01.000Z");
/** Complete preparation command with plaintext limited to the conversation owner. */
const _COMMAND: PrepareRoutineOccurrenceCommand = {
	siloId: "silo-1", routineId: "routine-1", routineRevision: 2, firingId: "firing-1",
	task: { taskId: "task-1", taskName: "agents.routines.occurrence/v1", idempotencyKey: "occurrence-1" },
	admittedRunId: null, trigger: RoutineFiringTrigger.Automatic, scheduledSlot: "2026-09-25T10:00:00.000Z",
	conversationId: "occurrence-1", destinationConversationId: "destination-1", selectedManagedServiceId: "service-1",
	requesterPrincipalId: "principal-1", requesterIssuer: "https://issuer.test", requesterSubjectId: "subject-1",
	requesterAuthenticatedAt: "2026-09-24T12:00:00.000Z", audiencePrincipalIds: ["principal-1", "principal-2"],
	instruction: "Prepare the weekly report",
};
/** Current managed service identity and deployment profile. */
const _CANDIDATE = { agentServiceId: "service-1", agentRevisionId: "revision-1", agentIdentityId: "identity-1", principalId: "service-principal", name: "Company", workloadProfile: "company", profileRevisionId: "profile-1" };

/** Creates transactional state committed by the in-memory Prisma root. */
function _InitialState(conversation: ReturnType<typeof _Conversation> | null)
{
	return { conversation, payload: null as ReturnType<typeof _PayloadRow> | null, participants: [] as string[], grants: [] as string[], preparation: null as RoutineOccurrencePreparationReceipt | null, refused: false };
}

/** Transactional state inferred from the one canonical fixture builder. */
type _State = ReturnType<typeof _InitialState>;

/** Creates failure switches used to prove each preparation recovery boundary. */
function _InitialControls()
{
	return { authorityLossAt: null as number | null, authorizeCalls: 0, casFailure: false, eligible: true, loseHistoryResponse: false, losePublishResponse: false, mutateProjectionAfterHistory: false, wrongHistoryReceipt: false, wrongRecordReceipt: false };
}

/** Failure switches inferred from the one canonical fixture builder. */
type _Controls = ReturnType<typeof _InitialControls>;

afterEach(function _Restore() { vi.restoreAllMocks(); });

/** Creates the real private-payload cipher used by production preparation. */
function _Cipher(): AesGcmConversationPrivatePayloadCipher
{
	return new AesGcmConversationPrivatePayloadCipher("key-1", { "key-1": Buffer.alloc(32, 9).toString("base64url") });
}

/** Builds the hidden occurrence projection. */
function _Conversation(overrides: Record<string, unknown> = {})
{
	return { id: _COMMAND.conversationId, siloId: _COMMAND.siloId, mode: ConversationMode.AgentSession, lifecycle: ConversationLifecycle.Open, agentServiceId: _COMMAND.selectedManagedServiceId, computerId: _RoutineComputerId(_COMMAND.conversationId), computerAgentIdentityId: _CANDIDATE.agentIdentityId, computerProfileRevisionId: _CANDIDATE.profileRevisionId, createdAt: _CREATED, participants: [], ...overrides };
}

/** Builds one stored OpenCrane-authored encrypted row. */
function _PayloadRow(overrides: Record<string, unknown> = {})
{
	const cipher = _Cipher();
	const encrypted = cipher.encrypt(_COMMAND.instruction, _RoutineInstructionCoordinates(_COMMAND.siloId, _COMMAND.conversationId));
	return { id: _RoutineEventId("payload", _COMMAND.conversationId), siloId: _COMMAND.siloId, conversationId: _COMMAND.conversationId, authorSubject: "opencrane", idempotencyKey: _RoutineEventId("instruction", _COMMAND.conversationId), keyId: encrypted.keyId, nonce: Buffer.from(encrypted.nonce), authTag: Buffer.from(encrypted.authTag), ciphertext: Buffer.from(encrypted.ciphertext), ciphertextDigest: encrypted.ciphertextDigest, ...overrides };
}

/** Copies transactional state so a callback failure can discard all final-publication writes. */
function _Clone(state: _State): _State
{
	return structuredClone(state);
}

/** Applies one successfully committed transaction draft to the shared state object. */
function _Commit(target: _State, draft: _State): void
{
	target.conversation = draft.conversation;
	target.payload = draft.payload;
	target.participants = draft.participants;
	target.grants = draft.grants;
	target.preparation = draft.preparation;
	target.refused = draft.refused;
}

/** Builds the scheduling bridge over the same transaction draft as conversation publication. */
function _Routines(state: _State, controls: _Controls, events: string[], authorizationCommands: RoutineOccurrenceCommand[]): RoutineOccurrencePreparationRepository
{
	return {
		authorize: vi.fn(async function _Authorize(command)
		{
			authorizationCommands.push(command);
			controls.authorizeCalls += 1;
			events.push(`authorize:${controls.authorizeCalls}`);
			if (state.preparation !== null)
				return { preparation: state.preparation };
			if (controls.authorityLossAt === controls.authorizeCalls)
			{
				state.refused = true;
				return null;
			}
			return { preparation: null };
		}),
		record: vi.fn(async function _Record(_command, receipt)
		{
			events.push("record");
			if (controls.casFailure)
				throw new Error("routine occurrence preparation receipt compare-and-set conflict");
			if (controls.wrongRecordReceipt)
				return { ...receipt, digest: `sha256:${"f".repeat(64)}` as `sha256:${string}` };
			state.preparation = receipt;
			return receipt;
		}),
		refuse: vi.fn(async function _Refuse()
		{
			events.push("refuse");
			state.refused = true;
		}),
	};
}

/** Creates Prisma delegates bound to one isolated transaction draft. */
function _Transaction(state: _State, controls: _Controls, events: string[], authorizationCommands: RoutineOccurrenceCommand[], metrics: { payloadCreates: number; participantCreates: number; orderingUpdates: number })
{
	const transaction = {
		__state: state,
		conversation: {
			findUnique: vi.fn(async function _Find() { return state.conversation === null ? null : { ...state.conversation, participants: state.participants.map(userId => ({ userId })) }; }),
			create: vi.fn(async function _Create({ data }: { readonly data: Record<string, unknown> }) { events.push("conversation:create"); state.conversation = _Conversation(data); return state.conversation; }),
			update: vi.fn(async function _Update() { events.push("conversation:order"); metrics.orderingUpdates += 1; return { id: _COMMAND.conversationId }; }),
		},
		conversationPrivatePayload: {
			findUnique: vi.fn(async function _FindPayload() { return state.payload; }),
			create: vi.fn(async function _CreatePayload({ data }: { readonly data: ReturnType<typeof _PayloadRow> }) { events.push("payload:create"); metrics.payloadCreates += 1; state.payload = { ...data }; return state.payload; }),
		},
		principal: { findMany: vi.fn(async function _Principals() { return [{ id: "principal-2", subject: "subject-2" }, { id: "principal-1", subject: "subject-1" }]; }) },
		conversationParticipant: { createMany: vi.fn(async function _Participants({ data }: { readonly data: readonly { readonly userId: string }[] }) { events.push("participants:create"); metrics.participantCreates += 1; state.participants.push(...data.map(value => value.userId)); return { count: data.length }; }) },
	};
	return { ...transaction, __routines: _Routines(state, controls, events, authorizationCommands) };
}

/** Builds the real UOW and projection repository over rollback-capable narrow transaction mocks. */
function _Fixture(initialConversation: ReturnType<typeof _Conversation> | null = null)
{
	const state = _InitialState(initialConversation);
	const controls = _InitialControls();
	const events: string[] = [];
	const authorizationCommands: RoutineOccurrenceCommand[] = [];
	const metrics = { payloadCreates: 0, participantCreates: 0, orderingUpdates: 0, historyEstablishes: 0, historyReads: 0 };
	let transactionNumber = 0;
	let historyRecord: RoutineOccurrenceHistoryRecord | null = null;
	const prisma = {
		$transaction: vi.fn(async function _TransactionRoot(work: (transaction: ReturnType<typeof _Transaction>) => Promise<unknown>)
		{
			transactionNumber += 1;
			const number = transactionNumber;
			const draft = _Clone(state);
			const preparationBefore = state.preparation;
			events.push(`tx${number}:begin`);
			try
			{
				const result = await work(_Transaction(draft, controls, events, authorizationCommands, metrics));
				_Commit(state, draft);
				events.push(`tx${number}:commit`);
				if (controls.losePublishResponse && preparationBefore === null && state.preparation !== null)
				{
					controls.losePublishResponse = false;
					throw new Error("publication response lost");
				}
				return result;
			}
			catch (error)
			{
				if (!events.includes(`tx${number}:commit`))
					events.push(`tx${number}:rollback`);
				throw error;
			}
		}),
	};
	const cipher = _Cipher();
	const eligible = vi.spyOn(PrismaManagedAgentConversationResolver.prototype, "eligible").mockImplementation(async function _Eligible() { return controls.eligible ? _CANDIDATE : null; });
	const reconcileParticipants = vi.spyOn(PrismaConversationProductAuthorizationRepository.prototype, "reconcileParticipants").mockImplementation(async function _Participants(this: PrismaConversationProductAuthorizationRepository)
	{
		const owner = this as unknown as { readonly transaction: { readonly __state: _State } };
		events.push("grants:participants");
		owner.transaction.__state.grants.push("participants");
	});
	const reconcileCreator = vi.spyOn(PrismaConversationProductAuthorizationRepository.prototype, "reconcileCreator").mockImplementation(async function _Creator(this: PrismaConversationProductAuthorizationRepository)
	{
		const owner = this as unknown as { readonly transaction: { readonly __state: _State } };
		events.push("grants:creator");
		owner.transaction.__state.grants.push("creator");
	});
	const history = {
		establish: vi.fn(async function _Establish(record: RoutineOccurrenceHistoryRecord)
		{
			events.push("history:establish");
			metrics.historyEstablishes += 1;
			expect(state.participants).toEqual([]);
			expect(state.grants).toEqual([]);
			expect(state.preparation).toBeNull();
			if (historyRecord !== null && !isDeepStrictEqual(historyRecord, record))
				throw new Error("history changed");
			historyRecord = structuredClone(record);
			if (controls.mutateProjectionAfterHistory && state.conversation !== null)
				state.conversation.createdAt = new Date("2026-09-25T10:00:02.000Z");
			const receipt = _RoutinePreparationReceipt(record);
			if (controls.loseHistoryResponse)
			{
				controls.loseHistoryResponse = false;
				throw new Error("history response lost");
			}
			if (controls.wrongHistoryReceipt)
				return { ...receipt, digest: `sha256:${"e".repeat(64)}` as `sha256:${string}` };
			return receipt;
		}),
		readRecord: vi.fn(async function _ReadRecord()
		{
			events.push("history:read");
			metrics.historyReads += 1;
			return historyRecord;
		}),
	};
	const dependencies = { cipher, history, agents: { identityHistory: {} as never, membershipConfig: {} as never, profiles: [] }, routines: function _Factory(transaction: Prisma.TransactionClient) { return (transaction as unknown as ReturnType<typeof _Transaction>).__routines; } };
	const unit = new PrismaRoutineOccurrencePreparationUnitOfWork(prisma as never, dependencies);
	return { unit, state, controls, events, metrics, eligible, reconcileParticipants, reconcileCreator, history, authorizationCommands, historyRecord: function _HistoryRecord() { return historyRecord; }, setHistoryRecord: function _SetHistoryRecord(value: RoutineOccurrenceHistoryRecord) { historyRecord = value; } };
}

describe("PrismaRoutineOccurrencePreparationUnitOfWork", function _Suite()
{
	it("orders hidden encrypted staging, external history, and atomic audience publication", async function _Prepare()
	{
		const fixture = _Fixture();
		await expect(fixture.unit.prepare(_COMMAND)).resolves.toEqual(expect.objectContaining({ historyReference: `routine-occurrence-instruction-${_COMMAND.conversationId}` }));

		expect(fixture.events.indexOf("tx1:commit")).toBeLessThan(fixture.events.indexOf("history:establish"));
		expect(fixture.events.indexOf("history:establish")).toBeLessThan(fixture.events.indexOf("tx2:begin"));
		expect(fixture.events.indexOf("participants:create")).toBeLessThan(fixture.events.indexOf("record"));
		expect(fixture.events.indexOf("grants:creator")).toBeLessThan(fixture.events.indexOf("record"));
		expect(fixture.state.participants).toEqual(["subject-1", "subject-2"]);
		expect(fixture.state.grants).toEqual(["participants", "creator"]);
		expect(fixture.state.preparation).not.toBeNull();
		expect(fixture.authorizationCommands).toHaveLength(2);
		expect(JSON.stringify(fixture.authorizationCommands)).not.toContain(_COMMAND.instruction);
	});

	it.each([1, 2])("commits current-authority refusal at authorization check %s without publishing access", async function _AuthorityLoss(check)
	{
		const fixture = _Fixture();
		fixture.controls.authorityLossAt = check;

		await expect(fixture.unit.prepare(_COMMAND)).resolves.toBeNull();
		expect(fixture.state.refused).toBe(true);
		expect(fixture.state.participants).toEqual([]);
		expect(fixture.state.grants).toEqual([]);
		expect(fixture.state.preparation).toBeNull();
		expect(fixture.metrics.historyEstablishes).toBe(check === 1 ? 0 : 1);
	});

	it.each([
		["managed eligibility", null],
		["saved profile", _Conversation({ computerProfileRevisionId: "profile-old" })],
	])("records refusal when %s no longer agrees", async function _EligibilityLoss(_name, conversation)
	{
		const fixture = _Fixture(conversation);
		if (conversation === null)
			fixture.controls.eligible = false;

		await expect(fixture.unit.prepare(_COMMAND)).resolves.toBeNull();
		expect(fixture.state.refused).toBe(true);
		expect(fixture.state.participants).toEqual([]);
		expect(fixture.state.preparation).toBeNull();
	});

	it("recovers a lost history response with the first ciphertext and exact coordinates", async function _LostHistoryResponse()
	{
		const fixture = _Fixture();
		fixture.controls.loseHistoryResponse = true;
		await expect(fixture.unit.prepare(_COMMAND)).rejects.toThrow("history response lost");
		const firstPayload = structuredClone(fixture.state.payload!);

		await expect(fixture.unit.prepare(_COMMAND)).resolves.toEqual(_RoutinePreparationReceipt(fixture.historyRecord()!));
		expect(fixture.metrics.payloadCreates).toBe(1);
		expect(fixture.state.payload).toEqual(firstPayload);
		expect(fixture.state.payload).toMatchObject({ id: _RoutineEventId("payload", _COMMAND.conversationId), siloId: _COMMAND.siloId, conversationId: _COMMAND.conversationId, authorSubject: "opencrane" });
	});

	it("recovers a lost publication response from verified history without restoring revoked access", async function _LostPublicationResponse()
	{
		const fixture = _Fixture();
		fixture.controls.losePublishResponse = true;
		await expect(fixture.unit.prepare(_COMMAND)).rejects.toThrow("publication response lost");
		const receipt = fixture.state.preparation!;
		const participantWrites = fixture.metrics.participantCreates;
		const grantWrites = fixture.reconcileParticipants.mock.calls.length + fixture.reconcileCreator.mock.calls.length;
		fixture.state.participants = [];
		fixture.state.grants = [];
		fixture.controls.authorityLossAt = fixture.controls.authorizeCalls + 1;
		fixture.eligible.mockClear();
		fixture.eligible.mockRejectedValue(new Error("eligibility must not be re-evaluated"));

		await expect(fixture.unit.prepare(_COMMAND)).resolves.toEqual(receipt);
		expect(fixture.metrics.participantCreates).toBe(participantWrites);
		expect(fixture.reconcileParticipants.mock.calls.length + fixture.reconcileCreator.mock.calls.length).toBe(grantWrites);
		expect(fixture.state.participants).toEqual([]);
		expect(fixture.state.grants).toEqual([]);
		expect(fixture.eligible).not.toHaveBeenCalled();
		expect(fixture.metrics.historyEstablishes).toBe(1);
		expect(fixture.metrics.historyReads).toBe(1);
	});

	it("rolls back participants and grants when receipt compare-and-set fails", async function _CasRollback()
	{
		const fixture = _Fixture();
		fixture.controls.casFailure = true;

		await expect(fixture.unit.prepare(_COMMAND)).rejects.toThrow("compare-and-set conflict");
		expect(fixture.state.conversation).not.toBeNull();
		expect(fixture.state.payload).not.toBeNull();
		expect(fixture.state.participants).toEqual([]);
		expect(fixture.state.grants).toEqual([]);
		expect(fixture.state.preparation).toBeNull();
		expect(fixture.events).toContain("tx2:rollback");
	});

	it.each(["projection", "history receipt", "saved receipt"])("rejects a different %s without publication", async function _ChangedEvidence(kind)
	{
		const fixture = _Fixture();
		fixture.controls.mutateProjectionAfterHistory = kind === "projection";
		fixture.controls.wrongHistoryReceipt = kind === "history receipt";
		fixture.controls.wrongRecordReceipt = kind === "saved receipt";

		await expect(fixture.unit.prepare(_COMMAND)).rejects.toThrow();
		expect(fixture.state.participants).toEqual([]);
		expect(fixture.state.grants).toEqual([]);
		expect(fixture.state.preparation).toBeNull();
	});

	it("rejects published recovery when durable history differs from its saved receipt", async function _PublishedHistoryMismatch()
	{
		const fixture = _Fixture();
		await fixture.unit.prepare(_COMMAND);
		const changed = { ...fixture.historyRecord()!, origin: { ...fixture.historyRecord()!.origin, firingId: "other-firing" } };
		fixture.setHistoryRecord(changed);

		await expect(fixture.unit.prepare(_COMMAND)).rejects.toThrow("inconsistent preparation history");
		expect(fixture.metrics.participantCreates).toBe(1);
	});
});
