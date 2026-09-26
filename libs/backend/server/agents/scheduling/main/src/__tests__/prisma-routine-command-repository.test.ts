import { AgentRoutineCommandKind, AgentRoutineFiringDisposition, AgentRoutineStatus, Prisma } from "@prisma/client";
import type { ManagedAuthorizationGrantRepository, ManagedAuthorizationGrantRestrictionRepository } from "@opencrane/backend/server/iam/authorization";
import { describe, expect, it, vi } from "vitest";

import { ProductAuthorizationActions } from "@opencrane/models/authorization";
import { RoutineFiringDisposition, RoutineFiringTrigger, RoutineStatus } from "@opencrane/models/agents";

import { PrismaRoutineCommandRepository } from "../prisma-routine-command-repository";
import { RoutineCommandOutcome } from "../routine-authority.types";
import type { RoutineFactsRepository } from "../routine-prisma-facts.types";
import { RoutineLifecycleEvent } from "../routine-lifecycle.types";
import type { RoutineTaskAdmissionPort } from "../routine-workflow.types";
import { _CALLER, _Current, _Facts, _INSTRUCTION, _NOW, _TaskAdmission } from "./prisma-routine-test-fixtures";

/** Builds the narrow grant repository required by command persistence. */
function _Grants()
{
	return { reconcileManagedResourceGrants: vi.fn().mockResolvedValue(1), restrictManagedResourceGrants: vi.fn().mockResolvedValue(3) };
}

/** Composes the real command repository from inspectable transaction doubles. */
function _Repository(transaction: Record<string, unknown>, facts = _Facts(), grants = _Grants(), tasks = _TaskAdmission())
{
	return { repository: new PrismaRoutineCommandRepository(transaction as unknown as Prisma.TransactionClient, facts as unknown as RoutineFactsRepository, grants as unknown as ManagedAuthorizationGrantRepository & ManagedAuthorizationGrantRestrictionRepository, tasks as unknown as RoutineTaskAdmissionPort<Prisma.TransactionClient>), facts, grants, tasks };
}

describe("PrismaRoutineCommandRepository", function _Suite()
{
	it("creates and exactly replays the fixed audience, task, grants, and receipt", async function _CreateReplay()
	{
		let savedReceipt: { routineId: string; commandDigest: string; result: Prisma.JsonValue; routineRevision: number | null; firingId: string | null } | null = null;
		const routineCreate = vi.fn().mockResolvedValue({});
		const revisionCreate = vi.fn().mockResolvedValue({});
		const receiptCreate = vi.fn(async function _Save({ data }: { data: { routineId: string; commandDigest: string; result: Prisma.JsonValue; routineRevision: number | null; firingId: string | null } }) { savedReceipt = data; return data; });
		const transaction = {
			agentRoutine: { create: routineCreate, update: vi.fn().mockResolvedValue({}) },
			agentRoutineRevision: { create: revisionCreate },
			agentRoutineCommandReceipt: { findUnique: vi.fn(async function _Read() { return savedReceipt; }), create: receiptCreate },
		};
		const current = _Current({}, { audiencePrincipalIds: ["principal-1", "principal-2"] });
		const f = _Repository(transaction, _Facts(current));
		const command = { caller: _CALLER, destinationConversationId: "destination-1", audiencePrincipalIds: ["principal-1", "principal-2"], selectedManagedServiceId: "service-1", schedule: { expression: "0 * * * *", timezone: "UTC" }, idempotencyKey: "create-key-1", routineId: "routine-created", revisionId: "revision-created", commandReceiptId: "receipt-created", instruction: _INSTRUCTION, commandDigest: `sha256:${"b".repeat(64)}` as const };

		const first = await f.repository.create(command);
		const replay = await f.repository.create({ ...command, routineId: "unused-retry-id", revisionId: "unused-retry-revision", commandReceiptId: "unused-retry-receipt" });
		await expect(f.repository.create({ ...command, commandDigest: `sha256:${"0".repeat(64)}` })).rejects.toThrow("idempotency key conflicts");

		expect(replay).toEqual(first);
		expect(first).toMatchObject({ outcome: RoutineCommandOutcome.Committed, routineId: "routine-created", status: RoutineStatus.Active, currentRevision: 1, lifecycleRevision: 1, nextAutomaticOccurrence: "2026-09-25T13:00:00.000Z" });
		expect(routineCreate).toHaveBeenCalledOnce();
		expect(revisionCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ routineId: "routine-created", audiencePrincipalIds: ["principal-1", "principal-2"] }) });
		expect(f.grants.reconcileManagedResourceGrants).toHaveBeenCalledWith(expect.objectContaining({ grants: expect.arrayContaining([expect.objectContaining({ subject: { kind: "principal", principalId: "principal-2" }, capability: expect.objectContaining({ capabilityId: "routine:read" }) })]) }));
		expect(f.tasks.admitSchedule).toHaveBeenCalledOnce();
		expect(receiptCreate).toHaveBeenCalledOnce();
	});

	it.each([
		["outcome", { outcome: "unknown" }],
		["valid refused definition outcome", { outcome: RoutineCommandOutcome.Refused }],
		["routine identifier", { routineId: " " }],
		["current revision", { currentRevision: 0 }],
		["safe current revision", { currentRevision: Number.MAX_SAFE_INTEGER + 1 }],
		["status", { status: "unknown" }],
		["active definition without a next occurrence", { nextAutomaticOccurrence: null }],
		["paused definition with a next occurrence", { status: RoutineStatus.Paused }],
		["retired definition with a next occurrence", { status: RoutineStatus.Retired }],
		["lifecycle revision", { lifecycleRevision: 1.5 }],
		["next occurrence", { nextAutomaticOccurrence: "2026-09-25" }],
		["unknown field", { unexpected: true }],
	])("rejects a malformed saved command result: %s", async function _MalformedCommandResult(_name, patch)
	{
		const commandDigest = `sha256:${"b".repeat(64)}` as const;
		const result = { outcome: RoutineCommandOutcome.Committed, routineId: "routine-created", currentRevision: 1, status: RoutineStatus.Active, lifecycleRevision: 1, nextAutomaticOccurrence: "2026-09-25T13:00:00.000Z", ...patch };
		const transaction = { agentRoutineCommandReceipt: { findUnique: vi.fn().mockResolvedValue({ routineId: "routine-created", commandDigest, result: result as unknown as Prisma.JsonValue, routineRevision: 1, firingId: null }) } };
		const f = _Repository(transaction);
		const command = { caller: _CALLER, destinationConversationId: "destination-1", audiencePrincipalIds: ["principal-1", "principal-2"], selectedManagedServiceId: "service-1", schedule: { expression: "0 * * * *", timezone: "UTC" }, idempotencyKey: "create-key-1", routineId: "routine-created", revisionId: "revision-created", commandReceiptId: "receipt-created", instruction: _INSTRUCTION, commandDigest };

		await expect(f.repository.create(command)).rejects.toThrow("routine command receipt result is invalid");
	});

	it.each([
		["routine", { routineId: "another-routine", routineRevision: 1, firingId: null }],
		["revision", { routineId: "routine-created", routineRevision: 2, firingId: null }],
		["unexpected firing", { routineId: "routine-created", routineRevision: 1, firingId: "firing-1" }],
	])("rejects a saved command result that disagrees with its receipt %s coordinate", async function _CommandReceiptCoordinates(_name, receipt)
	{
		const commandDigest = `sha256:${"b".repeat(64)}` as const;
		const result = { outcome: RoutineCommandOutcome.Committed, routineId: "routine-created", currentRevision: 1, status: RoutineStatus.Active, lifecycleRevision: 1, nextAutomaticOccurrence: "2026-09-25T13:00:00.000Z" };
		const transaction = { agentRoutineCommandReceipt: { findUnique: vi.fn().mockResolvedValue({ ...receipt, commandDigest, result: result as Prisma.JsonValue }) } };
		const f = _Repository(transaction);
		const command = { caller: _CALLER, destinationConversationId: "destination-1", audiencePrincipalIds: ["principal-1", "principal-2"], selectedManagedServiceId: "service-1", schedule: { expression: "0 * * * *", timezone: "UTC" }, idempotencyKey: "create-key-1", routineId: "unused-retry-id", revisionId: "unused-retry-revision", commandReceiptId: "unused-retry-receipt", instruction: _INSTRUCTION, commandDigest };

		await expect(f.repository.create(command)).rejects.toThrow("routine command receipt result is invalid");
	});

	it("replays the first revision result after the routine advances", async function _RevisionReplayAfterAdvance()
	{
		const commandDigest = `sha256:${"c".repeat(64)}` as const;
		const result = { outcome: RoutineCommandOutcome.Committed, routineId: "routine-1", currentRevision: 3, status: RoutineStatus.Active, lifecycleRevision: 5, nextAutomaticOccurrence: "2026-09-25T13:00:00.000Z" };
		const transaction = { agentRoutineCommandReceipt: { findUnique: vi.fn().mockResolvedValue({ routineId: "routine-1", commandDigest, result: result as Prisma.JsonValue, routineRevision: 3, firingId: null }) } };
		const current = _Current({ currentRevision: 5, lifecycleRevision: 7 }, { id: "revision-5", revision: 5 });
		const f = _Repository(transaction, _Facts(current));
		const command = { caller: _CALLER, routineId: "routine-1", expectedRevision: 2, expectedLifecycleRevision: 4, schedule: { expression: "30 * * * *", timezone: "UTC" }, idempotencyKey: "revise-key-1", revisionId: "unused-retry-revision", commandReceiptId: "unused-retry-receipt", instruction: _INSTRUCTION, commandDigest };

		await expect(f.repository.revise(command)).resolves.toEqual(result);
	});

	it("rejects a non-create receipt saved for another requested routine", async function _RequestedRoutineBinding()
	{
		const commandDigest = `sha256:${"d".repeat(64)}` as const;
		const result = { outcome: RoutineCommandOutcome.Committed, routineId: "another-routine", currentRevision: 2, status: RoutineStatus.Active, lifecycleRevision: 4, nextAutomaticOccurrence: "2026-09-25T13:00:00.000Z" };
		const transaction = { agentRoutineCommandReceipt: { findUnique: vi.fn().mockResolvedValue({ routineId: "another-routine", commandDigest, result: result as Prisma.JsonValue, routineRevision: 2, firingId: null }) } };
		const f = _Repository(transaction);
		const command = { caller: _CALLER, routineId: "routine-1", expectedRevision: 2, expectedLifecycleRevision: 4, schedule: { expression: "30 * * * *", timezone: "UTC" }, idempotencyKey: "revise-key-1", revisionId: "unused-retry-revision", commandReceiptId: "unused-retry-receipt", instruction: _INSTRUCTION, commandDigest };

		await expect(f.repository.revise(command)).rejects.toThrow("receipt belongs to another routine");
	});

	it("reads the encrypted current revision only for one fixed-audience caller with current Read", async function _Read()
	{
		const current = _Current();
		const f = _Repository({}, _Facts(current));

		await expect(f.repository.read({ caller: _CALLER, routineId: "routine-1" })).resolves.toMatchObject({ routineId: "routine-1", status: RoutineStatus.Active, audiencePrincipalIds: ["principal-1", "principal-2"], instruction: _INSTRUCTION });
		expect(f.facts.requireCurrentAudience).toHaveBeenCalledWith(current.routine, current.revision, _NOW);
		expect(f.facts.requireCurrentReader).not.toHaveBeenCalled();
		expect(f.facts.requirePrincipalAction).toHaveBeenCalledWith("principal-1", "silo-1", expect.any(String), "routine-1", ProductAuthorizationActions.Read, _NOW, false, {});
		await expect(f.repository.read({ caller: { ..._CALLER, principalId: "principal-outside" }, routineId: "routine-1" })).resolves.toBeNull();
	});

	it("reads retired history through only the caller's current audience and destination access", async function _RetiredRead()
	{
		const current = _Current({ status: AgentRoutineStatus.Retired, nextAutomaticOccurrence: null });
		const facts = _Facts(current);
		facts.requireCurrentAudience.mockRejectedValue(new Error("another audience member lost access"));
		const f = _Repository({}, facts);

		await expect(f.repository.read({ caller: _CALLER, routineId: "routine-1" })).resolves.toMatchObject({ routineId: "routine-1", status: RoutineStatus.Retired });
		expect(f.facts.requireCurrentReader).toHaveBeenCalledWith(_CALLER, current.routine, current.revision, _NOW);
		expect(f.facts.requireCurrentAudience).not.toHaveBeenCalled();
		expect(f.facts.requirePrincipalAction).not.toHaveBeenCalled();
	});

	it("appends a revision with the frozen audience and fails a lost compare-and-set", async function _ReviseCas()
	{
		const revisionCreate = vi.fn().mockResolvedValue({});
		const updateMany = vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
		const transaction = {
			agentRoutine: { updateMany, update: vi.fn().mockResolvedValue({}) },
			agentRoutineRevision: { create: revisionCreate },
			agentRoutineCommandReceipt: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
		};
		const f = _Repository(transaction);
		const command = { caller: _CALLER, routineId: "routine-1", expectedRevision: 2, expectedLifecycleRevision: 4, schedule: { expression: "30 * * * *", timezone: "UTC" }, idempotencyKey: "revise-key-1", revisionId: "revision-3", commandReceiptId: "receipt-revise", instruction: _INSTRUCTION, commandDigest: `sha256:${"c".repeat(64)}` as const };

		await expect(f.repository.revise(command)).resolves.toMatchObject({ currentRevision: 3, lifecycleRevision: 5, status: RoutineStatus.Active });
		expect(revisionCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ revision: 3, audiencePrincipalIds: ["principal-1", "principal-2"] }) });
		await expect(f.repository.revise({ ...command, idempotencyKey: "revise-key-2", commandReceiptId: "receipt-revise-2" })).rejects.toThrow("compare-and-set conflict");
	});

	it("persists pause, resume, and retirement lifecycle changes under successive compare-and-set counters", async function _Lifecycle()
	{
		const current = _Current();
		const mutable = current.routine as unknown as { status: AgentRoutineStatus; lifecycleRevision: number; automaticEnabledAfter: Date; lastAutomaticOccurrence: Date | null; nextAutomaticOccurrence: Date | null };
		const updateMany = vi.fn(async function _Update({ data }: { data: { status: AgentRoutineStatus; lifecycleRevision: { increment: number }; automaticEnabledAfter: Date; lastAutomaticOccurrence: Date | null; nextAutomaticOccurrence: Date | null } })
		{
			mutable.status = data.status;
			mutable.lifecycleRevision += data.lifecycleRevision.increment;
			mutable.automaticEnabledAfter = data.automaticEnabledAfter;
			mutable.lastAutomaticOccurrence = data.lastAutomaticOccurrence;
			mutable.nextAutomaticOccurrence = data.nextAutomaticOccurrence;
			return { count: 1 };
		});
		const transaction = {
			agentRoutine: { updateMany, update: vi.fn().mockResolvedValue({}) },
			agentRoutineCommandReceipt: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
		};
		const f = _Repository(transaction, _Facts(current));
		const base = { caller: _CALLER, routineId: "routine-1", commandDigest: `sha256:${"d".repeat(64)}` as const };

		await expect(f.repository.changeStatus({ ...base, event: RoutineLifecycleEvent.Pause, expectedLifecycleRevision: 4, idempotencyKey: "pause-1", commandReceiptId: "receipt-pause" })).resolves.toMatchObject({ status: RoutineStatus.Paused, lifecycleRevision: 5, nextAutomaticOccurrence: null });
		await expect(f.repository.changeStatus({ ...base, event: RoutineLifecycleEvent.Resume, expectedLifecycleRevision: 5, idempotencyKey: "resume-1", commandReceiptId: "receipt-resume" })).resolves.toMatchObject({ status: RoutineStatus.Active, lifecycleRevision: 6, nextAutomaticOccurrence: "2026-09-25T13:00:00.000Z" });
		await expect(f.repository.changeStatus({ ...base, event: RoutineLifecycleEvent.Retire, expectedLifecycleRevision: 6, idempotencyKey: "retire-1", commandReceiptId: "receipt-retire" })).resolves.toMatchObject({ status: RoutineStatus.Retired, lifecycleRevision: 7, nextAutomaticOccurrence: null });
		expect(updateMany).toHaveBeenCalledTimes(3);
		expect(f.tasks.admitSchedule).toHaveBeenCalledOnce();
		expect(f.grants.restrictManagedResourceGrants).toHaveBeenCalledWith(expect.objectContaining({
			managerId: "routine-confirmed-access",
			resource: { kind: "routine", id: "routine-1" },
			retainedGrants: expect.arrayContaining([
				expect.objectContaining({ subject: { kind: "principal", principalId: "principal-1" }, capability: expect.objectContaining({ capabilityId: "routine:read" }) }),
				expect.objectContaining({ subject: { kind: "principal", principalId: "principal-2" }, capability: expect.objectContaining({ capabilityId: "routine:read" }) }),
			]),
		}));
		expect(f.grants.reconcileManagedResourceGrants).not.toHaveBeenCalled();
	});

	it("denies retirement receipt replay when the requester lost destination access", async function _RetireReplayRevokedReader()
	{
		const commandDigest = `sha256:${"d".repeat(64)}` as const;
		const result = { outcome: RoutineCommandOutcome.Committed, routineId: "routine-1", currentRevision: 2, status: RoutineStatus.Retired, lifecycleRevision: 5, nextAutomaticOccurrence: null };
		const transaction = { agentRoutineCommandReceipt: { findUnique: vi.fn().mockResolvedValue({ routineId: "routine-1", commandDigest, result: result as Prisma.JsonValue, routineRevision: 2, firingId: null }) } };
		const facts = _Facts(_Current({ status: AgentRoutineStatus.Retired, lifecycleRevision: 5, nextAutomaticOccurrence: null }));
		facts.requireCurrentReader.mockRejectedValue(new Error("routine reader no longer has current destination access"));
		const f = _Repository(transaction, facts);
		const command = { caller: _CALLER, routineId: "routine-1", event: RoutineLifecycleEvent.Retire, expectedLifecycleRevision: 4, idempotencyKey: "retire-1", commandReceiptId: "receipt-retire", commandDigest };

		await expect(f.repository.changeStatus(command)).rejects.toThrow("routine reader no longer has current destination access");
		expect(f.facts.requirePrincipalAction).not.toHaveBeenCalled();
	});

	it("durably refuses retired run-now and replays the first refusal without another firing", async function _RetiredRunNow()
	{
		let savedReceipt: { routineId: string; commandDigest: string; result: Prisma.JsonValue; routineRevision: number | null; firingId: string | null } | null = null;
		const firingCreate = vi.fn().mockResolvedValue({});
		const transaction = {
			agentRoutineFiring: { create: firingCreate, update: vi.fn().mockResolvedValue({}) },
			agentRoutineCommandReceipt: {
				findUnique: vi.fn(async function _Read() { return savedReceipt; }),
				create: vi.fn(async function _Save({ data }: { data: { routineId: string; commandDigest: string; result: Prisma.JsonValue; routineRevision: number | null; firingId: string | null } }) { savedReceipt = data; return data; }),
			},
		};
		const f = _Repository(transaction, _Facts(_Current({ status: AgentRoutineStatus.Retired })));
		const command = { caller: _CALLER, routineId: "routine-1", expectedLifecycleRevision: 4, idempotencyKey: "run-now-retired", firingId: "firing-refused", conversationId: "conversation-refused", commandReceiptId: "receipt-run-now", commandDigest: `sha256:${"e".repeat(64)}` as const };

		const first = await f.repository.runNow(command);
		await expect(f.repository.runNow({ ...command, firingId: "unused-firing", conversationId: "unused-conversation", commandReceiptId: "unused-receipt" })).resolves.toEqual(first);
		expect(first).toMatchObject({ outcome: RoutineCommandOutcome.Refused, firingId: "firing-refused", routineId: "routine-1", routineRevision: 2, disposition: RoutineFiringDisposition.Refused, conversationId: "conversation-refused", reason: "routine_retired" });
		expect(firingCreate).toHaveBeenCalledOnce();
		expect(firingCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ disposition: AgentRoutineFiringDisposition.Refused, finishedAt: _NOW }) });
		expect(f.tasks.admitOccurrence).not.toHaveBeenCalled();
		expect(f.facts.admitFiringActions).not.toHaveBeenCalled();
		expect(f.facts.requireCurrentReader).toHaveBeenCalledWith(_CALLER, expect.any(Object), expect.any(Object), _NOW);
	});

	it("denies retired run-now receipt access when the requester lost destination access", async function _RetiredRunNowRevokedReader()
	{
		const transaction = { agentRoutineCommandReceipt: { findUnique: vi.fn() } };
		const facts = _Facts(_Current({ status: AgentRoutineStatus.Retired }));
		facts.requireCurrentReader.mockRejectedValue(new Error("routine reader no longer has current destination access"));
		const f = _Repository(transaction, facts);
		const command = { caller: _CALLER, routineId: "routine-1", expectedLifecycleRevision: 4, idempotencyKey: "run-now-retired", firingId: "firing-refused", conversationId: "conversation-refused", commandReceiptId: "receipt-run-now", commandDigest: `sha256:${"e".repeat(64)}` as const };

		await expect(f.repository.runNow(command)).rejects.toThrow("routine reader no longer has current destination access");
		expect(transaction.agentRoutineCommandReceipt.findUnique).not.toHaveBeenCalled();
	});

	it("denies retired revision changes before writing a new revision", async function _RetiredRevise()
	{
		const revisionCreate = vi.fn();
		const transaction = {
			agentRoutineRevision: { create: revisionCreate },
			agentRoutineCommandReceipt: { findUnique: vi.fn().mockResolvedValue(null) },
		};
		const f = _Repository(transaction, _Facts(_Current({ status: AgentRoutineStatus.Retired })));
		const command = { caller: _CALLER, routineId: "routine-1", expectedRevision: 2, expectedLifecycleRevision: 4, schedule: { expression: "30 * * * *", timezone: "UTC" }, idempotencyKey: "revise-retired", revisionId: "revision-3", commandReceiptId: "receipt-revise", instruction: _INSTRUCTION, commandDigest: `sha256:${"c".repeat(64)}` as const };

		await expect(f.repository.revise(command)).rejects.toThrow("retired routine cannot be revised");
		expect(revisionCreate).not.toHaveBeenCalled();
		expect(f.facts.requireCurrentAudience).not.toHaveBeenCalled();
	});

	it("replays the first firing identifiers after the routine advances", async function _FiringReplayAfterAdvance()
	{
		let savedReceipt: { routineId: string; commandDigest: string; result: Prisma.JsonValue; routineRevision: number | null; firingId: string | null } | null = null;
		const firingCreate = vi.fn().mockResolvedValue({});
		const transaction = {
			agentRoutineFiring: { create: firingCreate, update: vi.fn().mockResolvedValue({}) },
			agentRoutineCommandReceipt: {
				findUnique: vi.fn(async function _Read() { return savedReceipt; }),
				create: vi.fn(async function _Save({ data }: { data: { routineId: string; commandDigest: string; result: Prisma.JsonValue; routineRevision: number | null; firingId: string | null } }) { savedReceipt = data; return data; }),
			},
		};
		const current = _Current();
		const f = _Repository(transaction, _Facts(current));
		const command = { caller: _CALLER, routineId: "routine-1", expectedLifecycleRevision: 4, idempotencyKey: "run-now-first", firingId: "firing-first", conversationId: "conversation-first", commandReceiptId: "receipt-first", commandDigest: `sha256:${"e".repeat(64)}` as const };

		const first = await f.repository.runNow(command);
		(current.routine as unknown as { currentRevision: number }).currentRevision = 5;
		(current.revision as unknown as { revision: number }).revision = 5;
		const replay = await f.repository.runNow({ ...command, firingId: "unused-firing", conversationId: "unused-conversation", commandReceiptId: "unused-receipt" });

		expect(replay).toEqual(first);
		expect(replay).toMatchObject({ firingId: "firing-first", routineId: "routine-1", routineRevision: 2, conversationId: "conversation-first" });
		expect(firingCreate).toHaveBeenCalledOnce();
		expect(f.tasks.admitOccurrence).toHaveBeenCalledOnce();
	});

	it.each([
		["outcome", { outcome: "unknown" }],
		["firing identifier", { firingId: "" }],
		["routine identifier", { routineId: " " }],
		["routine revision", { routineRevision: 0 }],
		["trigger", { trigger: "unknown" }],
		["manual trigger with a scheduled slot", { scheduledSlot: "2026-09-25T12:00:00.000Z" }],
		["automatic trigger without a scheduled slot", { trigger: RoutineFiringTrigger.Automatic }],
		["valid automatic result saved for a manual command", { trigger: RoutineFiringTrigger.Automatic, scheduledSlot: "2026-09-25T12:00:00.000Z" }],
		["disposition", { disposition: "unknown" }],
		["committed refused disposition", { disposition: RoutineFiringDisposition.Refused, reason: "authority_refused" }],
		["refused outcome without refused disposition", { outcome: RoutineCommandOutcome.Refused }],
		["manual overlap", { disposition: RoutineFiringDisposition.SkippedOverlap, reason: "unfinished_firing" }],
		["refused disposition without a reason", { outcome: RoutineCommandOutcome.Refused, disposition: RoutineFiringDisposition.Refused }],
		["overlap without a reason", { trigger: RoutineFiringTrigger.Automatic, disposition: RoutineFiringDisposition.SkippedOverlap, scheduledSlot: "2026-09-25T12:00:00.000Z" }],
		["reason for a preparing disposition", { reason: "unexpected_reason" }],
		["conversation identifier", { conversationId: "\t" }],
		["scheduled slot", { scheduledSlot: "not-an-instant" }],
		["reason", { reason: "" }],
		["unknown field", { unexpected: true }],
	])("rejects a malformed saved firing result: %s", async function _MalformedFiringResult(_name, patch)
	{
		const commandDigest = `sha256:${"e".repeat(64)}` as const;
		const result = { outcome: RoutineCommandOutcome.Committed, firingId: "firing-1", routineId: "routine-1", routineRevision: 2, trigger: RoutineFiringTrigger.Manual, disposition: RoutineFiringDisposition.Preparing, conversationId: "conversation-1", scheduledSlot: null, reason: null, ...patch };
		const transaction = { agentRoutineCommandReceipt: { findUnique: vi.fn().mockResolvedValue({ routineId: "routine-1", commandDigest, result: result as unknown as Prisma.JsonValue, routineRevision: 2, firingId: "firing-1" }) } };
		const f = _Repository(transaction);
		const command = { caller: _CALLER, routineId: "routine-1", expectedLifecycleRevision: 4, idempotencyKey: "run-now-1", firingId: "unused-firing", conversationId: "unused-conversation", commandReceiptId: "unused-receipt", commandDigest };

		await expect(f.repository.runNow(command)).rejects.toThrow("routine firing receipt result is invalid");
	});

	it.each([
		["routine", { routineId: "another-routine", routineRevision: 2, firingId: "firing-1" }],
		["revision", { routineId: "routine-1", routineRevision: 3, firingId: "firing-1" }],
		["firing", { routineId: "routine-1", routineRevision: 2, firingId: "another-firing" }],
	])("rejects a saved firing result that disagrees with its receipt %s coordinate", async function _FiringReceiptCoordinates(_name, receipt)
	{
		const commandDigest = `sha256:${"e".repeat(64)}` as const;
		const result = { outcome: RoutineCommandOutcome.Committed, firingId: "firing-1", routineId: "routine-1", routineRevision: 2, trigger: RoutineFiringTrigger.Manual, disposition: RoutineFiringDisposition.Preparing, conversationId: "conversation-1", scheduledSlot: null, reason: null };
		const transaction = { agentRoutineCommandReceipt: { findUnique: vi.fn().mockResolvedValue({ ...receipt, commandDigest, result: result as Prisma.JsonValue }) } };
		const f = _Repository(transaction);
		const command = { caller: _CALLER, routineId: receipt.routineId, expectedLifecycleRevision: 4, idempotencyKey: "run-now-1", firingId: "unused-firing", conversationId: "unused-conversation", commandReceiptId: "unused-receipt", commandDigest };

		await expect(f.repository.runNow(command)).rejects.toThrow("routine firing receipt result is invalid");
	});

	it("records the original requester as the manual firing audit actor", async function _ManualActor()
	{
		const transaction = {
			agentRoutineFiring: { create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) },
			agentRoutineCommandReceipt: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
		};
		const f = _Repository(transaction);

		await f.repository.runNow({ caller: _CALLER, routineId: "routine-1", expectedLifecycleRevision: 4, idempotencyKey: "run-now-1", firingId: "firing-manual", conversationId: "conversation-manual", commandReceiptId: "receipt-run-now", commandDigest: `sha256:${"f".repeat(64)}` });
		expect(f.facts.admitFiringActions).toHaveBeenCalledWith(expect.any(Object), { actorKind: "user", actorId: "principal-1" }, _NOW, expect.objectContaining({ routineId: "routine-1" }));
	});
});
