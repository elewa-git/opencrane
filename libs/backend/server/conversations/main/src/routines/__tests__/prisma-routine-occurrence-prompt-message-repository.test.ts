import { describe, expect, it, vi } from "vitest";

import type { RoutineOccurrencePromptAdmissionQuery } from "@opencrane/backend/agents/execution/inputs";
import { RoutineFiringTrigger } from "@opencrane/models/agents";
import { ConversationGenesisOriginKinds } from "@opencrane/models/conversations";

import { PrismaRoutineOccurrencePromptMessageRepository } from "../prisma-routine-occurrence-prompt-message-repository";
import { _RoutineEventId } from "../routine-occurrence-history.mapper";
import type { RoutineOccurrenceHistoryRecord } from "../routine-occurrence-history.types";

/** Exact admission query bound into the source constructor. */
const _QUERY: RoutineOccurrencePromptAdmissionQuery = {
	siloId: "silo-1", conversationId: "occurrence-1", agentServiceId: "assistant-1", trigger: "scheduled",
	routine: { routineId: "routine-1", routineRevision: 2, firingId: "firing-1", scheduledSlot: "2026-09-25T08:00:00.000Z", requesterPrincipalId: "principal-1", requesterIssuer: "https://issuer.test", requesterSubjectId: "subject-1", requesterAuthenticatedAt: "2026-09-20T07:00:00.000Z", workflowTaskId: "task-1", workflowTaskName: "routine.prepare", workflowTaskKey: "firing-task-1" },
};

/** Checked durable history record returned for the exact admission query. */
const _RECORD: RoutineOccurrenceHistoryRecord = {
	siloId: _QUERY.siloId, conversationId: _QUERY.conversationId, agentServiceId: _QUERY.agentServiceId,
	origin: { kind: ConversationGenesisOriginKinds.RoutineOccurrence, routineId: _QUERY.routine.routineId, routineRevision: _QUERY.routine.routineRevision, firingId: _QUERY.routine.firingId, destinationConversationId: "destination-1", trigger: RoutineFiringTrigger.Automatic, scheduledSlot: _QUERY.routine.scheduledSlot },
	requesterPrincipalId: _QUERY.routine.requesterPrincipalId, requesterIssuer: _QUERY.routine.requesterIssuer, requesterSubjectId: _QUERY.routine.requesterSubjectId, requesterAuthenticatedAt: _QUERY.routine.requesterAuthenticatedAt,
	task: { taskId: _QUERY.routine.workflowTaskId, taskName: _QUERY.routine.workflowTaskName, idempotencyKey: _QUERY.routine.workflowTaskKey }, audiencePrincipalIds: ["principal-1"],
	computerId: "computer-1", agentIdentityId: "identity-1", profileRevisionId: `sha256:${"a".repeat(64)}`, createdAt: "2026-09-25T08:00:01.000Z", payloadRef: "payload-1", ciphertextDigest: `sha256:${"b".repeat(64)}`,
};

/** Encrypted private-payload row whose complete binding agrees with checked history. */
const _PAYLOAD = {
	id: _RECORD.payloadRef, siloId: _RECORD.siloId, conversationId: _RECORD.conversationId, authorSubject: "opencrane", idempotencyKey: "instruction-1", keyId: "key-1",
	nonce: Buffer.from("nonce"), authTag: Buffer.from("tag"), ciphertext: Buffer.from("ciphertext"), ciphertextDigest: _RECORD.ciphertextDigest, createdAt: new Date("2026-09-25T08:00:01.000Z"),
};

/** Builds an isolated routine prompt source and exposes every delegated boundary. */
function _Fixture(historyRevision = "1", query: RoutineOccurrencePromptAdmissionQuery = _QUERY)
{
	const history = { readRecord: vi.fn().mockResolvedValue(_RECORD) };
	const transaction = { conversationPrivatePayload: { findUnique: vi.fn().mockResolvedValue(_PAYLOAD) } };
	const cipher = { decrypt: vi.fn().mockReturnValue("Carry out the saved instruction"), encrypt: vi.fn() };
	const source = new PrismaRoutineOccurrencePromptMessageRepository(transaction as never, history, cipher, query, historyRevision);
	return { source, history, transaction, cipher };
}

/** Returns the deterministic and only allowed message identifier. */
function _InstructionId(): string { return _RoutineEventId("instruction", _QUERY.conversationId); }

describe("routine occurrence prompt message source", function _Suite()
{
	it("returns only the exact service-attested instruction as a user prompt", async function _ExactInstruction()
	{
		const fixture = _Fixture();

		await expect(fixture.source.load([_InstructionId()])).resolves.toEqual([{ messageId: _InstructionId(), message: { role: "user", content: "Carry out the saved instruction" } }]);
		expect(fixture.history.readRecord).toHaveBeenCalledWith(_QUERY);
		expect(fixture.transaction.conversationPrivatePayload.findUnique).toHaveBeenCalledWith({ where: { id: _RECORD.payloadRef } });
		expect(fixture.cipher.decrypt).toHaveBeenCalledWith({ keyId: _PAYLOAD.keyId, nonce: _PAYLOAD.nonce, authTag: _PAYLOAD.authTag, ciphertext: _PAYLOAD.ciphertext, ciphertextDigest: _PAYLOAD.ciphertextDigest }, { siloId: _QUERY.siloId, conversationId: _QUERY.conversationId, payloadRef: _RECORD.payloadRef, authorSubject: "opencrane" });
	});

	it.each([
		["missing", []],
		["repeated", [_InstructionId(), _InstructionId()]],
		["foreign", ["foreign-message"]],
		["mixed", [_InstructionId(), "foreign-message"]],
	])("rejects a %s instruction selection before reading history", async function _InvalidSelection(_name, messageIds)
	{
		const fixture = _Fixture();

		await expect(fixture.source.load(messageIds)).rejects.toThrow("selection does not match admitted history");
		expect(fixture.history.readRecord).not.toHaveBeenCalled();
		expect(fixture.transaction.conversationPrivatePayload.findUnique).not.toHaveBeenCalled();
		expect(fixture.cipher.decrypt).not.toHaveBeenCalled();
	});

	it.each(["0", "2", "01", "later"])("rejects admitted history revision %s before reading durable state", async function _InvalidRevision(historyRevision)
	{
		const fixture = _Fixture(historyRevision);

		await expect(fixture.source.load([_InstructionId()])).rejects.toThrow("selection does not match admitted history");
		expect(fixture.history.readRecord).not.toHaveBeenCalled();
		expect(fixture.transaction.conversationPrivatePayload.findUnique).not.toHaveBeenCalled();
	});

	it("fails closed when the exact query has no checked history", async function _AbsentHistory()
	{
		const fixture = _Fixture();
		fixture.history.readRecord.mockResolvedValueOnce(null);

		await expect(fixture.source.load([_InstructionId()])).rejects.toThrow("history is unavailable");
		expect(fixture.history.readRecord).toHaveBeenCalledWith(_QUERY);
		expect(fixture.transaction.conversationPrivatePayload.findUnique).not.toHaveBeenCalled();
		expect(fixture.cipher.decrypt).not.toHaveBeenCalled();
	});

	it("fails closed when the checked history reader rejects a query coordinate", async function _QueryMismatch()
	{
		const query = { ..._QUERY, routine: { ..._QUERY.routine, firingId: "foreign-firing" } };
		const fixture = _Fixture("1", query);
		fixture.history.readRecord.mockResolvedValueOnce(null);

		await expect(fixture.source.load([_RoutineEventId("instruction", query.conversationId)])).rejects.toThrow("history is unavailable");
		expect(fixture.history.readRecord).toHaveBeenCalledWith(query);
		expect(fixture.transaction.conversationPrivatePayload.findUnique).not.toHaveBeenCalled();
		expect(fixture.cipher.decrypt).not.toHaveBeenCalled();
	});

	it("propagates checked-history rejection for altered durable evidence", async function _AlteredHistory()
	{
		const fixture = _Fixture();
		const error = new Error("Saved routine occurrence history is malformed");
		fixture.history.readRecord.mockRejectedValueOnce(error);

		await expect(fixture.source.load([_InstructionId()])).rejects.toBe(error);
		expect(fixture.transaction.conversationPrivatePayload.findUnique).not.toHaveBeenCalled();
		expect(fixture.cipher.decrypt).not.toHaveBeenCalled();
	});

	it.each([
		["identifier", { id: "foreign-payload" }],
		["silo", { siloId: "other-silo" }],
		["conversation", { conversationId: "destination-1" }],
		["author", { authorSubject: "subject-1" }],
		["digest", { ciphertextDigest: `sha256:${"c".repeat(64)}` }],
	])("rejects a payload with a changed %s coordinate", async function _ChangedPayload(_name, patch)
	{
		const fixture = _Fixture();
		fixture.transaction.conversationPrivatePayload.findUnique.mockResolvedValueOnce({ ..._PAYLOAD, ...patch });

		await expect(fixture.source.load([_InstructionId()])).rejects.toThrow("payload does not match checked history");
		expect(fixture.cipher.decrypt).not.toHaveBeenCalled();
	});

	it("rejects a missing encrypted payload row", async function _MissingPayload()
	{
		const fixture = _Fixture();
		fixture.transaction.conversationPrivatePayload.findUnique.mockResolvedValueOnce(null);

		await expect(fixture.source.load([_InstructionId()])).rejects.toThrow("payload does not match checked history");
		expect(fixture.cipher.decrypt).not.toHaveBeenCalled();
	});

	it("propagates authenticated decryption failure without returning prompt content", async function _DecryptFailure()
	{
		const fixture = _Fixture();
		const error = new Error("Ciphertext authentication failed");
		fixture.cipher.decrypt.mockImplementationOnce(function _Reject(): never { throw error; });

		await expect(fixture.source.load([_InstructionId()])).rejects.toBe(error);
		expect(fixture.cipher.decrypt).toHaveBeenCalledOnce();
	});
});
