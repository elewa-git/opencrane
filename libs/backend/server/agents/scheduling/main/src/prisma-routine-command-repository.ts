import { AgentRoutineCommandKind, AgentRoutineFiringTrigger, AgentRoutineStatus, Prisma } from "@prisma/client";

import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import type { ManagedAuthorizationGrantRepository, ManagedAuthorizationGrantRestrictionRepository } from "@opencrane/backend/server/iam/authorization";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { RoutineFiringDisposition, RoutineFiringTrigger, RoutineStatus, __NextRoutineOccurrence, __PlanRoutineFiring, type RoutineSchedule } from "@opencrane/models/agents";

import { _ProjectRoutineGrants, _RetireRoutineGrants } from "./routine-authorization";
import type { ReadRoutineCommand, RoutineCaller } from "./routine-authority.types";
import { RoutineCommandOutcome, type EncryptedRoutineProjection, type RoutineCommandResult, type RoutineFiringResult } from "./routine-authority.types";
import { _ParseRoutineCommandResult, _ParseRoutineFiringResult } from "./routine-authority.validator";
import type { RoutineInstructionEnvelope } from "./routine-instruction.types";
import type { CurrentRoutineRows, RoutineFactsRepository, RoutineFiringActor } from "./routine-prisma-facts.types";
import { _PRISMA_FIRING_DISPOSITION, _PRISMA_ROUTINE_STATUS } from "./routine-prisma-mapping";
import type { ChangeRoutineStatusPersistenceCommand, CreateRoutinePersistenceCommand, ReviseRoutinePersistenceCommand, RoutineCommandPersistence, RunRoutineNowPersistenceCommand } from "./routine-persistence.types";
import { RoutineLifecycleDecisionKind, RoutineLifecycleEvent } from "./routine-lifecycle.types";
import { __DecideRoutineLifecycle } from "./routine-lifecycle";
import type { RoutineOccurrenceTaskInput, RoutineScheduleTaskInput, RoutineTaskAdmissionPort } from "./routine-workflow.types";

/** Applies requester commands through one transaction and its central authority. */
export class PrismaRoutineCommandRepository implements RoutineCommandPersistence
{
	/** Caller-owned transaction shared with authorization, grants, and task admission. */
	private readonly transaction: Prisma.TransactionClient;
	/** Current fact loader bound to the same transaction. */
	private readonly facts: RoutineFactsRepository;
	/** Product-owned exact grant projector bound to the same transaction. */
	private readonly managedGrants: ManagedAuthorizationGrantRepository & ManagedAuthorizationGrantRestrictionRepository;
	/** Workflow engine whose spawn operation adopts the caller's transaction. */
	private readonly taskAdmission: RoutineTaskAdmissionPort<Prisma.TransactionClient>;

	/** Stores every transaction-bound collaborator. */
	constructor(transaction: Prisma.TransactionClient, facts: RoutineFactsRepository, managedGrants: ManagedAuthorizationGrantRepository & ManagedAuthorizationGrantRestrictionRepository, taskAdmission: RoutineTaskAdmissionPort<Prisma.TransactionClient>)
	{
		this.transaction = transaction;
		this.facts = facts;
		this.managedGrants = managedGrants;
		this.taskAdmission = taskAdmission;
	}

	/** @inheritdoc */
	async create(command: CreateRoutinePersistenceCommand): Promise<RoutineCommandResult>
	{
		const now = await this.facts.databaseNow();
		await this.facts.requirePrincipalAction(command.caller.principalId, command.caller.siloId, ProductAuthorizationResourceKinds.RoutineCollection, command.caller.siloId, ProductAuthorizationActions.Create, now, true, { commandDigest: command.commandDigest });
		const existing = await this._commandReceipt(command.caller.siloId, command.caller.principalId, AgentRoutineCommandKind.Create, command.idempotencyKey, command.commandDigest);
		if (existing !== null)
		{
			return _ParseRoutineCommandResult(existing.result, existing);
		}

		const audiencePrincipalIds = await this.facts.resolveCreationAudience(command.caller, command.destinationConversationId, command.audiencePrincipalIds, now);
		const service = await this._requireManagedServiceSelection(command.caller.principalId, command.caller.siloId, command.selectedManagedServiceId, now);
		if (service !== command.selectedManagedServiceId)
		{
			throw new Error("routine selected managed service changed during creation");
		}
		const nextEpochMs = __NextRoutineOccurrence(command.schedule, now.getTime());
		await this.transaction.agentRoutine.create({ data: {
			id: command.routineId,
			siloId: command.caller.siloId,
			originalRequesterPrincipalId: command.caller.principalId,
			requesterIssuer: command.caller.issuer,
			requesterSubjectId: command.caller.subjectId,
			requesterAuthenticatedAt: new Date(command.caller.authenticatedAt),
			destinationConversationId: command.destinationConversationId,
			selectedManagedServiceId: command.selectedManagedServiceId,
			status: AgentRoutineStatus.Active,
			currentRevision: 1,
			lifecycleRevision: 1,
			automaticEnabledAfter: now,
			lastAutomaticOccurrence: null,
			nextAutomaticOccurrence: new Date(nextEpochMs),
			createdAt: now,
			updatedAt: now,
		} });
		await this._createRevision(command.revisionId, command.routineId, command.caller.siloId, 1, command.schedule, command.instruction, audiencePrincipalIds, command.caller.principalId, now);
		await _ProjectRoutineGrants(this.managedGrants, command.caller.siloId, command.routineId, command.caller.principalId, audiencePrincipalIds, now);
		const scheduleTask = await this._spawnSchedule(command.caller.siloId, command.routineId, 1, nextEpochMs);
		await this.transaction.agentRoutine.update({ where: { id: command.routineId }, data: { scheduleTaskId: scheduleTask.taskId, scheduleTaskName: scheduleTask.taskName, scheduleTaskKey: scheduleTask.idempotencyKey } });
		const result = _DefinitionResult(command.routineId, 1, RoutineStatus.Active, 1, new Date(nextEpochMs));
		await this._saveCommandReceipt(command.commandReceiptId, command.caller.siloId, command.routineId, command.caller.principalId, AgentRoutineCommandKind.Create, command.idempotencyKey, command.commandDigest, result, 1, null, now);
		return result;
	}

	/** @inheritdoc */
	async read(command: ReadRoutineCommand): Promise<EncryptedRoutineProjection | null>
	{
		const current = await this.facts.current(command.caller.siloId, command.routineId);
		if (current === null || !current.revision.audiencePrincipalIds.includes(command.caller.principalId))
		{
			return null;
		}
		const now = await this.facts.databaseNow();
		const status = this.facts.modelStatus(current.routine);
		if (status === RoutineStatus.Retired)
		{
			await this.facts.requireCurrentReader(command.caller, current.routine, current.revision, now);
		}
		else
		{
			await this.facts.requireCurrentAudience(current.routine, current.revision, now);
			await this.facts.requirePrincipalAction(command.caller.principalId, command.caller.siloId, ProductAuthorizationResourceKinds.Routine, command.routineId, ProductAuthorizationActions.Read, now, false, {});
		}
		return {
			..._DefinitionResult(current.routine.id, current.routine.currentRevision, status, current.routine.lifecycleRevision, current.routine.nextAutomaticOccurrence),
			destinationConversationId: current.routine.destinationConversationId,
			selectedManagedServiceId: current.routine.selectedManagedServiceId,
			requesterPrincipalId: current.routine.originalRequesterPrincipalId,
			requesterIssuer: current.routine.requesterIssuer,
			requesterSubjectId: current.routine.requesterSubjectId,
			requesterAuthenticatedAt: current.routine.requesterAuthenticatedAt.toISOString(),
			schedule: { expression: current.revision.scheduleExpression, timezone: current.revision.scheduleTimezone },
			audiencePrincipalIds: [...current.revision.audiencePrincipalIds],
			instruction: { keyId: current.revision.instructionKeyId, nonce: current.revision.instructionNonce, authTag: current.revision.instructionAuthTag, ciphertext: current.revision.instructionCiphertext, ciphertextDigest: current.revision.instructionCiphertextDigest as `sha256:${string}` },
		};
	}

	/** @inheritdoc */
	async revise(command: ReviseRoutinePersistenceCommand): Promise<RoutineCommandResult>
	{
		const now = await this.facts.databaseNow();
		const current = await this._requesterRoutine(command.caller, command.routineId);
		await this.facts.requirePrincipalAction(command.caller.principalId, command.caller.siloId, ProductAuthorizationResourceKinds.Routine, command.routineId, ProductAuthorizationActions.Edit, now, true, { commandDigest: command.commandDigest });
		const existing = await this._commandReceipt(command.caller.siloId, command.caller.principalId, AgentRoutineCommandKind.Revise, command.idempotencyKey, command.commandDigest, command.routineId);
		if (existing !== null)
		{
			return _ParseRoutineCommandResult(existing.result, existing);
		}
		if (current.routine.currentRevision !== command.expectedRevision || current.routine.lifecycleRevision !== command.expectedLifecycleRevision)
		{
			throw new Error("routine revision compare-and-set conflict");
		}
		const decision = __DecideRoutineLifecycle(this.facts.modelStatus(current.routine), RoutineLifecycleEvent.Revise);
		if (decision.kind !== RoutineLifecycleDecisionKind.Proceed)
		{
			throw new Error("retired routine cannot be revised");
		}
		await this.facts.requireCurrentAudience(current.routine, current.revision, now);
		const revision = current.routine.currentRevision + 1;
		await this._createRevision(command.revisionId, current.routine.id, current.routine.siloId, revision, command.schedule, command.instruction, current.revision.audiencePrincipalIds, command.caller.principalId, now);
		const active = decision.nextStatus === RoutineStatus.Active;
		const nextEpochMs = active ? __NextRoutineOccurrence(command.schedule, now.getTime()) : null;
		const changed = await this.transaction.agentRoutine.updateMany({
			where: { id: current.routine.id, siloId: current.routine.siloId, currentRevision: command.expectedRevision, lifecycleRevision: command.expectedLifecycleRevision, status: current.routine.status },
			data: { currentRevision: revision, lifecycleRevision: { increment: 1 }, automaticEnabledAfter: now, lastAutomaticOccurrence: null, nextAutomaticOccurrence: nextEpochMs === null ? null : new Date(nextEpochMs), scheduleTaskId: null, scheduleTaskName: null, scheduleTaskKey: null, updatedAt: now },
		});
		if (changed.count !== 1)
		{
			throw new Error("routine revision compare-and-set conflict");
		}
		if (nextEpochMs !== null)
		{
				const task = await this._spawnSchedule(current.routine.siloId, current.routine.id, revision, nextEpochMs);
			await this.transaction.agentRoutine.update({ where: { id: current.routine.id }, data: { scheduleTaskId: task.taskId, scheduleTaskName: task.taskName, scheduleTaskKey: task.idempotencyKey } });
		}
		const result = _DefinitionResult(current.routine.id, revision, decision.nextStatus, current.routine.lifecycleRevision + 1, nextEpochMs === null ? null : new Date(nextEpochMs));
		await this._saveCommandReceipt(command.commandReceiptId, current.routine.siloId, current.routine.id, command.caller.principalId, AgentRoutineCommandKind.Revise, command.idempotencyKey, command.commandDigest, result, revision, null, now);
		return result;
	}

	/** @inheritdoc */
	async changeStatus(command: ChangeRoutineStatusPersistenceCommand): Promise<RoutineCommandResult>
	{
		const now = await this.facts.databaseNow();
		const current = await this._requesterRoutine(command.caller, command.routineId);
		const kind = _CommandKind(command.event);
		const existing = await this._commandReceipt(command.caller.siloId, command.caller.principalId, kind, command.idempotencyKey, command.commandDigest, command.routineId);
		if (existing !== null)
		{
			if (command.event === RoutineLifecycleEvent.Retire)
			{
				await this.facts.requireCurrentReader(command.caller, current.routine, current.revision, now);
				await this.facts.requirePrincipalAction(command.caller.principalId, command.caller.siloId, ProductAuthorizationResourceKinds.RoutineCollection, command.caller.siloId, ProductAuthorizationActions.Create, now, false, {});
			}
			else
			{
				await this.facts.requirePrincipalAction(command.caller.principalId, command.caller.siloId, ProductAuthorizationResourceKinds.Routine, command.routineId, ProductAuthorizationActions.Edit, now, false, {});
			}
			return _ParseRoutineCommandResult(existing.result, existing);
		}
		const action = command.event === RoutineLifecycleEvent.Retire ? ProductAuthorizationActions.Retire : ProductAuthorizationActions.Edit;
		await this.facts.requirePrincipalAction(command.caller.principalId, command.caller.siloId, ProductAuthorizationResourceKinds.Routine, command.routineId, action, now, true, { commandDigest: command.commandDigest });
		if (current.routine.lifecycleRevision !== command.expectedLifecycleRevision)
		{
			throw new Error("routine lifecycle compare-and-set conflict");
		}
		const decision = __DecideRoutineLifecycle(this.facts.modelStatus(current.routine), command.event);
		if (decision.kind === RoutineLifecycleDecisionKind.Refuse)
		{
			throw new Error("routine lifecycle command is refused");
		}
		let lifecycleRevision = current.routine.lifecycleRevision;
		let next: Date | null = current.routine.nextAutomaticOccurrence;
		if (decision.kind === RoutineLifecycleDecisionKind.Proceed)
		{
			lifecycleRevision += 1;
			const resume = command.event === RoutineLifecycleEvent.Resume;
			const nextEpochMs = resume ? __NextRoutineOccurrence({ expression: current.revision.scheduleExpression, timezone: current.revision.scheduleTimezone }, now.getTime()) : null;
			next = nextEpochMs === null ? null : new Date(nextEpochMs);
			const automaticEnabledAfter = resume ? now : current.routine.automaticEnabledAfter;
			const lastAutomaticOccurrence = resume ? null : current.routine.lastAutomaticOccurrence;
			const changed = await this.transaction.agentRoutine.updateMany({ where: { id: current.routine.id, siloId: current.routine.siloId, lifecycleRevision: command.expectedLifecycleRevision, status: current.routine.status }, data: { status: _PRISMA_ROUTINE_STATUS[decision.nextStatus], lifecycleRevision: { increment: 1 }, automaticEnabledAfter, lastAutomaticOccurrence, nextAutomaticOccurrence: next, scheduleTaskId: null, scheduleTaskName: null, scheduleTaskKey: null, updatedAt: now } });
			if (changed.count !== 1)
			{
				throw new Error("routine lifecycle compare-and-set conflict");
			}
			if (resume && nextEpochMs !== null)
			{
				const task = await this._spawnSchedule(current.routine.siloId, current.routine.id, current.routine.currentRevision, nextEpochMs);
				await this.transaction.agentRoutine.update({ where: { id: current.routine.id }, data: { scheduleTaskId: task.taskId, scheduleTaskName: task.taskName, scheduleTaskKey: task.idempotencyKey } });
			}
			if (command.event === RoutineLifecycleEvent.Retire)
			{
				await _RetireRoutineGrants(this.managedGrants, current.routine.siloId, current.routine.id, current.routine.originalRequesterPrincipalId, current.revision.audiencePrincipalIds, now);
			}
		}
		const result = _DefinitionResult(current.routine.id, current.routine.currentRevision, decision.nextStatus, lifecycleRevision, next);
		await this._saveCommandReceipt(command.commandReceiptId, current.routine.siloId, current.routine.id, command.caller.principalId, kind, command.idempotencyKey, command.commandDigest, result, current.routine.currentRevision, null, now);
		return result;
	}

	/** @inheritdoc */
	async runNow(command: RunRoutineNowPersistenceCommand): Promise<RoutineFiringResult>
	{
		const now = await this.facts.databaseNow();
		const current = await this._requesterRoutine(command.caller, command.routineId);
		const status = this.facts.modelStatus(current.routine);
		if (status === RoutineStatus.Retired)
		{
			await this.facts.requireCurrentReader(command.caller, current.routine, current.revision, now);
		}
		else
		{
			await this.facts.requirePrincipalAction(command.caller.principalId, command.caller.siloId, ProductAuthorizationResourceKinds.Routine, command.routineId, ProductAuthorizationActions.Read, now, false, {});
		}
		const existing = await this._commandReceipt(command.caller.siloId, command.caller.principalId, AgentRoutineCommandKind.RunNow, command.idempotencyKey, command.commandDigest, command.routineId);
		if (existing !== null)
		{
			return _ParseRoutineFiringResult(existing.result, existing);
		}
		if (current.routine.lifecycleRevision !== command.expectedLifecycleRevision)
		{
			throw new Error("routine manual firing compare-and-set conflict");
		}
		const plan = __PlanRoutineFiring({ siloId: current.routine.siloId, routineId: current.routine.id, status, trigger: RoutineFiringTrigger.Manual, schedule: { expression: current.revision.scheduleExpression, timezone: current.revision.scheduleTimezone }, nowEpochMs: now.getTime(), automaticEnabledAfterEpochMs: current.routine.automaticEnabledAfter.getTime(), lastAutomaticOccurrenceEpochMs: current.routine.lastAutomaticOccurrence?.getTime() ?? null, unfinishedFiringDisposition: null, manualRequestId: command.idempotencyKey });
		if (plan.disposition === null || plan.trigger !== RoutineFiringTrigger.Manual)
		{
			throw new Error("routine manual planner returned an invalid plan");
		}
		let disposition = plan.disposition;
		let reason = disposition === RoutineFiringDisposition.Refused ? "routine_retired" : null;
		if (disposition === RoutineFiringDisposition.Preparing)
		{
			const actor: RoutineFiringActor = { actorKind: "user", actorId: current.routine.originalRequesterPrincipalId };
			const allowed = await this._canPrepareFiring(current, actor, now, command.commandDigest);
			if (!allowed)
			{
				disposition = RoutineFiringDisposition.Refused;
				reason = "current_authority_or_audience_refused";
			}
		}
		await this.transaction.agentRoutineFiring.create({ data: { id: command.firingId, siloId: current.routine.siloId, routineId: current.routine.id, routineRevision: current.routine.currentRevision, trigger: AgentRoutineFiringTrigger.Manual, scheduledSlot: null, requesterPrincipalId: current.routine.originalRequesterPrincipalId, conversationId: command.conversationId, disposition: _PRISMA_FIRING_DISPOSITION[disposition], firingKey: plan.firingKey, refusalReason: reason, createdAt: now, updatedAt: now, finishedAt: disposition === RoutineFiringDisposition.Refused ? now : null } });
		if (disposition === RoutineFiringDisposition.Preparing)
		{
			const task = await this._spawnOccurrence(current.routine.siloId, current.routine.id, current.routine.currentRevision, command.firingId);
			await this.transaction.agentRoutineFiring.update({ where: { id: command.firingId }, data: { workflowTaskId: task.taskId, workflowTaskName: task.taskName, workflowTaskKey: task.idempotencyKey } });
		}
		const result = _OccurrenceResult(command.firingId, current.routine.id, current.routine.currentRevision, RoutineFiringTrigger.Manual, disposition, command.conversationId, null, reason);
		await this._saveCommandReceipt(command.commandReceiptId, current.routine.siloId, current.routine.id, command.caller.principalId, AgentRoutineCommandKind.RunNow, command.idempotencyKey, command.commandDigest, result, current.routine.currentRevision, command.firingId, now);
		return result;
	}

	/** Loads one requester-owned current routine. */
	private async _requesterRoutine(caller: RoutineCaller, routineId: string): Promise<CurrentRoutineRows>
	{
		const current = await this.facts.current(caller.siloId, routineId);
		if (current === null)
		{
			throw new Error("routine is unavailable");
		}
		this.facts.requireOriginalRequester(caller, current.routine);
		return current;
	}

	/** Checks current managed-agent invocation eligibility without recording an effect. */
	private async _requireManagedServiceSelection(principalId: string, siloId: string, serviceId: string, now: Date): Promise<string>
	{
		await this.facts.currentManagedAgentById(siloId, serviceId);
		await this.facts.requirePrincipalAction(principalId, siloId, ProductAuthorizationResourceKinds.AgentService, serviceId, ProductAuthorizationActions.Invoke, now, false, {});
		return serviceId;
	}

	/** Rechecks all current firing guards and records both Routine Use and AgentService Invoke. */
	private async _canPrepareFiring(current: CurrentRoutineRows, actor: RoutineFiringActor, now: Date, commandDigest: string): Promise<boolean>
	{
		if (!(await this.facts.currentAudienceAllowed(current.routine, current.revision, now)) || await this.facts.findCurrentManagedAgent(current.routine) === null)
		{
			return false;
		}
		return await this.facts.admitFiringActions(current.routine, actor, now, { routineId: current.routine.id, commandDigest });
	}

	/** Creates one immutable encrypted routine revision. */
	private async _createRevision(id: string, routineId: string, siloId: string, revision: number, schedule: RoutineSchedule, instruction: RoutineInstructionEnvelope, audiencePrincipalIds: readonly string[], createdByPrincipalId: string, now: Date): Promise<void>
	{
		await this.transaction.agentRoutineRevision.create({ data: { id, siloId, routineId, revision, scheduleExpression: schedule.expression, scheduleTimezone: schedule.timezone, instructionKeyId: instruction.keyId, instructionNonce: instruction.nonce, instructionAuthTag: instruction.authTag, instructionCiphertext: instruction.ciphertext, instructionCiphertextDigest: instruction.ciphertextDigest, audiencePrincipalIds: [...audiencePrincipalIds], createdByPrincipalId, createdAt: now } });
	}

	/** Admits or recovers the next schedule task through this product transaction. */
	private async _spawnSchedule(siloId: string, routineId: string, routineRevision: number, slotEpochMs: number): Promise<IWorkflowTaskReceipt>
	{
		const input: RoutineScheduleTaskInput = { siloId, routineId, routineRevision, slotEpochMs };
		return await this.taskAdmission.admitSchedule(this.transaction, input);
	}

	/** Admits or recovers one occurrence task through this product transaction. */
	private async _spawnOccurrence(siloId: string, routineId: string, routineRevision: number, firingId: string): Promise<IWorkflowTaskReceipt>
	{
		const input: RoutineOccurrenceTaskInput = { siloId, firingId, routineId, routineRevision };
		return await this.taskAdmission.admitOccurrence(this.transaction, input);
	}

	/** Loads a command receipt and rejects a key reused for different normalized arguments. */
	private async _commandReceipt(siloId: string, requesterPrincipalId: string, kind: AgentRoutineCommandKind, idempotencyKey: string, commandDigest: string, expectedRoutineId?: string)
	{
		const receipt = await this.transaction.agentRoutineCommandReceipt.findUnique({ where: { siloId_requesterPrincipalId_kind_idempotencyKey: { siloId, requesterPrincipalId, kind, idempotencyKey } }, select: { routineId: true, commandDigest: true, result: true, routineRevision: true, firingId: true } });
		if (receipt !== null && receipt.commandDigest !== commandDigest)
		{
			throw new Error("routine idempotency key conflicts with an earlier command");
		}
		if (receipt !== null && expectedRoutineId !== undefined && receipt.routineId !== expectedRoutineId)
		{
			throw new Error("routine command receipt belongs to another routine");
		}
		return receipt;
	}

	/** Saves the first command result for exact replay. */
	private async _saveCommandReceipt(id: string, siloId: string, routineId: string, requesterPrincipalId: string, kind: AgentRoutineCommandKind, idempotencyKey: string, commandDigest: string, result: RoutineCommandResult | RoutineFiringResult, routineRevision: number | null, firingId: string | null, now: Date): Promise<void>
	{
		await this.transaction.agentRoutineCommandReceipt.create({ data: { id, siloId, routineId, requesterPrincipalId, kind, idempotencyKey, commandDigest, result: result as unknown as Prisma.InputJsonValue, routineRevision, firingId, createdAt: now } });
	}
}

/** Maps pause, resume, and retire events to their persisted command receipt kind. */
function _CommandKind(event: RoutineLifecycleEvent): AgentRoutineCommandKind
{
	if (event === RoutineLifecycleEvent.Pause)
		return AgentRoutineCommandKind.Pause;
	if (event === RoutineLifecycleEvent.Resume)
		return AgentRoutineCommandKind.Resume;
	if (event === RoutineLifecycleEvent.Retire)
		return AgentRoutineCommandKind.Retire;
	throw new Error("routine status command requires pause, resume, or retire");
}

/** Builds one definition result that is safe to persist as JSON. */
function _DefinitionResult(routineId: string, currentRevision: number, status: RoutineStatus, lifecycleRevision: number, next: Date | null): RoutineCommandResult
{
	return { outcome: RoutineCommandOutcome.Committed, routineId, currentRevision, status, lifecycleRevision, nextAutomaticOccurrence: next?.toISOString() ?? null };
}

/** Builds one occurrence result that is safe to persist as JSON. */
function _OccurrenceResult(firingId: string, routineId: string, routineRevision: number, trigger: RoutineFiringTrigger, disposition: RoutineFiringDisposition, conversationId: string, scheduledSlot: Date | null, reason: string | null): RoutineFiringResult
{
	return { outcome: disposition === RoutineFiringDisposition.Refused ? RoutineCommandOutcome.Refused : RoutineCommandOutcome.Committed, firingId, routineId, routineRevision, trigger, disposition, conversationId, scheduledSlot: scheduledSlot?.toISOString() ?? null, reason };
}
