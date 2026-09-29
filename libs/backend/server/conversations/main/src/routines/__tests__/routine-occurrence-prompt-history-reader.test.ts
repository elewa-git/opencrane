import { describe, expect, it, vi } from "vitest";

import type { RoutineOccurrencePromptAdmissionQuery } from "@opencrane/backend/agents/execution/inputs";
import { RoutineFiringTrigger } from "@opencrane/models/agents";
import { ConversationGenesisOriginKinds } from "@opencrane/models/conversations";

import { _RoutineEventId } from "../routine-occurrence-history.mapper";
import type { RoutineOccurrenceHistoryRecord } from "../routine-occurrence-history.types";
import { RoutineOccurrencePromptHistoryReader } from "../routine-occurrence-prompt-history-reader";

const _RECORD: RoutineOccurrenceHistoryRecord = {
	siloId: "silo", conversationId: "occurrence", agentServiceId: "assistant",
	origin: { kind: ConversationGenesisOriginKinds.RoutineOccurrence, routineId: "routine", routineRevision: 2, firingId: "firing", destinationConversationId: "destination", trigger: RoutineFiringTrigger.Automatic, scheduledSlot: "2026-09-25T08:00:00.000Z" },
	requesterPrincipalId: "principal", requesterIssuer: "https://issuer.test", requesterSubjectId: "subject", requesterAuthenticatedAt: "2026-09-20T07:00:00.000Z",
	task: { taskId: "task", taskName: "routine.prepare", idempotencyKey: "firing-task" }, audiencePrincipalIds: ["principal", "colleague"],
	computerId: "computer", agentIdentityId: "identity", profileRevisionId: `sha256:${"a".repeat(64)}`, createdAt: "2026-09-25T08:00:01.000Z", payloadRef: "payload", ciphertextDigest: `sha256:${"b".repeat(64)}`,
};
const _QUERY: RoutineOccurrencePromptAdmissionQuery = {
	siloId: "silo", conversationId: "occurrence", agentServiceId: "assistant", trigger: "scheduled",
	routine: { routineId: "routine", routineRevision: 2, firingId: "firing", scheduledSlot: "2026-09-25T08:00:00.000Z", requesterPrincipalId: "principal", requesterIssuer: "https://issuer.test", requesterSubjectId: "subject", requesterAuthenticatedAt: "2026-09-20T07:00:00.000Z", workflowTaskId: "task", workflowTaskName: "routine.prepare", workflowTaskKey: "firing-task" },
};

describe("routine occurrence prompt history", function _Suite()
{
	it("returns only the immutable first instruction and preserves original requester evidence", async function _Exact()
	{
		const history = { readRecord: vi.fn().mockResolvedValue(_RECORD) };
		const reader = new RoutineOccurrencePromptHistoryReader(history);
		await expect(reader.read(_QUERY)).resolves.toEqual({ historyRevision: "1", orderedMessageIds: [_RoutineEventId("instruction", "occurrence")] });
		await expect(reader.readRecord(_QUERY)).resolves.toBe(_RECORD);
		expect(history.readRecord).toHaveBeenCalledWith("silo", "occurrence");
	});
	it("accepts a manual firing only with its null slot and manual trigger", async function _Manual()
	{
		const record = { ..._RECORD, origin: { ..._RECORD.origin, trigger: RoutineFiringTrigger.Manual, scheduledSlot: null } };
		const reader = new RoutineOccurrencePromptHistoryReader({ readRecord: vi.fn().mockResolvedValue(record) });
		const query = { ..._QUERY, trigger: "manual" as const, routine: { ..._QUERY.routine, scheduledSlot: null } };
		await expect(reader.read(query)).resolves.toMatchObject({ historyRevision: "1" });
		await expect(reader.read({ ...query, trigger: "scheduled" })).resolves.toBeNull();
	});
	it.each<Partial<RoutineOccurrencePromptAdmissionQuery>>([
		{ siloId: "other-silo" }, { conversationId: "destination" }, { agentServiceId: "other-assistant" }, { trigger: "manual" },
	])("rejects changed top-level admission coordinates %j", async function _TopLevel(change)
	{
		const reader = new RoutineOccurrencePromptHistoryReader({ readRecord: vi.fn().mockResolvedValue(_RECORD) });
		await expect(reader.read({ ..._QUERY, ...change })).resolves.toBeNull();
	});
	it.each<Partial<RoutineOccurrencePromptAdmissionQuery["routine"]>>([
		{ routineId: "other-routine" }, { routineRevision: 3 }, { firingId: "other-firing" }, { scheduledSlot: null },
		{ scheduledSlot: "2026-09-25T09:00:00.000Z" }, { requesterPrincipalId: "colleague" }, { requesterIssuer: "https://other.test" },
		{ requesterSubjectId: "other-subject" }, { requesterAuthenticatedAt: "2026-09-25T08:00:01.000Z" },
		{ workflowTaskId: "other-task" }, { workflowTaskName: "other.workflow" }, { workflowTaskKey: "other-key" },
	])("rejects changed routine provenance %j", async function _Routine(change)
	{
		const reader = new RoutineOccurrencePromptHistoryReader({ readRecord: vi.fn().mockResolvedValue(_RECORD) });
		await expect(reader.read({ ..._QUERY, routine: { ..._QUERY.routine, ...change } })).resolves.toBeNull();
	});
	it("returns null before preparation but never hides malformed saved evidence", async function _AbsenceAndCorruption()
	{
		await expect(new RoutineOccurrencePromptHistoryReader({ readRecord: vi.fn().mockResolvedValue(null) }).read(_QUERY)).resolves.toBeNull();
		const error = new Error("Receipt and genesis disagree");
		await expect(new RoutineOccurrencePromptHistoryReader({ readRecord: vi.fn().mockRejectedValue(error) }).read(_QUERY)).rejects.toBe(error);
	});
	it("refuses undeclared query fields rather than accepting browser-selected message IDs", async function _Extra()
	{
		const reader = new RoutineOccurrencePromptHistoryReader({ readRecord: vi.fn().mockResolvedValue(_RECORD) });
		const query = { ..._QUERY, orderedMessageIds: ["destination-message"] };
		await expect(reader.read(query)).resolves.toBeNull();
	});
});
