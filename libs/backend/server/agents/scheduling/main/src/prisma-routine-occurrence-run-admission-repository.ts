import { isDeepStrictEqual } from "node:util";

import { AgentRoutineFiringDisposition, type Prisma } from "@prisma/client";

import { ___ParseRoutineComputerActivationReceipt, ___ParseRoutineOccurrencePreparationReceipt, type RoutineOccurrenceRunAdmissionRepository, type RoutineRunAdmissionInput } from "@opencrane/backend/server/agents/scheduling/contract";

import { PrismaRoutineFiringRepository } from "./prisma-routine-firing-repository";
import { PrismaRoutineFactsRepository } from "./routine-prisma-facts";
import type { PrismaRoutineUnitOfWorkDependencies } from "./routine-unit-of-work.types";
import { RoutineOccurrenceStage, type RoutineWorkflowPersistence } from "./routine-workflow.types";

/**
 * Adopts the root-run owner's transaction for the final scheduling check and possible refusal.
 * AgentRun and its firing backlink remain owned by run admission.
 */
export class PrismaRoutineOccurrenceRunAdmissionRepository implements RoutineOccurrenceRunAdmissionRepository
{
	/** Uses the same transaction for current facts and the final scheduling check. */
	private readonly facts: PrismaRoutineFactsRepository;
	/** Reuses the existing stage authority instead of recreating its policy. */
	private readonly workflow: RoutineWorkflowPersistence;
	/** Transaction supplied by root-run admission, never a process-wide database client. */
	private readonly transaction: Prisma.TransactionClient;

	/** Adopts the run owner's transaction for every read and possible refusal. */
	public constructor(transaction: Prisma.TransactionClient, dependencies: Pick<PrismaRoutineUnitOfWorkDependencies, "authorization" | "taskAdmission">)
	{
		this.transaction = transaction;
		this.facts = new PrismaRoutineFactsRepository(transaction, dependencies.authorization(transaction));
		this.workflow = new PrismaRoutineFiringRepository(transaction, this.facts, dependencies.taskAdmission);
	}

	/** @inheritdoc */
	public async authorize(command: RoutineRunAdmissionInput): Promise<boolean>
	{
		const saved = await this.workflow.authorizeOccurrenceStage(command, RoutineOccurrenceStage.RunAdmission);
		if (saved === null)
			return false;
		const { instruction, ...facts } = saved;
		const { preparation, activation, ...expected } = command;
		if (facts.admittedRunId !== null || expected.admittedRunId !== null || !isDeepStrictEqual(facts, expected))
			throw new Error("Routine run admission differs from its saved unadmitted firing");
		const row = await this._receipts(command);
		if (row === null || row.disposition !== AgentRoutineFiringDisposition.Preparing || row.runId !== null)
			throw new Error("Routine run admission requires a preparing firing without a run");
		return true;
	}

	/** @inheritdoc */
	public async recover(command: RoutineRunAdmissionInput, runId: string): Promise<boolean>
	{
		const row = await this._receipts(command);
		return row !== null && row.runId === runId;
	}

	/** @inheritdoc */
	public async refuse(command: RoutineRunAdmissionInput): Promise<boolean>
	{
		const row = await this._receipts(command);
		if (row === null)
			throw new Error("Routine run refusal requires its saved firing");
		if (row.runId !== null)
			return false;
		if (row.disposition === AgentRoutineFiringDisposition.Refused)
			return true;
		if (row.disposition !== AgentRoutineFiringDisposition.Preparing)
			throw new Error("Routine run refusal requires a preparing firing");
		const now = await this.facts.databaseNow();
		const changed = await this.transaction.agentRoutineFiring.updateMany({ where: { id: command.firingId, siloId: command.siloId, routineId: command.routineId, routineRevision: command.routineRevision, requesterPrincipalId: command.requesterPrincipalId, workflowTaskId: command.task.taskId, workflowTaskName: command.task.taskName, workflowTaskKey: command.task.idempotencyKey, disposition: AgentRoutineFiringDisposition.Preparing, runId: null }, data: { disposition: AgentRoutineFiringDisposition.Refused, refusalReason: "run_admission_current_authority_refused", finishedAt: now, updatedAt: now } });
		if (changed.count !== 1)
			throw new Error("Routine run refusal lost its preparing firing");
		return true;
	}

	/** Rejects receipt substitution before accepting a stage check or persisting refusal. */
	private async _receipts(command: RoutineRunAdmissionInput)
	{
		const row = await this.transaction.agentRoutineFiring.findFirst({ where: { id: command.firingId, siloId: command.siloId, routineId: command.routineId, routineRevision: command.routineRevision, requesterPrincipalId: command.requesterPrincipalId, conversationId: command.conversationId, workflowTaskId: command.task.taskId, workflowTaskName: command.task.taskName, workflowTaskKey: command.task.idempotencyKey }, select: { disposition: true, runId: true, preparationReceipt: true, activationReceipt: true } });
		if (row !== null && (!isDeepStrictEqual(___ParseRoutineOccurrencePreparationReceipt(row.preparationReceipt), ___ParseRoutineOccurrencePreparationReceipt(command.preparation)) || !isDeepStrictEqual(___ParseRoutineComputerActivationReceipt(row.activationReceipt), ___ParseRoutineComputerActivationReceipt(command.activation))))
			throw new Error("Routine run admission receipts differ from saved stage evidence");
		return row;
	}
}
