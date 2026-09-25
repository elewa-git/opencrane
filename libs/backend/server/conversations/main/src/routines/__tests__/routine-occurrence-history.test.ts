import { WrongExpectedVersionError } from "@kurrent/kurrentdb-client";
import { ConversationAuthorKinds, ConversationComputerStates, ConversationEntryProvenance, ConversationMessageActivations, type MessageEntry } from "@opencrane/contracts";
import type { RoutineOccurrencePromptAdmissionQuery } from "@opencrane/backend/agents/execution/inputs";
import { AesGcmConversationPrivatePayloadCipher, ConversationHistoryAuthority } from "@opencrane/backend/server/conversations/history";
import { HistoryExpectedRevisions, type HistoryAtomicAppend, type HistoryRecordedEvent } from "@opencrane/backend/server/infra/history-store";
import { ConversationComputerHistory } from "@opencrane/backend/server/conversations/computers";
import { RoutineFiringTrigger } from "@opencrane/models/agents";
import { ConversationGenesisOriginKinds } from "@opencrane/models/conversations";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RoutineOccurrenceHistory } from "../routine-occurrence-history";
import { _RoutineEventId } from "../routine-occurrence-history.mapper";
import type { RoutineOccurrenceHistoryRecord } from "../routine-occurrence-history.types";
import { PrismaRoutineOccurrencePromptMessageRepository } from "../prisma-routine-occurrence-prompt-message-repository";
import { RoutineOccurrencePromptHistoryReader } from "../routine-occurrence-prompt-history-reader";

/** Complete occurrence record used by the production validators and mappers. */
const _RECORD: RoutineOccurrenceHistoryRecord = {
	siloId: "silo-1",
	conversationId: "occurrence-conversation-1",
	origin: { kind: ConversationGenesisOriginKinds.RoutineOccurrence, routineId: "routine-1", routineRevision: 2, firingId: "firing-1", destinationConversationId: "destination-1", trigger: RoutineFiringTrigger.Automatic, scheduledSlot: "2026-09-25T10:00:00.000Z" },
	agentServiceId: "service-1",
	requesterPrincipalId: "principal-1",
	requesterIssuer: "https://issuer.example",
	requesterSubjectId: "subject-1",
	requesterAuthenticatedAt: "2026-09-24T12:00:00.000Z",
	task: { taskId: "task-1", taskName: "agents.routines.occurrence/v1", idempotencyKey: "occurrence-1" },
	audiencePrincipalIds: ["principal-1", "principal-2"],
	computerId: "computer-1",
	agentIdentityId: "agent-identity-1",
	profileRevisionId: "profile-revision-1",
	createdAt: "2026-09-25T10:00:01.000Z",
	payloadRef: "conversation-private://routine-instruction-1",
	ciphertextDigest: `sha256:${"a".repeat(64)}`,
};

/** Applies checked atomic appends to memory so the real history readers verify saved evidence. */
function _Fixture()
{
	const streams = new Map<string, HistoryRecordedEvent[]>();
	const control: { loseResponse: boolean; raceExact: boolean; conflictStream: string | null } = { loseResponse: false, raceExact: false, conflictStream: null };
	function _Conflict(streamName: string, current: bigint | HistoryExpectedRevisions.NoStream): WrongExpectedVersionError
	{
		return new WrongExpectedVersionError(undefined, { streamName, expected: HistoryExpectedRevisions.NoStream, current: current as never });
	}
	function _Commit(command: HistoryAtomicAppend)
	{
		for (const expected of command.expectedHeads)
		{
			const events = streams.get(expected.streamName);
			const current = events === undefined ? HistoryExpectedRevisions.NoStream : BigInt(events.length - 1);
			if (expected.revision !== current)
			{
				throw _Conflict(expected.streamName, current);
			}
		}
		return command.appends.map(function _Append(append)
		{
			const events = streams.get(append.streamName) ?? [];
			for (const event of append.events)
			{
				events.push({ ...event, streamName: append.streamName, revision: BigInt(events.length), recordedAt: new Date("2026-09-25T10:00:02.000Z") });
			}
			streams.set(append.streamName, events);
			return { streamName: append.streamName, revision: BigInt(events.length - 1) };
		});
	}
	const appendAtomic = vi.fn(async function _AppendAtomic(command: HistoryAtomicAppend)
	{
		if (control.conflictStream !== null)
		{
			throw _Conflict(control.conflictStream, 0n);
		}
		const receipts = _Commit(command);
		if (control.raceExact)
		{
			control.raceExact = false;
			throw _Conflict(command.appends[0]!.streamName, 0n);
		}
		if (control.loseResponse)
		{
			control.loseResponse = false;
			throw new Error("committed response lost");
		}
		return receipts;
	});
	const store = {
		append: vi.fn(),
		appendAtomic,
		readHead: vi.fn(async function _ReadHead(streamName: string)
		{
			const events = streams.get(streamName);
			return { streamName, revision: events === undefined ? null : BigInt(events.length - 1) };
		}),
		readStream: vi.fn(async function* _ReadStream(command: { readonly streamName: string; readonly fromRevision?: bigint; readonly maxCount?: number })
		{
			const from = Number(command.fromRevision ?? 0n);
			const until = command.maxCount === undefined ? undefined : from + command.maxCount;
			for (const event of (streams.get(command.streamName) ?? []).slice(from, until))
			{
				yield event;
			}
		}),
	};
	return { history: new RoutineOccurrenceHistory(store as never, new ConversationHistoryAuthority(store as never)), streams, store, appendAtomic, control };
}

/** Returns the saved participant-visible instruction after one successful establishment. */
function _Instruction(fixture: ReturnType<typeof _Fixture>): MessageEntry
{
	return fixture.streams.get(`conversation-${_RECORD.conversationId}`)?.[1]?.data.entry as MessageEntry;
}

describe("routine occurrence immutable history", function _Suite()
{
	afterEach(function _RestoreBuilders() { vi.restoreAllMocks(); });

	it("atomically establishes all three streams with a service-attested nonactivating instruction", async function _Establishes()
	{
		const f = _Fixture();
		const initialAppend = vi.spyOn(ConversationComputerHistory.prototype, "initialAppend");

		const receipt = await f.history.establish(_RECORD);

		expect(receipt).toMatchObject({ historyReference: `routine-occurrence-instruction-${_RECORD.conversationId}`, digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u) });
		expect(f.appendAtomic).toHaveBeenCalledOnce();
		const command = f.appendAtomic.mock.calls[0]![0];
		expect(initialAppend).toHaveBeenCalledExactlyOnceWith({ computer: expect.objectContaining({ id: _RECORD.computerId, state: ConversationComputerStates.Cold, createdAt: _RECORD.createdAt }), eventId: expect.any(String) });
		expect(command.appends[1]).toEqual(initialAppend.mock.results[0]!.value);
		expect(command.expectedHeads).toEqual([
			{ streamName: `conversation-${_RECORD.conversationId}`, revision: HistoryExpectedRevisions.NoStream },
			{ streamName: `conversation-computer-${_RECORD.computerId}`, revision: HistoryExpectedRevisions.NoStream },
			{ streamName: `routine-occurrence-instruction-${_RECORD.conversationId}`, revision: HistoryExpectedRevisions.NoStream },
		]);
		expect(command.appends.map(append => [append.streamName, append.events.length])).toEqual([
			[`conversation-${_RECORD.conversationId}`, 2],
			[`conversation-computer-${_RECORD.computerId}`, 1],
			[`routine-occurrence-instruction-${_RECORD.conversationId}`, 1],
		]);
		const instruction = _Instruction(f);
		expect(instruction).toMatchObject({ provenance: ConversationEntryProvenance.ServiceAttested, author: { kind: ConversationAuthorKinds.Service, serviceId: "opencrane" }, activation: ConversationMessageActivations.None, runId: null, addressedAgentIdentityId: _RECORD.agentIdentityId, blocks: [{ payloadRef: _RECORD.payloadRef, ciphertextDigest: _RECORD.ciphertextDigest }] });
		expect(instruction.author).not.toHaveProperty("principalId");
		expect(instruction.author).not.toHaveProperty("participantId");
		expect(Object.keys(instruction.blocks[0]!)).toEqual(["id", "kind", "payloadRef", "ciphertextDigest"]);
		expect(instruction.blocks[0]).not.toHaveProperty("text");
		expect(f.streams.get(`routine-occurrence-instruction-${_RECORD.conversationId}`)![0]!.data.record).not.toHaveProperty("instruction");
		expect(JSON.stringify([...f.streams.values()].flatMap(events => events.map(event => event.data)))).not.toContain("Do the secret work");
	});

	it("returns the stable first receipt on an exact retry without another append", async function _ExactRetry()
	{
		const f = _Fixture();
		const first = await f.history.establish(_RECORD);

		await expect(f.history.establish({ ..._RECORD, origin: { ..._RECORD.origin }, task: { ..._RECORD.task }, audiencePrincipalIds: [..._RECORD.audiencePrincipalIds] })).resolves.toEqual(first);
		expect(f.appendAtomic).toHaveBeenCalledOnce();
	});

	it("composes checked occurrence history, encrypted payload custody and exact prompt loading", async function _PromptComposition()
	{
		const instruction = "Prepare the original scheduled account summary";
		const f = _Fixture();
		const cipher = new AesGcmConversationPrivatePayloadCipher("routine-history-test-key", { "routine-history-test-key": Buffer.alloc(32, 17).toString("base64url") });
		const coordinates = { siloId: _RECORD.siloId, conversationId: _RECORD.conversationId, payloadRef: _RECORD.payloadRef, authorSubject: "opencrane" };
		const encrypted = cipher.encrypt(instruction, coordinates);
		const record: RoutineOccurrenceHistoryRecord = { ..._RECORD, ciphertextDigest: encrypted.ciphertextDigest as `sha256:${string}` };
		await f.history.establish(record);
		const query: RoutineOccurrencePromptAdmissionQuery = {
			siloId: record.siloId,
			conversationId: record.conversationId,
			agentServiceId: record.agentServiceId,
			trigger: "scheduled",
			routine: {
				routineId: record.origin.routineId,
				routineRevision: record.origin.routineRevision,
				firingId: record.origin.firingId,
				scheduledSlot: record.origin.scheduledSlot,
				requesterPrincipalId: record.requesterPrincipalId,
				requesterIssuer: record.requesterIssuer,
				requesterSubjectId: record.requesterSubjectId,
				requesterAuthenticatedAt: record.requesterAuthenticatedAt,
				workflowTaskId: record.task.taskId,
				workflowTaskName: record.task.taskName,
				workflowTaskKey: record.task.idempotencyKey,
			},
		};
		const promptHistory = new RoutineOccurrencePromptHistoryReader(f.history);
		const admission = await promptHistory.read(query);
		expect(admission).toEqual({ historyRevision: "1", orderedMessageIds: [_RoutineEventId("instruction", record.conversationId)] });
		const payload = { id: record.payloadRef, siloId: record.siloId, conversationId: record.conversationId, authorSubject: "opencrane", idempotencyKey: "routine-instruction", ...encrypted, createdAt: new Date(record.createdAt) };
		const findUnique = vi.fn().mockResolvedValue(payload);
		const source = new PrismaRoutineOccurrencePromptMessageRepository({ conversationPrivatePayload: { findUnique } } as never, promptHistory, cipher, query, admission!.historyRevision);

		await expect(source.load(admission!.orderedMessageIds)).resolves.toEqual([{ messageId: admission!.orderedMessageIds[0], message: { role: "user", content: instruction } }]);
		expect(findUnique).toHaveBeenCalledWith({ where: { id: record.payloadRef } });
		findUnique.mockResolvedValueOnce({ ...payload, authorSubject: "principal-1" });
		await expect(source.load(admission!.orderedMessageIds)).rejects.toThrow("payload does not match checked history");
		findUnique.mockResolvedValueOnce({ ...payload, ciphertextDigest: `sha256:${"f".repeat(64)}` });
		await expect(source.load(admission!.orderedMessageIds)).rejects.toThrow("payload does not match checked history");
	});

	it("recovers on retry after the atomic commit loses its transport response", async function _LostResponse()
	{
		const f = _Fixture();
		f.control.loseResponse = true;

		await expect(f.history.establish(_RECORD)).rejects.toThrow("committed response lost");
		const recovered = await f.history.establish(_RECORD);

		expect(recovered).toMatchObject({ historyReference: `routine-occurrence-instruction-${_RECORD.conversationId}` });
		expect(f.appendAtomic).toHaveBeenCalledOnce();
		expect(f.streams).toHaveProperty("size", 3);
	});

	it("recovers its own expected-head race after verifying the complete committed evidence", async function _OwnConflict()
	{
		const f = _Fixture();
		f.control.raceExact = true;

		await expect(f.history.establish(_RECORD)).resolves.toMatchObject({ historyReference: `routine-occurrence-instruction-${_RECORD.conversationId}` });
		expect(f.appendAtomic).toHaveBeenCalledOnce();
		expect(f.streams).toHaveProperty("size", 3);
	});

	it("propagates an expected-head conflict from an unrelated stream", async function _ForeignConflict()
	{
		const f = _Fixture();
		f.control.conflictStream = "unrelated-stream";

		await expect(f.history.establish(_RECORD)).rejects.toMatchObject({ streamName: "unrelated-stream" });
		expect(f.streams).toHaveProperty("size", 0);
	});

	it.each([
		["firing coordinate", { origin: { ..._RECORD.origin, firingId: "firing-changed" } }],
		["workflow task", { task: { ..._RECORD.task, taskId: "task-changed" } }],
		["audience", { audiencePrincipalIds: ["principal-1", "principal-3"] }],
		["payload reference", { payloadRef: "conversation-private://changed" }],
		["ciphertext digest", { ciphertextDigest: `sha256:${"b".repeat(64)}` }],
	])("rejects a retry with a changed %s", async function _Changed(_name, patch)
	{
		const f = _Fixture();
		await f.history.establish(_RECORD);

		await expect(f.history.establish({ ..._RECORD, ...patch } as RoutineOccurrenceHistoryRecord)).rejects.toThrow("differs from its saved instruction");
		expect(f.appendAtomic).toHaveBeenCalledOnce();
	});

	it.each([
		["malformed receipt", function _Mutate(f: ReturnType<typeof _Fixture>) { (f.streams.get(`routine-occurrence-instruction-${_RECORD.conversationId}`)![0]!.data.record as { ciphertextDigest: string }).ciphertextDigest = "invalid"; }],
		["partial streams", function _Mutate(f: ReturnType<typeof _Fixture>) { f.streams.delete(`conversation-computer-${_RECORD.computerId}`); }],
		["foreign receipt envelope", function _Mutate(f: ReturnType<typeof _Fixture>) { (f.streams.get(`routine-occurrence-instruction-${_RECORD.conversationId}`)![0]! as { streamName: string }).streamName = "foreign-stream"; }],
		["foreign conversation evidence", function _Mutate(f: ReturnType<typeof _Fixture>) { (_Instruction(f).author as { serviceId: string }).serviceId = "foreign-service"; }],
		["foreign computer evidence", function _Mutate(f: ReturnType<typeof _Fixture>) { (f.streams.get(`conversation-computer-${_RECORD.computerId}`)![0]!.data.computer as { agentIdentityId: string }).agentIdentityId = "foreign-agent"; }],
		["changed computer creation time", function _Mutate(f: ReturnType<typeof _Fixture>)
		{
			const computer = f.streams.get(`conversation-computer-${_RECORD.computerId}`)![0]!.data.computer as { createdAt: string; updatedAt: string };
			computer.createdAt = "2026-09-25T10:00:02.000Z";
			computer.updatedAt = "2026-09-25T10:00:02.000Z";
		}],
	])("fails recovery for %s", async function _InvalidEvidence(_name, mutate)
	{
		const f = _Fixture();
		await f.history.establish(_RECORD);
		mutate(f);

		await expect(f.history.readRecord(_RECORD.siloId, _RECORD.conversationId)).rejects.toThrow();
	});

	it("accepts a later validated computer lifecycle state with unchanged creation coordinates", async function _LaterComputerState()
	{
		const f = _Fixture();
		const receipt = await f.history.establish(_RECORD);
		const streamName = `conversation-computer-${_RECORD.computerId}`;
		const first = f.streams.get(streamName)![0]!;
		const computer = { ...(first.data.computer as Record<string, unknown>), state: ConversationComputerStates.RecoveryRequired, updatedAt: "2026-09-25T10:01:00.000Z" };
		f.streams.get(streamName)!.push({ ...first, id: "51c1f1dc-0010-4f13-9c2f-d3841ffd6651", revision: 1n, data: { computer, lease: null }, recordedAt: new Date("2026-09-25T10:01:00.000Z") });

		await expect(f.history.readRecord(_RECORD.siloId, _RECORD.conversationId)).resolves.toEqual(_RECORD);
		await expect(f.history.establish(_RECORD)).resolves.toEqual(receipt);
		expect(f.appendAtomic).toHaveBeenCalledOnce();
	});

	it.each([
		["blank silo", " ", _RECORD.conversationId],
		["untrimmed silo", `${_RECORD.siloId} `, _RECORD.conversationId],
		["blank conversation", _RECORD.siloId, "\n"],
		["untrimmed conversation", _RECORD.siloId, ` ${_RECORD.conversationId}`],
	])("rejects %s read coordinates before history I/O", async function _InvalidReadCoordinate(_name, siloId, conversationId)
	{
		const f = _Fixture();

		await expect(f.history.readRecord(siloId, conversationId)).rejects.toThrow();
		expect(f.store.readStream).not.toHaveBeenCalled();
		expect(f.store.readHead).not.toHaveBeenCalled();
	});

	it.each([
		["requester outside the audience", { audiencePrincipalIds: ["principal-2"] }],
		["self-referential destination", { origin: { ..._RECORD.origin, destinationConversationId: _RECORD.conversationId } }],
		["malformed digest", { ciphertextDigest: "sha256:invalid" }],
		["undeclared field", { plaintextInstruction: "Do the secret work" }],
	])("rejects invalid input before writing: %s", async function _InvalidInput(_name, patch)
	{
		const f = _Fixture();

		await expect(f.history.establish({ ..._RECORD, ...patch } as never)).rejects.toThrow();
		expect(f.appendAtomic).not.toHaveBeenCalled();
		expect(f.streams).toHaveProperty("size", 0);
	});

	it("rejects oversized receipt metadata before writing", async function _Oversized()
	{
		const f = _Fixture();
		const audience = [_RECORD.requesterPrincipalId, ...Array.from({ length: 140 }, function _Principal(_, index) { return `principal-${index}-${"x".repeat(990)}`; })];

		await expect(f.history.establish({ ..._RECORD, audiencePrincipalIds: audience })).rejects.toThrow("exceeds its metadata size limit");
		expect(f.appendAtomic).not.toHaveBeenCalled();
		expect(f.streams).toHaveProperty("size", 0);
	});
});
