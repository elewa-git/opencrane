import { AgentRoutineFiringDisposition, Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";

import { ___ParseRoutineOccurrencePreparationReceipt, type RoutineOccurrenceCommand, type RoutineOccurrencePreparationAuthorization, type RoutineOccurrencePreparationReceipt, type RoutineOccurrencePreparationRepository } from "@opencrane/backend/server/agents/scheduling/contract";

import { PrismaRoutineFiringRepository } from "./prisma-routine-firing-repository";
import { PrismaRoutineFactsRepository } from "./routine-prisma-facts";
import type { RoutineFactsRepository } from "./routine-prisma-facts.types";
import { _MODEL_FIRING_TRIGGER } from "./routine-prisma-mapping";
import type { PrismaRoutineUnitOfWorkDependencies } from "./routine-unit-of-work.types";
import { RoutineOccurrenceStage, type RoutineWorkflowPersistence } from "./routine-workflow.types";

/** Selects immutable occurrence facts and the publication marker owned by preparation. */
const _PREPARATION_SELECT = {
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
	routine: { select: { destinationConversationId: true, selectedManagedServiceId: true, originalRequesterPrincipalId: true, requesterIssuer: true, requesterSubjectId: true, requesterAuthenticatedAt: true } },
	revision: { select: { audiencePrincipalIds: true } },
} as const satisfies Prisma.AgentRoutineFiringSelect;

/** Exact firing projection checked before occurrence-history publication. */
type RoutinePreparationRow = Prisma.AgentRoutineFiringGetPayload<{ readonly select: typeof _PREPARATION_SELECT }>;

/** Adopts a caller-owned transaction while keeping preparation policy inside scheduling. */
export class PrismaRoutineOccurrencePreparationRepository implements RoutineOccurrencePreparationRepository
{
	/** Caller-owned transaction shared with conversation publication. */
	private readonly transaction: Prisma.TransactionClient;
	/** Database-clock and current-authority facts bound to the same transaction. */
	private readonly facts: RoutineFactsRepository;
	/** Existing firing authority reused for the fresh preparation-stage admission. */
	private readonly workflow: RoutineWorkflowPersistence;

	/** Builds the authority from the exact transaction supplied by conversation publication. */
	constructor(transaction: Prisma.TransactionClient, dependencies: Pick<PrismaRoutineUnitOfWorkDependencies, "authorization" | "taskAdmission">)
	{
		this.transaction = transaction;
		const authorization = dependencies.authorization(transaction);
		this.facts = new PrismaRoutineFactsRepository(transaction, authorization);
		this.workflow = new PrismaRoutineFiringRepository(transaction, this.facts, dependencies.taskAdmission);
	}

	/** @inheritdoc */
	async authorize(command: RoutineOccurrenceCommand): Promise<RoutineOccurrencePreparationAuthorization | null>
	{
		const firing = await this._fenced(command);
		if (firing.preparationReceipt !== null)
		{
			return { preparation: ___ParseRoutineOccurrencePreparationReceipt(firing.preparationReceipt) };
		}
		if (firing.disposition === AgentRoutineFiringDisposition.Refused)
		{
			return null;
		}
		if (firing.disposition !== AgentRoutineFiringDisposition.Preparing || firing.runId !== null)
		{
			throw new Error("routine occurrence preparation requires a preparing unadmitted firing");
		}
		if (await this.workflow.authorizeOccurrenceStage(command, RoutineOccurrenceStage.Preparation) === null)
		{
			return null;
		}
		return { preparation: null };
	}

	/** @inheritdoc */
	async record(command: RoutineOccurrenceCommand, receipt: RoutineOccurrencePreparationReceipt): Promise<RoutineOccurrencePreparationReceipt>
	{
		const firing = await this._fenced(command);
		const candidate = ___ParseRoutineOccurrencePreparationReceipt(receipt);
		if (firing.preparationReceipt !== null)
		{
			const saved = ___ParseRoutineOccurrencePreparationReceipt(firing.preparationReceipt);
			if (!isDeepStrictEqual(saved, candidate))
			{
				throw new Error("routine occurrence preparation receipt conflicts with its saved publication");
			}
			return saved;
		}
		if (firing.disposition !== AgentRoutineFiringDisposition.Preparing || firing.runId !== null)
		{
			throw new Error("routine occurrence preparation requires a preparing unadmitted firing");
		}
		const changed = await this.transaction.agentRoutineFiring.updateMany({ where: { id: command.firingId, siloId: command.siloId, routineId: command.routineId, routineRevision: command.routineRevision, requesterPrincipalId: command.requesterPrincipalId, workflowTaskId: command.task.taskId, workflowTaskName: command.task.taskName, workflowTaskKey: command.task.idempotencyKey, disposition: AgentRoutineFiringDisposition.Preparing, runId: null, preparationReceipt: { equals: Prisma.DbNull } }, data: { preparationReceipt: candidate as unknown as Prisma.InputJsonValue } });
		if (changed.count !== 1)
		{
			throw new Error("routine occurrence preparation receipt compare-and-set conflict");
		}
		return candidate;
	}

	/** @inheritdoc */
	async refuse(command: RoutineOccurrenceCommand): Promise<void>
	{
		const firing = await this._fenced(command);
		if (firing.disposition === AgentRoutineFiringDisposition.Refused)
		{
			return;
		}
		if (firing.preparationReceipt !== null || firing.disposition !== AgentRoutineFiringDisposition.Preparing || firing.runId !== null)
		{
			throw new Error("routine occurrence preparation refusal requires a fresh unadmitted firing");
		}
		const now = await this.facts.databaseNow();
		const changed = await this.transaction.agentRoutineFiring.updateMany({ where: { id: command.firingId, siloId: command.siloId, routineId: command.routineId, routineRevision: command.routineRevision, requesterPrincipalId: command.requesterPrincipalId, workflowTaskId: command.task.taskId, workflowTaskName: command.task.taskName, workflowTaskKey: command.task.idempotencyKey, disposition: AgentRoutineFiringDisposition.Preparing, runId: null, preparationReceipt: { equals: Prisma.DbNull } }, data: { disposition: AgentRoutineFiringDisposition.Refused, refusalReason: "preparation_current_execution_eligibility_refused", finishedAt: now, updatedAt: now } });
		if (changed.count !== 1)
		{
			throw new Error("routine occurrence preparation refusal lost its compare-and-set");
		}
	}

	/** Loads and exactly matches immutable command facts while ignoring only the later run backlink. */
	private async _fenced(command: RoutineOccurrenceCommand): Promise<RoutinePreparationRow>
	{
		const firing = await this.transaction.agentRoutineFiring.findFirst({ where: { id: command.firingId, siloId: command.siloId, routineId: command.routineId, routineRevision: command.routineRevision }, select: _PREPARATION_SELECT });
		if (firing === null || !_TaskMatches(firing, command))
		{
			throw new Error("routine occurrence preparation does not match its saved task fence");
		}
		if (firing.requesterPrincipalId !== firing.routine.originalRequesterPrincipalId)
		{
			throw new Error("routine occurrence preparation requester provenance does not match");
		}
		const persisted = _OccurrenceCommand(command, firing);
		if (command.admittedRunId !== null || !isDeepStrictEqual(command, persisted))
		{
			throw new Error("routine occurrence preparation command does not match its saved firing");
		}
		return firing;
	}
}

/** Checks the saved workflow task tuple against the caller's exact command. */
function _TaskMatches(firing: RoutinePreparationRow, command: RoutineOccurrenceCommand): boolean
{
	return firing.workflowTaskId === command.task.taskId && firing.workflowTaskName === command.task.taskName && firing.workflowTaskKey === command.task.idempotencyKey;
}

/** Maps one saved row into the exact content-free command accepted for publication. */
function _OccurrenceCommand(command: RoutineOccurrenceCommand, firing: RoutinePreparationRow): RoutineOccurrenceCommand
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
