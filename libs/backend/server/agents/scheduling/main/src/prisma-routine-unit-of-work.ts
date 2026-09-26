import { Prisma, type PrismaClient } from "@prisma/client";

import { ___DoWithTrace } from "@opencrane/backend/observability";
import type { RoutineComputerActivationReceipt, RoutineFiringIdentity, RoutineOccurrencePreparationReceipt } from "@opencrane/backend/server/agents/scheduling/contract";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import type { AutomaticRoutineFiringCommand, EncryptedRoutineProjection, ReadRoutineCommand, RoutineCommandResult, RoutineFiringResult } from "./routine-authority.types";
import { PrismaRoutineCommandRepository } from "./prisma-routine-command-repository";
import { PrismaRoutineFactsRepository } from "./routine-prisma-facts";
import { PrismaRoutineFiringRepository } from "./prisma-routine-firing-repository";
import type { ChangeRoutineStatusPersistenceCommand, CreateRoutinePersistenceCommand, ReviseRoutinePersistenceCommand, RoutineCommandPersistence, RunRoutineNowPersistenceCommand } from "./routine-persistence.types";
import type { PrismaRoutineUnitOfWorkDependencies } from "./routine-unit-of-work.types";
import type { RoutineScheduleRepairPage, RoutineScheduleRepairPageResult } from "./routine-schedule-repair.types";
import { RoutineOccurrenceStage, type RoutineFiringProgressCommand, type RoutineOccurrencePreparationInput, type RoutineWorkflowPersistence } from "./routine-workflow.types";

/** Opens one serializable, bounded-retry transaction for every routine authority operation. */
export class PrismaRoutineUnitOfWork implements RoutineCommandPersistence, RoutineWorkflowPersistence
{
	/** Root client used only by the shared transaction runner. */
	private readonly prisma: PrismaClient;
	/** Factories and task port that bind all work to each transaction callback. */
	private readonly dependencies: PrismaRoutineUnitOfWorkDependencies;

	/** Stores the root database client and transaction-bound factories. */
	constructor(prisma: PrismaClient, dependencies: PrismaRoutineUnitOfWorkDependencies)
	{
		this.prisma = prisma;
		this.dependencies = dependencies;
	}

	/** @inheritdoc */
	async create(command: CreateRoutinePersistenceCommand): Promise<RoutineCommandResult>
	{
		return await this._RunCommand("routine.create", { siloId: command.caller.siloId, routineId: command.routineId }, async function _Create(repository) { return await repository.create(command); });
	}

	/** @inheritdoc */
	async read(command: ReadRoutineCommand): Promise<EncryptedRoutineProjection | null>
	{
		return await this._RunCommand("routine.read", { siloId: command.caller.siloId, routineId: command.routineId }, async function _Read(repository) { return await repository.read(command); });
	}

	/** @inheritdoc */
	async revise(command: ReviseRoutinePersistenceCommand): Promise<RoutineCommandResult>
	{
		return await this._RunCommand("routine.revise", { siloId: command.caller.siloId, routineId: command.routineId }, async function _Revise(repository) { return await repository.revise(command); });
	}

	/** @inheritdoc */
	async changeStatus(command: ChangeRoutineStatusPersistenceCommand): Promise<RoutineCommandResult>
	{
		return await this._RunCommand("routine.change_status", { siloId: command.caller.siloId, routineId: command.routineId, event: command.event }, async function _ChangeStatus(repository) { return await repository.changeStatus(command); });
	}

	/** @inheritdoc */
	async runNow(command: RunRoutineNowPersistenceCommand): Promise<RoutineFiringResult>
	{
		return await this._RunCommand("routine.run_now", { siloId: command.caller.siloId, routineId: command.routineId, firingId: command.firingId }, async function _RunNow(repository) { return await repository.runNow(command); });
	}

	/** @inheritdoc */
	async repairActiveSchedulesPage(page: RoutineScheduleRepairPage): Promise<RoutineScheduleRepairPageResult>
	{
		return await this._RunFiring("routine.schedule_repair", { siloId: page.siloId, limit: page.limit, afterRoutineId: page.afterRoutineId }, async function _Repair(repository) { return await repository.repairActiveSchedulesPage(page); });
	}

	/** @inheritdoc */
	async fireAutomatic(command: AutomaticRoutineFiringCommand): Promise<RoutineFiringResult | null>
	{
		return await this._RunFiring("routine.fire_automatic", { siloId: command.siloId, routineId: command.routineId, routineRevision: command.routineRevision, firingId: command.firingId }, async function _FireAutomatic(repository) { return await repository.fireAutomatic(command); });
	}

	/** @inheritdoc */
	async authorizeOccurrenceStage(identity: RoutineFiringIdentity, stage: RoutineOccurrenceStage): Promise<RoutineOccurrencePreparationInput | null>
	{
		return await this._RunFiring("routine.occurrence_authorize", { ..._IdentityFields(identity), stage }, async function _AuthorizeOccurrence(repository) { return await repository.authorizeOccurrenceStage(identity, stage); });
	}

	/** @inheritdoc */
	async recordPreparation(identity: RoutineFiringIdentity, receipt: RoutineOccurrencePreparationReceipt): Promise<RoutineOccurrencePreparationReceipt>
	{
		return await this._RunFiring("routine.preparation_record", _IdentityFields(identity), async function _RecordPreparation(repository) { return await repository.recordPreparation(identity, receipt); });
	}

	/** @inheritdoc */
	async recordActivation(identity: RoutineFiringIdentity, receipt: RoutineComputerActivationReceipt): Promise<RoutineComputerActivationReceipt>
	{
		return await this._RunFiring("routine.activation_record", _IdentityFields(identity), async function _RecordActivation(repository) { return await repository.recordActivation(identity, receipt); });
	}

	/** @inheritdoc */
	async bindAdmittedRun(identity: RoutineFiringIdentity, runId: string): Promise<void>
	{
		await this._RunFiring("routine.run_bind", { ..._IdentityFields(identity), runId }, async function _BindRun(repository) { await repository.bindAdmittedRun(identity, runId); });
	}

	/** @inheritdoc */
	async recordRunProgress(command: RoutineFiringProgressCommand): Promise<void>
	{
		await this._RunFiring("routine.run_progress", { siloId: command.siloId, routineId: command.routineId, routineRevision: command.routineRevision, firingId: command.firingId, runId: command.runId, disposition: command.disposition }, async function _RecordProgress(repository) { await repository.recordRunProgress(command); });
	}

	/** Opens one traced transaction and gives the operation a transaction-bound command repository. */
	private _RunCommand<Result>(operationName: string, fields: Record<string, unknown>, operation: (repository: PrismaRoutineCommandRepository) => Promise<Result>): Promise<Result>
	{
		const self = this;
		const prisma = this.prisma;
		return ___DoWithTrace(operationName, fields, async function _Trace()
		{
			return await ___RunInPrismaUnitOfWork(prisma, async function _Transaction(transaction)
			{
				const authorization = self.dependencies.authorization(transaction);
				const facts = new PrismaRoutineFactsRepository(transaction, authorization);
				const grants = self.dependencies.managedGrants(transaction);
				const repository = new PrismaRoutineCommandRepository(transaction, facts, grants, self.dependencies.taskAdmission);
				return await operation(repository);
			}, { operation: operationName, isolationLevel: Prisma.TransactionIsolationLevel.Serializable, attemptLimit: 3 });
		});
	}

	/** Opens one traced transaction and gives the operation a transaction-bound firing repository. */
	private _RunFiring<Result>(operationName: string, fields: Record<string, unknown>, operation: (repository: PrismaRoutineFiringRepository) => Promise<Result>): Promise<Result>
	{
		const self = this;
		const prisma = this.prisma;
		return ___DoWithTrace(operationName, fields, async function _Trace()
		{
			return await ___RunInPrismaUnitOfWork(prisma, async function _Transaction(transaction)
			{
				const authorization = self.dependencies.authorization(transaction);
				const facts = new PrismaRoutineFactsRepository(transaction, authorization);
				const repository = new PrismaRoutineFiringRepository(transaction, facts, self.dependencies.taskAdmission);
				return await operation(repository);
			}, { operation: operationName, isolationLevel: Prisma.TransactionIsolationLevel.Serializable, attemptLimit: 3 });
		});
	}
}

/** Selects only safe immutable occurrence coordinates for trace fields. */
function _IdentityFields(identity: RoutineFiringIdentity): Record<string, unknown>
{
	return { siloId: identity.siloId, routineId: identity.routineId, routineRevision: identity.routineRevision, firingId: identity.firingId };
}
