import { AgentRoutineFiringDisposition, Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";

import { ___ParseRoutineComputerActivationReceipt, ___ParseRoutineOccurrencePreparationReceipt, type RoutineComputerActivationReceipt, type RoutineOccurrenceActivationAuthorization, type RoutineOccurrenceActivationRepository, type RoutineOccurrenceCommand, type RoutineOccurrencePreparationReceipt } from "@opencrane/backend/server/agents/scheduling/contract";

import { PrismaRoutineFiringRepository } from "./prisma-routine-firing-repository";
import { PrismaRoutineFactsRepository } from "./routine-prisma-facts";
import type { RoutineFactsRepository } from "./routine-prisma-facts.types";
import { _MODEL_FIRING_TRIGGER } from "./routine-prisma-mapping";
import type { PrismaRoutineUnitOfWorkDependencies } from "./routine-unit-of-work.types";
import { RoutineOccurrenceStage, type RoutineWorkflowPersistence } from "./routine-workflow.types";

/** Selects immutable occurrence facts and both stage receipts required by activation. */
const _ACTIVATION_SELECT = {
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
	revision: { select: { audiencePrincipalIds: true } },
} as const satisfies Prisma.AgentRoutineFiringSelect;

/** Exact firing projection checked before computer activation or recovery. */
type RoutineActivationRow = Prisma.AgentRoutineFiringGetPayload<{ readonly select: typeof _ACTIVATION_SELECT }>;

/** Adopts a caller-owned transaction while keeping activation policy inside scheduling. */
export class PrismaRoutineOccurrenceActivationRepository implements RoutineOccurrenceActivationRepository
{
	/** Caller-owned transaction shared with computer activation. */
	private readonly transaction: Prisma.TransactionClient;
	/** Database-clock and current-authority facts bound to the same transaction. */
	private readonly facts: RoutineFactsRepository;
	/** Existing firing authority reused for every fresh activation-stage admission. */
	private readonly workflow: RoutineWorkflowPersistence;

	/** Builds the authority from the exact transaction supplied by computer activation. */
	constructor(transaction: Prisma.TransactionClient, dependencies: Pick<PrismaRoutineUnitOfWorkDependencies, "authorization" | "taskAdmission">)
	{
		this.transaction = transaction;
		const authorization = dependencies.authorization(transaction);
		this.facts = new PrismaRoutineFactsRepository(transaction, authorization);
		this.workflow = new PrismaRoutineFiringRepository(transaction, this.facts, dependencies.taskAdmission);
	}

	/** @inheritdoc */
	async authorize(command: RoutineOccurrenceCommand, preparation: RoutineOccurrencePreparationReceipt): Promise<RoutineOccurrenceActivationAuthorization | null>
	{
		const firing = await this._fenced(command, preparation);
		if (firing.disposition === AgentRoutineFiringDisposition.Refused)
		{
			return null;
		}
		this._requirePreparingUnadmitted(firing);
		if (await this.workflow.authorizeOccurrenceStage(command, RoutineOccurrenceStage.Activation) === null)
		{
			return null;
		}
		const activation = firing.activationReceipt === null ? null : ___ParseRoutineComputerActivationReceipt(firing.activationReceipt);
		return { activation };
	}

	/** @inheritdoc */
	async record(command: RoutineOccurrenceCommand, preparation: RoutineOccurrencePreparationReceipt, receipt: RoutineComputerActivationReceipt): Promise<RoutineComputerActivationReceipt>
	{
		const firing = await this._fenced(command, preparation);
		const candidate = ___ParseRoutineComputerActivationReceipt(receipt);
		this._requirePreparingUnadmitted(firing);
		if (firing.activationReceipt !== null)
		{
			const saved = ___ParseRoutineComputerActivationReceipt(firing.activationReceipt);
			if (!isDeepStrictEqual(saved, candidate))
			{
				throw new Error("routine occurrence activation receipt conflicts with its saved activation");
			}
			return saved;
		}
		const savedPreparation = ___ParseRoutineOccurrencePreparationReceipt(firing.preparationReceipt);
		const changed = await this.transaction.agentRoutineFiring.updateMany({ where: { id: command.firingId, siloId: command.siloId, routineId: command.routineId, routineRevision: command.routineRevision, requesterPrincipalId: command.requesterPrincipalId, workflowTaskId: command.task.taskId, workflowTaskName: command.task.taskName, workflowTaskKey: command.task.idempotencyKey, disposition: AgentRoutineFiringDisposition.Preparing, runId: null, preparationReceipt: { equals: savedPreparation as unknown as Prisma.InputJsonValue }, activationReceipt: { equals: Prisma.DbNull } }, data: { activationReceipt: candidate as unknown as Prisma.InputJsonValue } });
		if (changed.count !== 1)
		{
			throw new Error("routine occurrence activation receipt compare-and-set conflict");
		}
		return candidate;
	}

	/** @inheritdoc */
	async refuse(command: RoutineOccurrenceCommand, preparation: RoutineOccurrencePreparationReceipt): Promise<void>
	{
		const firing = await this._fenced(command, preparation);
		if (firing.disposition === AgentRoutineFiringDisposition.Refused)
		{
			return;
		}
		this._requirePreparingUnadmitted(firing);
		const now = await this.facts.databaseNow();
		const changed = await this.transaction.agentRoutineFiring.updateMany({ where: { id: command.firingId, siloId: command.siloId, routineId: command.routineId, routineRevision: command.routineRevision, requesterPrincipalId: command.requesterPrincipalId, workflowTaskId: command.task.taskId, workflowTaskName: command.task.taskName, workflowTaskKey: command.task.idempotencyKey, disposition: AgentRoutineFiringDisposition.Preparing, runId: null }, data: { disposition: AgentRoutineFiringDisposition.Refused, refusalReason: "activation_current_execution_eligibility_refused", finishedAt: now, updatedAt: now } });
		if (changed.count !== 1)
		{
			throw new Error("routine occurrence activation refusal lost its compare-and-set");
		}
	}

	/** Loads and exactly matches immutable command facts and the saved preparation receipt. */
	private async _fenced(command: RoutineOccurrenceCommand, preparation: RoutineOccurrencePreparationReceipt): Promise<RoutineActivationRow>
	{
		const firing = await this.transaction.agentRoutineFiring.findFirst({ where: { id: command.firingId, siloId: command.siloId, routineId: command.routineId, routineRevision: command.routineRevision }, select: _ACTIVATION_SELECT });
		if (firing === null || !_TaskMatches(firing, command))
		{
			throw new Error("routine occurrence activation does not match its saved task fence");
		}
		if (firing.requesterPrincipalId !== firing.routine.originalRequesterPrincipalId)
		{
			throw new Error("routine occurrence activation requester provenance does not match");
		}
		const persisted = _OccurrenceCommand(command, firing);
		if (command.admittedRunId !== null || firing.runId !== null || !isDeepStrictEqual(command, persisted))
		{
			throw new Error("routine occurrence activation command does not match its saved unadmitted firing");
		}
		if (firing.preparationReceipt === null)
		{
			throw new Error("routine occurrence activation requires a saved preparation receipt");
		}
		const savedPreparation = ___ParseRoutineOccurrencePreparationReceipt(firing.preparationReceipt);
		const candidatePreparation = ___ParseRoutineOccurrencePreparationReceipt(preparation);
		if (!isDeepStrictEqual(savedPreparation, candidatePreparation))
		{
			throw new Error("routine occurrence activation preparation does not match its saved receipt");
		}
		return firing;
	}

	/** Requires the only mutable state in which activation may proceed. */
	private _requirePreparingUnadmitted(firing: RoutineActivationRow): void
	{
		if (firing.disposition !== AgentRoutineFiringDisposition.Preparing || firing.runId !== null)
		{
			throw new Error("routine occurrence activation requires a preparing unadmitted firing");
		}
	}
}

/** Checks the saved workflow task tuple against the caller's exact command. */
function _TaskMatches(firing: RoutineActivationRow, command: RoutineOccurrenceCommand): boolean
{
	return firing.workflowTaskId === command.task.taskId && firing.workflowTaskName === command.task.taskName && firing.workflowTaskKey === command.task.idempotencyKey;
}

/** Maps one saved row into the exact content-free command accepted for activation. */
function _OccurrenceCommand(command: RoutineOccurrenceCommand, firing: RoutineActivationRow): RoutineOccurrenceCommand
{
	return {
		siloId: firing.siloId,
		firingId: firing.id,
		routineId: firing.routineId,
		routineRevision: firing.routineRevision,
		task: command.task,
		admittedRunId: null,
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
