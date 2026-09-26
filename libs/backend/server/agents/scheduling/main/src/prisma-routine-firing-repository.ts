import { AgentRoutineFiringDisposition, AgentRoutineStatus, Prisma } from "@prisma/client";

import { ___ParseRoutineComputerActivationReceipt, ___ParseRoutineOccurrencePreparationReceipt, type RoutineComputerActivationReceipt, type RoutineFiringIdentity, type RoutineOccurrenceCommand, type RoutineOccurrencePreparationReceipt } from "@opencrane/backend/server/agents/scheduling/contract";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import { RoutineFiringDisposition, RoutineFiringTrigger, RoutineStatus, __PlanRoutineFiring, __RoutineFiringAuditActor } from "@opencrane/models/agents";

import { RoutineCommandOutcome, type AutomaticRoutineFiringCommand, type RoutineFiringResult } from "./routine-authority.types";
import type { CurrentRoutineRows, RoutineFactsRepository, RoutineFiringActor } from "./routine-prisma-facts.types";
import { _MODEL_FIRING_DISPOSITION, _MODEL_FIRING_TRIGGER, _PRISMA_FIRING_DISPOSITION, _PRISMA_FIRING_TRIGGER } from "./routine-prisma-mapping";
import { ROUTINE_SCHEDULE_TASK_NAME } from "./routine-workflow-contract";
import { RoutineOccurrenceStage, type RoutineOccurrencePreparationInput, type RoutineOccurrenceTaskInput, type RoutineScheduleTaskInput, type RoutineTaskAdmissionPort, type RoutineWorkflowPersistence } from "./routine-workflow.types";
import type { RoutineScheduleRepairPage, RoutineScheduleRepairPageResult } from "./routine-schedule-repair.types";

/** Selects the firing facts required by preparation, activation, and run binding. */
const _FIRING_SELECT = {
	id: true,
	siloId: true,
	routineId: true,
	routineRevision: true,
	trigger: true,
	scheduledSlot: true,
	requesterPrincipalId: true,
	conversationId: true,
	runId: true,
	disposition: true,
	workflowTaskId: true,
	workflowTaskName: true,
	workflowTaskKey: true,
	preparationReceipt: true,
	activationReceipt: true,
	routine: { select: { destinationConversationId: true, selectedManagedServiceId: true, originalRequesterPrincipalId: true, requesterIssuer: true, requesterSubjectId: true, requesterAuthenticatedAt: true } },
	revision: { select: { instructionKeyId: true, instructionNonce: true, instructionAuthTag: true, instructionCiphertext: true, instructionCiphertextDigest: true, audiencePrincipalIds: true } },
} as const satisfies Prisma.AgentRoutineFiringSelect;

/** Exact firing projection used by every stage-boundary authority check. */
type RoutineFiringStageRow = Prisma.AgentRoutineFiringGetPayload<{ readonly select: typeof _FIRING_SELECT }>;

/** Applies automatic selection and occurrence admission through one transaction. */
export class PrismaRoutineFiringRepository implements RoutineWorkflowPersistence
{
	/** Caller-owned transaction shared with authorization and task admission. */
	private readonly transaction: Prisma.TransactionClient;
	/** Current fact loader bound to the same transaction. */
	private readonly facts: RoutineFactsRepository;
	/** Workflow engine whose spawn operation adopts the caller's transaction. */
	private readonly taskAdmission: RoutineTaskAdmissionPort<Prisma.TransactionClient>;

	/** Stores every transaction-bound collaborator. */
	constructor(transaction: Prisma.TransactionClient, facts: RoutineFactsRepository, taskAdmission: RoutineTaskAdmissionPort<Prisma.TransactionClient>)
	{
		this.transaction = transaction;
		this.facts = facts;
		this.taskAdmission = taskAdmission;
	}

	/** @inheritdoc */
	async repairActiveSchedulesPage(page: RoutineScheduleRepairPage): Promise<RoutineScheduleRepairPageResult>
	{
		if (page.siloId.trim().length === 0 || !Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 100 || page.afterRoutineId !== null && page.afterRoutineId.trim().length === 0)
		{
			throw new Error("routine schedule repair page requires a valid silo, limit and cursor");
		}
		const routines = await this.transaction.agentRoutine.findMany({ where: { siloId: page.siloId, status: AgentRoutineStatus.Active, nextAutomaticOccurrence: { not: null }, scheduleTaskName: ROUTINE_SCHEDULE_TASK_NAME, scheduleTaskKey: { not: null }, ...(page.afterRoutineId === null ? {} : { id: { gt: page.afterRoutineId } }) }, select: { id: true, siloId: true, currentRevision: true, nextAutomaticOccurrence: true }, orderBy: { id: "asc" }, take: page.limit });
		for (const routine of routines)
		{
			if (routine.nextAutomaticOccurrence === null)
			{
				throw new Error("active routine schedule repair found an incomplete cursor");
			}
			const receipt = await this._spawnSchedule(routine.siloId, routine.id, routine.currentRevision, routine.nextAutomaticOccurrence.getTime());
			await this.transaction.agentRoutine.update({ where: { id: routine.id }, data: { scheduleTaskId: receipt.taskId, scheduleTaskName: receipt.taskName, scheduleTaskKey: receipt.idempotencyKey } });
		}
		return { checked: routines.length, nextCursor: routines.length === page.limit ? routines[routines.length - 1]!.id : null };
	}

	/** @inheritdoc */
	async fireAutomatic(command: AutomaticRoutineFiringCommand): Promise<RoutineFiringResult | null>
	{
		const current = await this.facts.current(command.siloId, command.routineId);
		const routine = current?.routine;
		if (current === null || current === undefined || routine === undefined)
		{
			return null;
		}
		if (routine.currentRevision !== command.routineRevision || !_TaskMatches(routine.scheduleTaskId, routine.scheduleTaskName, routine.scheduleTaskKey, command.scheduleTask))
		{
			return null;
		}
		const now = await this.facts.databaseNow();
		const unfinished = await this.facts.unfinishedFiring(routine.id);
		const plan = __PlanRoutineFiring({ siloId: routine.siloId, routineId: routine.id, status: this.facts.modelStatus(routine), trigger: RoutineFiringTrigger.Automatic, schedule: { expression: current.revision.scheduleExpression, timezone: current.revision.scheduleTimezone }, nowEpochMs: now.getTime(), automaticEnabledAfterEpochMs: routine.automaticEnabledAfter.getTime(), lastAutomaticOccurrenceEpochMs: routine.lastAutomaticOccurrence?.getTime() ?? null, unfinishedFiringDisposition: unfinished?.disposition ?? null });
		if (plan.disposition === null)
		{
			if (plan.nextAutomaticOccurrenceEpochMs !== undefined && this.facts.modelStatus(routine) === RoutineStatus.Active)
			{
				await this._rotateScheduleTask(current, command.scheduleTask, null, plan.nextAutomaticOccurrenceEpochMs, now);
			}
			return null;
		}
		if (plan.trigger !== RoutineFiringTrigger.Automatic || plan.scheduledForEpochMs === undefined || plan.advanceAutomaticCursorToEpochMs === undefined || plan.nextAutomaticOccurrenceEpochMs === undefined)
		{
			throw new Error("routine automatic planner returned an invalid plan");
		}
		let disposition: RoutineFiringDisposition = plan.disposition;
		let refusalReason: string | null = null;
		const actor = __RoutineFiringAuditActor(RoutineFiringTrigger.Automatic, routine.originalRequesterPrincipalId);
		if (disposition === RoutineFiringDisposition.Preparing && !(await this._canPrepareFiring(current, actor, now, plan.firingKey)))
		{
			disposition = RoutineFiringDisposition.Refused;
			refusalReason = "current_authority_or_audience_refused";
		}
		await this.transaction.agentRoutineFiring.create({ data: {
			id: command.firingId,
			siloId: routine.siloId,
			routineId: routine.id,
			routineRevision: routine.currentRevision,
			trigger: _PRISMA_FIRING_TRIGGER[RoutineFiringTrigger.Automatic],
			scheduledSlot: new Date(plan.scheduledForEpochMs),
			requesterPrincipalId: routine.originalRequesterPrincipalId,
			conversationId: command.conversationId,
			disposition: _PRISMA_FIRING_DISPOSITION[disposition],
			firingKey: plan.firingKey,
			refusalReason,
			overlapFiringId: disposition === RoutineFiringDisposition.SkippedOverlap ? unfinished?.id ?? null : null,
			createdAt: now,
			updatedAt: now,
			finishedAt: disposition === RoutineFiringDisposition.Preparing ? null : now,
		} });
		await this._rotateScheduleTask(current, command.scheduleTask, new Date(plan.advanceAutomaticCursorToEpochMs), plan.nextAutomaticOccurrenceEpochMs, now);
		if (disposition === RoutineFiringDisposition.Preparing)
		{
			const task = await this._spawnOccurrence(routine.siloId, routine.id, routine.currentRevision, command.firingId);
			await this.transaction.agentRoutineFiring.update({ where: { id: command.firingId }, data: { workflowTaskId: task.taskId, workflowTaskName: task.taskName, workflowTaskKey: task.idempotencyKey } });
		}
		return _OccurrenceResult(command.firingId, routine.id, routine.currentRevision, disposition, command.conversationId, new Date(plan.scheduledForEpochMs), refusalReason ?? (disposition === RoutineFiringDisposition.SkippedOverlap ? "unfinished_firing" : null));
	}

	/** @inheritdoc */
	async authorizeOccurrenceStage(identity: RoutineFiringIdentity, stage: RoutineOccurrenceStage): Promise<RoutineOccurrencePreparationInput | null>
	{
		const firing = await this.transaction.agentRoutineFiring.findFirst({ where: { id: identity.firingId, siloId: identity.siloId, routineId: identity.routineId, routineRevision: identity.routineRevision }, select: _FIRING_SELECT });
		if (firing === null || !_TaskMatches(firing.workflowTaskId, firing.workflowTaskName, firing.workflowTaskKey, identity.task))
		{
			throw new Error("routine occurrence stage does not match its saved task fence");
		}
		if (firing.runId !== null && (firing.disposition === AgentRoutineFiringDisposition.Preparing || firing.disposition === AgentRoutineFiringDisposition.Running))
		{
			return _OccurrenceInput(identity, firing);
		}
		if (firing.disposition === AgentRoutineFiringDisposition.Refused)
		{
			return null;
		}
		if (firing.disposition !== AgentRoutineFiringDisposition.Preparing)
		{
			throw new Error("routine occurrence stage requires a preparing unadmitted firing");
		}
		if (!(await this._authorizeCurrentStage(identity, firing, stage)))
		{
			return null;
		}
		return _OccurrenceInput(identity, firing);
	}

	/** @inheritdoc */
	async recordPreparation(identity: RoutineFiringIdentity, receipt: RoutineOccurrencePreparationReceipt): Promise<RoutineOccurrencePreparationReceipt>
	{
		const firing = await this._fencedFiring(identity);
		if (firing.preparationReceipt !== null)
		{
			return ___ParseRoutineOccurrencePreparationReceipt(firing.preparationReceipt);
		}
		const savedReceipt = ___ParseRoutineOccurrencePreparationReceipt(receipt);
		const changed = await this.transaction.agentRoutineFiring.updateMany({ where: { id: identity.firingId, siloId: identity.siloId, routineId: identity.routineId, routineRevision: identity.routineRevision, disposition: AgentRoutineFiringDisposition.Preparing, preparationReceipt: { equals: Prisma.DbNull } }, data: { preparationReceipt: savedReceipt as unknown as Prisma.InputJsonValue } });
		if (changed.count !== 1)
		{
			throw new Error("routine preparation receipt compare-and-set conflict");
		}
		return savedReceipt;
	}

	/** @inheritdoc */
	async recordActivation(identity: RoutineFiringIdentity, receipt: RoutineComputerActivationReceipt): Promise<RoutineComputerActivationReceipt>
	{
		const firing = await this._fencedFiring(identity);
		if (firing.preparationReceipt === null)
		{
			throw new Error("routine activation requires a saved preparation receipt");
		}
		___ParseRoutineOccurrencePreparationReceipt(firing.preparationReceipt);
		if (firing.activationReceipt !== null)
		{
			return ___ParseRoutineComputerActivationReceipt(firing.activationReceipt);
		}
		const savedReceipt = ___ParseRoutineComputerActivationReceipt(receipt);
		const changed = await this.transaction.agentRoutineFiring.updateMany({ where: { id: identity.firingId, siloId: identity.siloId, routineId: identity.routineId, routineRevision: identity.routineRevision, disposition: AgentRoutineFiringDisposition.Preparing, activationReceipt: { equals: Prisma.DbNull } }, data: { activationReceipt: savedReceipt as unknown as Prisma.InputJsonValue } });
		if (changed.count !== 1)
		{
			throw new Error("routine activation receipt compare-and-set conflict");
		}
		return savedReceipt;
	}

	/** @inheritdoc */
	async bindAdmittedRun(identity: RoutineFiringIdentity, runId: string): Promise<void>
	{
		const firing = await this._fencedFiring(identity);
		if (firing.runId !== runId)
		{
			throw new Error("routine run admission did not save the exact firing backlink");
		}
		if (firing.preparationReceipt === null || firing.activationReceipt === null)
		{
			throw new Error("routine firing is not ready to bind its admitted run");
		}
		___ParseRoutineOccurrencePreparationReceipt(firing.preparationReceipt);
		___ParseRoutineComputerActivationReceipt(firing.activationReceipt);
		if (firing.disposition === AgentRoutineFiringDisposition.Running)
		{
			return;
		}
		if (firing.disposition !== AgentRoutineFiringDisposition.Preparing)
		{
			throw new Error("routine firing is not ready to bind its admitted run");
		}
		const run = await this.transaction.agentRun.findFirst({ where: { id: runId, siloId: identity.siloId, routineFiringId: identity.firingId, routineId: identity.routineId, routineRevision: identity.routineRevision }, select: { id: true } });
		if (run === null)
		{
			throw new Error("routine admitted run does not match the firing identity");
		}
		const changed = await this.transaction.agentRoutineFiring.updateMany({ where: { id: identity.firingId, siloId: identity.siloId, routineId: identity.routineId, routineRevision: identity.routineRevision, disposition: AgentRoutineFiringDisposition.Preparing, runId }, data: { disposition: AgentRoutineFiringDisposition.Running } });
		if (changed.count !== 1)
		{
			throw new Error("routine admitted run transition lost its compare-and-set");
		}
	}

	/** Loads a firing only when its immutable workflow task receipt still matches. */
	private async _fencedFiring(identity: RoutineFiringIdentity)
	{
		const firing = await this.transaction.agentRoutineFiring.findFirst({ where: { id: identity.firingId, siloId: identity.siloId, routineId: identity.routineId, routineRevision: identity.routineRevision }, select: _FIRING_SELECT });
		if (firing === null || !_TaskMatches(firing.workflowTaskId, firing.workflowTaskName, firing.workflowTaskKey, identity.task))
		{
			throw new Error("routine firing task fence does not match");
		}
		return firing;
	}

	/** Rechecks current lifecycle, audience, service and effects, then durably refuses a denial. */
	private async _authorizeCurrentStage(identity: RoutineFiringIdentity, firing: RoutineFiringStageRow, stage: RoutineOccurrenceStage): Promise<boolean>
	{
		const current = await this.facts.current(identity.siloId, identity.routineId);
		const now = await this.facts.databaseNow();
		const actor = __RoutineFiringAuditActor(_MODEL_FIRING_TRIGGER[firing.trigger], firing.routine.originalRequesterPrincipalId);
		const currentlyAllowed = current !== null && this.facts.modelStatus(current.routine) !== RoutineStatus.Retired
			&& await this.facts.currentAudienceAllowed(current.routine, current.revision, now)
			&& await this.facts.findCurrentManagedAgent(current.routine) !== null
			&& await this.facts.admitFiringActions(current.routine, actor, now, { firingId: identity.firingId, routineRevision: identity.routineRevision, stage });
		if (currentlyAllowed)
		{
			return true;
		}
		const changed = await this.transaction.agentRoutineFiring.updateMany({ where: { id: identity.firingId, siloId: identity.siloId, routineId: identity.routineId, routineRevision: identity.routineRevision, disposition: AgentRoutineFiringDisposition.Preparing, runId: null }, data: { disposition: AgentRoutineFiringDisposition.Refused, refusalReason: `stage_${stage}_current_authority_refused`, finishedAt: now, updatedAt: now } });
		if (changed.count !== 1)
		{
			throw new Error("routine occurrence stage refusal lost its compare-and-set");
		}
		return false;
	}

	/** Rechecks every current guard and records both effect admissions atomically. */
	private async _canPrepareFiring(current: CurrentRoutineRows, actor: RoutineFiringActor, now: Date, firingKey: string): Promise<boolean>
	{
		if (!(await this.facts.currentAudienceAllowed(current.routine, current.revision, now)) || await this.facts.findCurrentManagedAgent(current.routine) === null)
		{
			return false;
		}
		return await this.facts.admitFiringActions(current.routine, actor, now, { routineId: current.routine.id, routineRevision: current.routine.currentRevision, firingKey });
	}

	/** Advances the cursor and installs the next schedule task under the previous task fence. */
	private async _rotateScheduleTask(current: CurrentRoutineRows, expectedTask: IWorkflowTaskReceipt, consumedSlot: Date | null, nextEpochMs: number, now: Date): Promise<void>
	{
		const changed = await this.transaction.agentRoutine.updateMany({ where: { id: current.routine.id, siloId: current.routine.siloId, status: AgentRoutineStatus.Active, currentRevision: current.routine.currentRevision, scheduleTaskId: expectedTask.taskId, scheduleTaskName: expectedTask.taskName, scheduleTaskKey: expectedTask.idempotencyKey }, data: { lastAutomaticOccurrence: consumedSlot ?? current.routine.lastAutomaticOccurrence, nextAutomaticOccurrence: new Date(nextEpochMs), scheduleTaskId: null, scheduleTaskName: null, scheduleTaskKey: null, updatedAt: now } });
		if (changed.count !== 1)
		{
			throw new Error("routine automatic cursor compare-and-set conflict");
		}
		const task = await this._spawnSchedule(current.routine.siloId, current.routine.id, current.routine.currentRevision, nextEpochMs);
		await this.transaction.agentRoutine.update({ where: { id: current.routine.id }, data: { scheduleTaskId: task.taskId, scheduleTaskName: task.taskName, scheduleTaskKey: task.idempotencyKey } });
	}

	/** Admits or recovers one future schedule task. */
	private async _spawnSchedule(siloId: string, routineId: string, routineRevision: number, slotEpochMs: number): Promise<IWorkflowTaskReceipt>
	{
		const input: RoutineScheduleTaskInput = { siloId, routineId, routineRevision, slotEpochMs };
		return await this.taskAdmission.admitSchedule(this.transaction, input);
	}

	/** Admits or recovers one immutable occurrence task. */
	private async _spawnOccurrence(siloId: string, routineId: string, routineRevision: number, firingId: string): Promise<IWorkflowTaskReceipt>
	{
		const input: RoutineOccurrenceTaskInput = { siloId, firingId, routineId, routineRevision };
		return await this.taskAdmission.admitOccurrence(this.transaction, input);
	}
}

/** Checks a stored task tuple against an engine receipt. */
function _TaskMatches(taskId: string | null, taskName: string | null, taskKey: string | null, expected: IWorkflowTaskReceipt): boolean
{
	return taskId === expected.taskId && taskName === expected.taskName && taskKey === expected.idempotencyKey;
}

/** Builds one automatic occurrence result. */
function _OccurrenceResult(firingId: string, routineId: string, routineRevision: number, disposition: RoutineFiringDisposition, conversationId: string, scheduledSlot: Date, reason: string | null): RoutineFiringResult
{
	return { outcome: disposition === RoutineFiringDisposition.Refused ? RoutineCommandOutcome.Refused : RoutineCommandOutcome.Committed, firingId, routineId, routineRevision, trigger: RoutineFiringTrigger.Automatic, disposition, conversationId, scheduledSlot: scheduledSlot.toISOString(), reason };
}

/** Maps one fenced firing row into the immutable input shared by external stage adapters. */
function _OccurrenceInput(identity: RoutineFiringIdentity, firing: RoutineFiringStageRow): RoutineOccurrencePreparationInput
{
	return {
		..._OccurrenceCommand(identity, firing),
		instruction: { keyId: firing.revision.instructionKeyId, nonce: firing.revision.instructionNonce, authTag: firing.revision.instructionAuthTag, ciphertext: firing.revision.instructionCiphertext, ciphertextDigest: firing.revision.instructionCiphertextDigest as `sha256:${string}` },
	};
}

/** Maps one fenced firing row into its exact content-free occurrence command. */
function _OccurrenceCommand(identity: RoutineFiringIdentity, firing: RoutineFiringStageRow): RoutineOccurrenceCommand
{
	return {
		siloId: identity.siloId,
		firingId: identity.firingId,
		routineId: identity.routineId,
		routineRevision: identity.routineRevision,
		task: identity.task,
		admittedRunId: firing.runId,
		trigger: _MODEL_FIRING_TRIGGER[firing.trigger],
		scheduledSlot: firing.scheduledSlot?.toISOString() ?? null,
		conversationId: firing.conversationId,
		destinationConversationId: firing.routine.destinationConversationId,
		selectedManagedServiceId: firing.routine.selectedManagedServiceId,
		requesterPrincipalId: firing.routine.originalRequesterPrincipalId,
		requesterIssuer: firing.routine.requesterIssuer,
		requesterSubjectId: firing.routine.requesterSubjectId,
		requesterAuthenticatedAt: firing.routine.requesterAuthenticatedAt.toISOString(),
		audiencePrincipalIds: [...firing.revision.audiencePrincipalIds],
	};
}
