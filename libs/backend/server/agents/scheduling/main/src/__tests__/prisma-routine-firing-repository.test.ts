import { AgentRoutineFiringDisposition, AgentRoutineFiringTrigger, AgentRoutineStatus, Prisma } from "@prisma/client";
import type { Prisma as PrismaTypes } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { RoutineFiringDisposition, RoutineFiringTrigger } from "@opencrane/models/agents";

import { PrismaRoutineFiringRepository } from "../prisma-routine-firing-repository";
import type { RoutineFactsRepository } from "../routine-prisma-facts.types";
import { RoutineOccurrenceStage, type RoutineTaskAdmissionPort } from "../routine-workflow.types";
import type { RoutineScheduleRepairPage } from "../routine-schedule-repair.types";
import { _Current, _Facts, _FiringRow, _IDENTITY, _NOW, _SCHEDULE_TASK, _TaskAdmission } from "./prisma-routine-test-fixtures";

/** Composes the real firing repository from inspectable transaction doubles. */
function _Repository(transaction: Record<string, unknown>, facts = _Facts(), tasks = _TaskAdmission())
{
	return { repository: new PrismaRoutineFiringRepository(transaction as unknown as PrismaTypes.TransactionClient, facts as unknown as RoutineFactsRepository, tasks as unknown as RoutineTaskAdmissionPort<PrismaTypes.TransactionClient>), facts, tasks };
}

describe("PrismaRoutineFiringRepository automatic selection", function _AutomaticSuite()
{
	it("persists only the latest missed slot, records overlap, and advances the cursor", async function _LatestOverlap()
	{
		const firingCreate = vi.fn().mockResolvedValue({});
		const cursorUpdate = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = {
			agentRoutineFiring: { create: firingCreate, update: vi.fn().mockResolvedValue({}) },
			agentRoutine: { updateMany: cursorUpdate, update: vi.fn().mockResolvedValue({}) },
		};
		const facts = _Facts();
		facts.unfinishedFiring.mockResolvedValue({ id: "firing-running", disposition: RoutineFiringDisposition.Running });
		const f = _Repository(transaction, facts);

		await expect(f.repository.fireAutomatic({ siloId: "silo-1", routineId: "routine-1", routineRevision: 2, scheduleTask: _SCHEDULE_TASK, firingId: "firing-latest", conversationId: "conversation-latest" })).resolves.toMatchObject({ trigger: RoutineFiringTrigger.Automatic, disposition: RoutineFiringDisposition.SkippedOverlap, scheduledSlot: "2026-09-25T12:00:00.000Z", reason: "unfinished_firing" });
		expect(firingCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ scheduledSlot: new Date("2026-09-25T12:00:00.000Z"), disposition: AgentRoutineFiringDisposition.SkippedOverlap, overlapFiringId: "firing-running", finishedAt: _NOW }) });
		expect(cursorUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastAutomaticOccurrence: new Date("2026-09-25T12:00:00.000Z"), nextAutomaticOccurrence: new Date("2026-09-25T13:00:00.000Z") }) }));
		expect(f.tasks.admitSchedule).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ slotEpochMs: Date.parse("2026-09-25T13:00:00.000Z") }));
		expect(f.tasks.admitOccurrence).not.toHaveBeenCalled();
	});

	it("records the scheduler identity as the automatic firing audit actor", async function _AutomaticActor()
	{
		const transaction = {
			agentRoutineFiring: { create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) },
			agentRoutine: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), update: vi.fn().mockResolvedValue({}) },
		};
		const f = _Repository(transaction);

		await f.repository.fireAutomatic({ siloId: "silo-1", routineId: "routine-1", routineRevision: 2, scheduleTask: _SCHEDULE_TASK, firingId: "firing-latest", conversationId: "conversation-latest" });
		expect(f.facts.admitFiringActions).toHaveBeenCalledWith(expect.any(Object), { actorKind: "system", actorId: "opencrane-server/routine-schedule/v1" }, _NOW, expect.objectContaining({ firingKey: expect.stringMatching(/^sha256:/u) }));
		expect(f.tasks.admitOccurrence).toHaveBeenCalledOnce();
	});
});

describe("PrismaRoutineFiringRepository stage and receipt fences", function _StageSuite()
{
	it.each([
		[AgentRoutineFiringTrigger.Manual, { actorKind: "user", actorId: "principal-1" }],
		[AgentRoutineFiringTrigger.Automatic, { actorKind: "system", actorId: "opencrane-server/routine-schedule/v1" }],
	] as const)("rechecks every %s stage with the persisted trigger actor", async function _StageActor(trigger, actor)
	{
		const row = _FiringRow({ trigger });
		const transaction = { agentRoutineFiring: { findFirst: vi.fn().mockResolvedValue(row), updateMany: vi.fn() } };
		const f = _Repository(transaction);

		for (const stage of [RoutineOccurrenceStage.Preparation, RoutineOccurrenceStage.Activation, RoutineOccurrenceStage.RunAdmission])
		{
			await expect(f.repository.authorizeOccurrenceStage(_IDENTITY, stage)).resolves.toMatchObject({ firingId: "firing-1", audiencePrincipalIds: ["principal-1", "principal-2"] });
			expect(f.facts.admitFiringActions).toHaveBeenLastCalledWith(expect.any(Object), actor, _NOW, expect.objectContaining({ stage }));
		}
		expect(f.facts.currentAudienceAllowed).toHaveBeenCalledTimes(3);
		expect(f.facts.findCurrentManagedAgent).toHaveBeenCalledTimes(3);
	});

	it("durably refuses a preparing stage with compare-and-set while retaining prior receipts", async function _StageRefusal()
	{
		const preparation = { receiptId: "preparation-1", historyReference: "history-1", digest: `sha256:${"1".repeat(64)}` };
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { agentRoutineFiring: { findFirst: vi.fn().mockResolvedValue(_FiringRow({ preparationReceipt: preparation })), updateMany } };
		const facts = _Facts();
		facts.currentAudienceAllowed.mockResolvedValue(false);
		const f = _Repository(transaction, facts);

		await expect(f.repository.authorizeOccurrenceStage(_IDENTITY, RoutineOccurrenceStage.Activation)).resolves.toBeNull();
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ disposition: AgentRoutineFiringDisposition.Preparing, runId: null }), data: { disposition: AgentRoutineFiringDisposition.Refused, refusalReason: "stage_activation_current_authority_refused", finishedAt: _NOW, updatedAt: _NOW } }));
	});

	it("continues an admitted revision after a later edit using its frozen instruction and audience", async function _FrozenRevision()
	{
		const identity = { ..._IDENTITY, routineRevision: 1 };
		const frozenDigest = `sha256:${"9".repeat(64)}` as const;
		const row = _FiringRow({ routineRevision: 1, revision: { instructionKeyId: "key-revision-1", instructionNonce: new Uint8Array([9]), instructionAuthTag: new Uint8Array([8]), instructionCiphertext: new Uint8Array([7]), instructionCiphertextDigest: frozenDigest, audiencePrincipalIds: ["principal-1", "principal-2"] } });
		const transaction = { agentRoutineFiring: { findFirst: vi.fn().mockResolvedValue(row), updateMany: vi.fn() } };
		const current = _Current({ currentRevision: 2 }, { revision: 2, instructionCiphertextDigest: `sha256:${"a".repeat(64)}` });
		const f = _Repository(transaction, _Facts(current));

		await expect(f.repository.authorizeOccurrenceStage(identity, RoutineOccurrenceStage.Activation)).resolves.toMatchObject({ routineRevision: 1, audiencePrincipalIds: ["principal-1", "principal-2"], instruction: { keyId: "key-revision-1", ciphertextDigest: frozenDigest } });
		expect(f.facts.current).toHaveBeenCalledWith("silo-1", "routine-1");
		expect(f.facts.findCurrentManagedAgent).toHaveBeenCalledWith(current.routine);
	});

	it("replays the first preparation receipt and rejects activation before preparation", async function _ReceiptReplay()
	{
		const saved = { receiptId: "preparation-saved", historyReference: "history-saved", digest: `sha256:${"2".repeat(64)}` as const };
		const activation = { receiptId: "activation-saved", computerReference: "computer-saved", digest: `sha256:${"3".repeat(64)}` as const };
		const transaction = { agentRoutineFiring: { findFirst: vi.fn().mockResolvedValue(_FiringRow({ preparationReceipt: saved, activationReceipt: activation })), updateMany: vi.fn() } };
		const f = _Repository(transaction);

		await expect(f.repository.recordPreparation(_IDENTITY, { ...saved, receiptId: "retry-different" })).resolves.toEqual(saved);
		await expect(f.repository.recordActivation(_IDENTITY, { ...activation, receiptId: "retry-different" })).resolves.toEqual(activation);
		expect(transaction.agentRoutineFiring.updateMany).not.toHaveBeenCalled();
		transaction.agentRoutineFiring.findFirst.mockResolvedValue(_FiringRow());
		await expect(f.repository.recordActivation(_IDENTITY, { receiptId: "activation-1", computerReference: "computer-1", digest: `sha256:${"3".repeat(64)}` })).rejects.toThrow("requires a saved preparation receipt");
	});

	it.each([
		["receipt identifier", { receiptId: " " }],
		["history reference", { historyReference: "" }],
		["digest", { digest: "sha256:not-a-digest" }],
		["unknown field", { unexpected: true }],
	])("rejects a malformed saved preparation receipt: %s", async function _MalformedPreparation(_name, patch)
	{
		const receipt = { receiptId: "preparation-1", historyReference: "history-1", digest: `sha256:${"2".repeat(64)}`, ...patch };
		const transaction = { agentRoutineFiring: { findFirst: vi.fn().mockResolvedValue(_FiringRow({ preparationReceipt: receipt })), updateMany: vi.fn() } };
		const f = _Repository(transaction);

		await expect(f.repository.recordPreparation(_IDENTITY, { receiptId: "retry", historyReference: "retry", digest: `sha256:${"8".repeat(64)}` })).rejects.toThrow("routine preparation receipt is invalid");
		expect(transaction.agentRoutineFiring.updateMany).not.toHaveBeenCalled();
	});

	it.each([
		["receipt identifier", { receiptId: "" }],
		["computer reference", { computerReference: "\n" }],
		["digest", { digest: `sha256:${"A".repeat(64)}` }],
		["unknown field", { unexpected: true }],
	])("rejects a malformed saved activation receipt: %s", async function _MalformedActivation(_name, patch)
	{
		const preparation = { receiptId: "preparation-1", historyReference: "history-1", digest: `sha256:${"2".repeat(64)}` };
		const activation = { receiptId: "activation-1", computerReference: "computer-1", digest: `sha256:${"3".repeat(64)}`, ...patch };
		const transaction = { agentRoutineFiring: { findFirst: vi.fn().mockResolvedValue(_FiringRow({ preparationReceipt: preparation, activationReceipt: activation })), updateMany: vi.fn() } };
		const f = _Repository(transaction);

		await expect(f.repository.recordActivation(_IDENTITY, { receiptId: "retry", computerReference: "retry", digest: `sha256:${"8".repeat(64)}` })).rejects.toThrow("routine activation receipt is invalid");
		expect(transaction.agentRoutineFiring.updateMany).not.toHaveBeenCalled();
	});

	it("rejects malformed checkpoint receipts before saving them", async function _MalformedCheckpointReceipt()
	{
		const preparation = { receiptId: "preparation-1", historyReference: "history-1", digest: `sha256:${"2".repeat(64)}` };
		const transaction = { agentRoutineFiring: { findFirst: vi.fn().mockResolvedValueOnce(_FiringRow()).mockResolvedValueOnce(_FiringRow({ preparationReceipt: preparation })), updateMany: vi.fn() } };
		const f = _Repository(transaction);

		await expect(f.repository.recordPreparation(_IDENTITY, { ...preparation, digest: "wrong" } as never)).rejects.toThrow("routine preparation receipt is invalid");
		await expect(f.repository.recordActivation(_IDENTITY, { receiptId: "activation-1", computerReference: "computer-1", digest: "wrong" } as never)).rejects.toThrow("routine activation receipt is invalid");
		expect(transaction.agentRoutineFiring.updateMany).not.toHaveBeenCalled();
	});

	it("rejects malformed saved stage receipts before binding a recovered run", async function _MalformedRunBindingReceipt()
	{
		const preparation = { receiptId: "preparation-1", historyReference: "history-1", digest: `sha256:${"2".repeat(64)}` };
		const activation = { receiptId: "activation-1", computerReference: "computer-1", digest: "wrong" };
		const transaction = { agentRoutineFiring: { findFirst: vi.fn().mockResolvedValue(_FiringRow({ runId: "run-1", preparationReceipt: preparation, activationReceipt: activation })), updateMany: vi.fn() }, agentRun: { findFirst: vi.fn() } };
		const f = _Repository(transaction);

		await expect(f.repository.bindAdmittedRun(_IDENTITY, "run-1")).rejects.toThrow("routine activation receipt is invalid");
		expect(transaction.agentRun.findFirst).not.toHaveBeenCalled();
	});

	it("fails closed when the first preparation receipt loses its compare-and-set", async function _ReceiptCas()
	{
		const transaction = { agentRoutineFiring: { findFirst: vi.fn().mockResolvedValue(_FiringRow()), updateMany: vi.fn().mockResolvedValue({ count: 0 }) } };
		const f = _Repository(transaction);

		await expect(f.repository.recordPreparation(_IDENTITY, { receiptId: "preparation-1", historyReference: "history-1", digest: `sha256:${"4".repeat(64)}` })).rejects.toThrow("preparation receipt compare-and-set conflict");
	});

	it("recovers a run backlink committed before a restart and binds it without repeating preparation", async function _RestartedAdmission()
	{
		const preparation = { receiptId: "preparation-1", historyReference: "history-1", digest: `sha256:${"5".repeat(64)}` };
		const activation = { receiptId: "activation-1", computerReference: "computer-1", digest: `sha256:${"6".repeat(64)}` };
		const row = _FiringRow({ runId: "run-1", preparationReceipt: preparation, activationReceipt: activation });
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { agentRoutineFiring: { findFirst: vi.fn().mockResolvedValue(row), updateMany }, agentRun: { findFirst: vi.fn().mockResolvedValue({ id: "run-1" }) } };
		const f = _Repository(transaction);

		await expect(f.repository.authorizeOccurrenceStage(_IDENTITY, RoutineOccurrenceStage.RunAdmission)).resolves.toMatchObject({ admittedRunId: "run-1" });
		await expect(f.repository.bindAdmittedRun(_IDENTITY, "run-1")).resolves.toBeUndefined();
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ disposition: AgentRoutineFiringDisposition.Preparing, runId: "run-1" }), data: { disposition: AgentRoutineFiringDisposition.Running } }));
		expect(f.tasks.admitOccurrence).not.toHaveBeenCalled();
	});
});

describe("PrismaRoutineFiringRepository schedule repair pages", function _RepairSuite()
{
	it("repairs one silo-scoped active page in stable id order", async function _Page()
	{
		const rows = [{ id: "routine-1", siloId: "silo-1", currentRevision: 2, nextAutomaticOccurrence: new Date("2026-09-25T12:00:00.000Z") }, { id: "routine-2", siloId: "silo-1", currentRevision: 3, nextAutomaticOccurrence: new Date("2026-09-25T13:00:00.000Z") }];
		const findMany = vi.fn().mockResolvedValue(rows);
		const transaction = { agentRoutine: { findMany, update: vi.fn() } };
		const tasks = _TaskAdmission();
		const f = _Repository(transaction, _Facts(), tasks);
		const page: RoutineScheduleRepairPage = { siloId: "silo-1", limit: 2, afterRoutineId: null };

		await expect(f.repository.repairActiveSchedulesPage(page)).resolves.toEqual({ checked: 2, nextCursor: "routine-2" });
		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ siloId: "silo-1", status: AgentRoutineStatus.Active }), orderBy: { id: "asc" }, take: 2 }));
		expect(tasks.admitSchedule).toHaveBeenCalledTimes(2);
		expect(transaction.agentRoutine.update).toHaveBeenCalledTimes(2);
	});

	it.each([
		{ siloId: " ", limit: 1, afterRoutineId: null },
		{ siloId: "silo-1", limit: 0, afterRoutineId: null },
		{ siloId: "silo-1", limit: 101, afterRoutineId: null },
		{ siloId: "silo-1", limit: 1, afterRoutineId: " " },
	] as const)("rejects an invalid repair page %j", async function _Invalid(page)
	{
		await expect(_Repository({ agentRoutine: { findMany: vi.fn() } }).repository.repairActiveSchedulesPage(page)).rejects.toThrow();
	});
});
