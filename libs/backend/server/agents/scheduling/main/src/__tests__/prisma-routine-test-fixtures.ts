import { AgentRoutineFiringDisposition, AgentRoutineFiringTrigger, AgentRoutineStatus } from "@prisma/client";
import { vi } from "vitest";

import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import type { RoutineFiringIdentity } from "@opencrane/backend/server/agents/scheduling/contract";
import { RoutineStatus } from "@opencrane/models/agents";

import type { RoutineCaller } from "../routine-authority.types";
import type { CurrentRoutineRows, RoutineRevisionRow, RoutineRow } from "../routine-prisma-facts.types";

/** Database time shared by repository fixtures. */
export const _NOW = new Date("2026-09-25T12:30:00.000Z");
/** Last automatic slot already consumed by the default routine. */
export const _LAST_SLOT = new Date("2026-09-25T10:00:00.000Z");
/** Exact requester coordinates retained by every routine. */
export const _CALLER: RoutineCaller = { siloId: "silo-1", principalId: "principal-1", issuer: "https://issuer.example", subjectId: "subject-1", authenticatedAt: "2026-09-20T09:00:00.000Z" };
/** Saved schedule-chain task owned by the default routine. */
export const _SCHEDULE_TASK: IWorkflowTaskReceipt = { taskId: "schedule-task-1", taskName: "routine-schedule", idempotencyKey: "schedule-key-1" };
/** Saved occurrence task used to fence asynchronous progress. */
export const _OCCURRENCE_TASK: IWorkflowTaskReceipt = { taskId: "occurrence-task-1", taskName: "routine-occurrence", idempotencyKey: "occurrence-key-1" };
/** Exact immutable occurrence coordinates. */
export const _IDENTITY: RoutineFiringIdentity = { siloId: "silo-1", firingId: "firing-1", routineId: "routine-1", routineRevision: 2, task: _OCCURRENCE_TASK };
/** Stable encrypted instruction fixture that never contains plaintext. */
export const _INSTRUCTION = { keyId: "key-1", nonce: new Uint8Array([1]), authTag: new Uint8Array([2]), ciphertext: new Uint8Array([3]), ciphertextDigest: `sha256:${"a".repeat(64)}` as const };

/** Builds one selected aggregate row with narrow overrides. */
export function _Routine(overrides: Partial<RoutineRow> = {}): RoutineRow
{
	return {
		id: "routine-1",
		siloId: "silo-1",
		originalRequesterPrincipalId: "principal-1",
		requesterIssuer: _CALLER.issuer,
		requesterSubjectId: _CALLER.subjectId,
		requesterAuthenticatedAt: new Date(_CALLER.authenticatedAt),
		destinationConversationId: "destination-1",
		selectedManagedServiceId: "service-1",
		status: AgentRoutineStatus.Active,
		currentRevision: 2,
		lifecycleRevision: 4,
		automaticEnabledAfter: new Date("2026-09-25T09:00:00.000Z"),
		lastAutomaticOccurrence: _LAST_SLOT,
		nextAutomaticOccurrence: new Date("2026-09-25T11:00:00.000Z"),
		scheduleTaskId: _SCHEDULE_TASK.taskId,
		scheduleTaskName: _SCHEDULE_TASK.taskName,
		scheduleTaskKey: _SCHEDULE_TASK.idempotencyKey,
		...overrides,
	};
}

/** Builds the immutable revision named by the default aggregate. */
export function _Revision(overrides: Partial<RoutineRevisionRow> = {}): RoutineRevisionRow
{
	return {
		id: "revision-2",
		siloId: "silo-1",
		routineId: "routine-1",
		revision: 2,
		scheduleExpression: "0 * * * *",
		scheduleTimezone: "UTC",
		instructionKeyId: _INSTRUCTION.keyId,
		instructionNonce: _INSTRUCTION.nonce,
		instructionAuthTag: _INSTRUCTION.authTag,
		instructionCiphertext: _INSTRUCTION.ciphertext,
		instructionCiphertextDigest: _INSTRUCTION.ciphertextDigest,
		audiencePrincipalIds: ["principal-1", "principal-2"],
		createdByPrincipalId: "principal-1",
		createdAt: new Date("2026-09-24T00:00:00.000Z"),
		...overrides,
	};
}

/** Builds one current aggregate snapshot. */
export function _Current(routine: Partial<RoutineRow> = {}, revision: Partial<RoutineRevisionRow> = {}): CurrentRoutineRows
{
	return { routine: _Routine(routine), revision: _Revision(revision) };
}

/** Supplies narrow transaction facts while preserving inspectable mocks. */
export function _Facts(current: CurrentRoutineRows = _Current())
{
	return {
		databaseNow: vi.fn().mockResolvedValue(_NOW),
		current: vi.fn().mockResolvedValue(current),
		requireOriginalRequester: vi.fn(),
		resolveCreationAudience: vi.fn().mockResolvedValue(current.revision.audiencePrincipalIds),
		requireCurrentAudience: vi.fn().mockResolvedValue(undefined),
		requireCurrentReader: vi.fn().mockResolvedValue(undefined),
		currentAudienceAllowed: vi.fn().mockResolvedValue(true),
		currentManagedAgent: vi.fn().mockResolvedValue({ serviceId: "service-1", revisionId: "service-revision-1", principalId: "service-principal-1" }),
		findCurrentManagedAgent: vi.fn().mockResolvedValue({ serviceId: "service-1", revisionId: "service-revision-1", principalId: "service-principal-1" }),
		currentManagedAgentById: vi.fn().mockResolvedValue({ serviceId: "service-1", revisionId: "service-revision-1", principalId: "service-principal-1" }),
		findCurrentManagedAgentById: vi.fn().mockResolvedValue({ serviceId: "service-1", revisionId: "service-revision-1", principalId: "service-principal-1" }),
		requirePrincipalAction: vi.fn().mockResolvedValue(undefined),
		principalActionAllowed: vi.fn().mockResolvedValue(true),
		admitFiringActions: vi.fn().mockResolvedValue(true),
		unfinishedFiring: vi.fn().mockResolvedValue(null),
		modelStatus: vi.fn(function _Status(row: RoutineRow)
		{
			if (row.status === AgentRoutineStatus.Paused)
				return RoutineStatus.Paused;
			if (row.status === AgentRoutineStatus.Retired)
				return RoutineStatus.Retired;
			return RoutineStatus.Active;
		}),
	};
}

/** Supplies transaction-bound workflow admissions and stable receipts. */
export function _TaskAdmission()
{
	return {
		admitSchedule: vi.fn().mockResolvedValue({ taskId: "schedule-task-next", taskName: "routine-schedule", idempotencyKey: "schedule-key-next" }),
		admitOccurrence: vi.fn().mockResolvedValue(_OCCURRENCE_TASK),
	};
}

/** Builds the selected firing projection expected by stage and receipt methods. */
export function _FiringRow(overrides: Record<string, unknown> = {})
{
	return {
		id: "firing-1",
		siloId: "silo-1",
		routineId: "routine-1",
		routineRevision: 2,
		trigger: AgentRoutineFiringTrigger.Automatic,
		scheduledSlot: new Date("2026-09-25T12:00:00.000Z"),
		requesterPrincipalId: "principal-1",
		conversationId: "occurrence-conversation-1",
		runId: null,
		disposition: AgentRoutineFiringDisposition.Preparing,
		workflowTaskId: _OCCURRENCE_TASK.taskId,
		workflowTaskName: _OCCURRENCE_TASK.taskName,
		workflowTaskKey: _OCCURRENCE_TASK.idempotencyKey,
		preparationReceipt: null,
		activationReceipt: null,
		routine: { destinationConversationId: "destination-1", selectedManagedServiceId: "service-1", originalRequesterPrincipalId: "principal-1", requesterIssuer: _CALLER.issuer, requesterSubjectId: _CALLER.subjectId, requesterAuthenticatedAt: new Date(_CALLER.authenticatedAt) },
		revision: { instructionKeyId: _INSTRUCTION.keyId, instructionNonce: _INSTRUCTION.nonce, instructionAuthTag: _INSTRUCTION.authTag, instructionCiphertext: _INSTRUCTION.ciphertext, instructionCiphertextDigest: _INSTRUCTION.ciphertextDigest, audiencePrincipalIds: ["principal-1", "principal-2"] },
		...overrides,
	};
}
