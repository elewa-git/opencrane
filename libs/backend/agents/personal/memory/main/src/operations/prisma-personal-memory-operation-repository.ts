import { AuthorizationBoundaryKind, MemoryConsentState, MemoryDatasetState, MemoryFactState, type PersonalMemoryOperation as PrismaOperationRow, type Prisma } from "@prisma/client";

import { _PersonalMemoryFactCreateData } from "./personal-memory-fact-catalog";
import { __CreatePersonalMemoryOperationLifecycle, __PlanPersonalMemoryOperationLifecycle } from "./personal-memory-operation-lifecycle";
import { ___AdmitPersonalMemoryOperationCommandSchema, ___PersonalMemoryOperationReplayLookupSchema, ___PersonalMemoryOperationTaskIdentitySchema } from "./personal-memory-operation-persistence.validator";
import { PersonalMemoryOperationAdmissionOutcomes, PersonalMemoryOperationInvalidState, PersonalMemoryOperationPersistenceOutcomes, PersonalMemoryOperationReplayConflict, type AdmitPersonalMemoryOperationCommand, type PersonalMemoryOperationAdmissionResult, type PersonalMemoryOperationMessageSource, type PersonalMemoryOperationPersistenceResult, type PersonalMemoryOperationRecord, type PersonalMemoryOperationRepository, type PersonalMemoryOperationTaskAdmission } from "./personal-memory-operation-persistence.types";
import { _PersonalMemoryOperationCreateData, _PersonalMemoryOperationLifecycle, _PersonalMemoryOperationLifecycleUpdate, _PersonalMemoryOperationRecord } from "./prisma-personal-memory-operation-mapper";
import { PersonalMemoryOperationEvents, PersonalMemoryOperationKinds, PersonalMemoryOperationTransitionOutcomes, type PersonalMemoryOperationEvent } from "./personal-memory-operation.types";

/** Uses one caller-owned Prisma transaction for replay, locking, validation, and revision CAS. */
export class PrismaPersonalMemoryOperationRepository implements PersonalMemoryOperationRepository
{
	/** Transaction supplied by the operation unit of work. */
	private readonly transaction: Prisma.TransactionClient;

	/** Binds every read and write to the transaction that the unit of work opened. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** @inheritdoc */
	async findByReplayKey(siloId: string, idempotencyKeyDigest: string): Promise<PersonalMemoryOperationRecord | null>
	{
		const lookup = ___PersonalMemoryOperationReplayLookupSchema.safeParse({ siloId, idempotencyKeyDigest });
		if (!lookup.success)
			throw new PersonalMemoryOperationInvalidState("personal-memory operation replay lookup is invalid");
		const row = await this.transaction.personalMemoryOperation.findUnique({ where: { siloId_idempotencyKeyDigest: lookup.data } });
		return row === null ? null : _PersonalMemoryOperationRecord(row);
	}

	/** @inheritdoc */
	async admit(commandInput: AdmitPersonalMemoryOperationCommand, admitTask: PersonalMemoryOperationTaskAdmission): Promise<PersonalMemoryOperationAdmissionResult>
	{
		const parsed = ___AdmitPersonalMemoryOperationCommandSchema.safeParse(commandInput);
		if (!parsed.success)
			throw new PersonalMemoryOperationInvalidState("personal-memory operation admission evidence is invalid");
		const command = parsed.data;
		const lifecycle = __CreatePersonalMemoryOperationLifecycle({ operationId: command.operationId, kind: command.kind, expectedContentDigest: command.contentDigest, targetFactId: command.targetFactId, targetDocumentId: command.targetDocumentId, providerDatasetId: command.providerDatasetId });
		if (lifecycle === null)
			throw new PersonalMemoryOperationInvalidState("personal-memory operation lifecycle could not be created");

		// Lock the dataset before any referenced fact or operation row so all writers wait in one order.
		const dataset = await this._lockDataset(command.datasetId, command.siloId);
		const existing = await this.transaction.personalMemoryOperation.findUnique({ where: { siloId_idempotencyKeyDigest: { siloId: command.siloId, idempotencyKeyDigest: command.idempotencyKeyDigest } } });
		const lockedTargetFactId = existing?.targetFactId ?? command.targetFactId;
		const lockedTargetDocumentId = existing?.targetDocumentId ?? command.targetDocumentId;
		const facts = await this._lockFacts(command.datasetId, lockedTargetFactId === null ? [] : [lockedTargetFactId], lockedTargetDocumentId);
		if (existing !== null)
		{
			const locked = await this._lockOperation(existing);
			if (!this._isExactReplay(locked, command))
				throw new PersonalMemoryOperationReplayConflict();
			return { outcome: PersonalMemoryOperationAdmissionOutcomes.Replayed, operation: locked };
		}
		this._assertAdmissionDataset(dataset, command);
		if (facts.some(fact => fact.revision !== command.expectedFactRevision))
			throw new PersonalMemoryOperationInvalidState("personal-memory target fact revision changed before admission");
		if (command.kind === PersonalMemoryOperationKinds.Forget)
			await this._hideForgottenTarget(facts, command);

		// Admit the task only after replay is ruled out, while the caller still owns every domain lock.
		const taskResult = ___PersonalMemoryOperationTaskIdentitySchema.safeParse(await admitTask(command.task));
		if (!taskResult.success || taskResult.data.taskName !== command.task.taskName || taskResult.data.taskKey !== command.task.taskKey)
			throw new PersonalMemoryOperationInvalidState("personal-memory workflow receipt does not match the admitted command");
		const created = await this.transaction.personalMemoryOperation.create({ data: _PersonalMemoryOperationCreateData(command, lifecycle, taskResult.data) });
		return { outcome: PersonalMemoryOperationAdmissionOutcomes.Created, operation: _PersonalMemoryOperationRecord(created) };
	}

	/** @inheritdoc */
	async apply(event: PersonalMemoryOperationEvent, recordedAt: Date): Promise<PersonalMemoryOperationPersistenceResult>
	{
		if (Number.isNaN(recordedAt.getTime()))
			throw new PersonalMemoryOperationInvalidState("personal-memory operation event time is invalid");
		const initialRow = await this.transaction.personalMemoryOperation.findUnique({ where: { id: event.operationId } });
		if (initialRow === null)
			throw new PersonalMemoryOperationInvalidState("personal-memory operation does not exist");
		const initial = _PersonalMemoryOperationRecord(initialRow);

		// Read coordinates first, then take the dataset, sorted fact, and operation locks in that order.
		const dataset = await this._lockDataset(initial.datasetId, initial.siloId);
		await this._lockFacts(initial.datasetId, initial.targetFactId === null ? [] : [initial.targetFactId], initial.targetDocumentId);
		const operation = await this._lockOperation(initialRow);
		if (operation.revision !== initial.revision)
			return { outcome: PersonalMemoryOperationPersistenceOutcomes.ConcurrentWinner, operation };

		const planned = __PlanPersonalMemoryOperationLifecycle(_PersonalMemoryOperationLifecycle(operation), event);
		if (planned.outcome === PersonalMemoryOperationTransitionOutcomes.Denied)
			return { outcome: PersonalMemoryOperationPersistenceOutcomes.Denied, operation, reason: planned.reason };
		if (planned.outcome === PersonalMemoryOperationTransitionOutcomes.Retry)
			return { outcome: PersonalMemoryOperationPersistenceOutcomes.Retry, operation };
		if (planned.operation === undefined)
			throw new PersonalMemoryOperationInvalidState("personal-memory lifecycle accepted an event without next state");
		const adoptedDataset = await this._adoptDatasetForEvent(dataset, operation, event);
		const changedCatalog = await this._applyCatalogEvent(operation, event, recordedAt);

		const update = await this.transaction.personalMemoryOperation.updateMany({
			where: { id: operation.operationId, revision: operation.revision },
			data: _PersonalMemoryOperationLifecycleUpdate(planned.operation, recordedAt),
		});
		const saved = await this.transaction.personalMemoryOperation.findUnique({ where: { id: operation.operationId } });
		if (saved === null)
			throw new PersonalMemoryOperationInvalidState("personal-memory operation disappeared during lifecycle update");
		const durable = _PersonalMemoryOperationRecord(saved);
		if (update.count === 0)
		{
			if (adoptedDataset || changedCatalog)
				throw new PersonalMemoryOperationInvalidState("a dependent personal-memory write lost the matching operation revision");
			return { outcome: PersonalMemoryOperationPersistenceOutcomes.ConcurrentWinner, operation: durable };
		}
		return { outcome: PersonalMemoryOperationPersistenceOutcomes.Advanced, operation: durable };
	}

	/** Locks and verifies the local dataset through an ORM update that does not change its state. */
	private async _lockDataset(datasetId: string, siloId: string): Promise<{ readonly id: string; readonly siloId: string; readonly boundaryKind: AuthorizationBoundaryKind; readonly boundaryPrincipalId: string | null; readonly cogneeDatasetId: string | null; readonly state: MemoryDatasetState }>
	{
		const dataset = await this.transaction.memoryDataset.findFirst({ where: { id: datasetId, siloId }, select: { id: true, siloId: true, boundaryKind: true, boundaryPrincipalId: true, cogneeDatasetId: true, state: true } });
		if (dataset === null)
			throw new PersonalMemoryOperationInvalidState("personal-memory dataset does not exist in the operation silo");
		const locked = await this.transaction.memoryDataset.updateMany({ where: { id: dataset.id, siloId, state: dataset.state }, data: { state: dataset.state } });
		if (locked.count !== 1)
			throw new PersonalMemoryOperationInvalidState("personal-memory dataset changed before it could be locked");
		return dataset;
	}

	/** Verifies whether a new or existing dataset matches the admitted command and personal owner. */
	private _assertAdmissionDataset(dataset: { readonly boundaryKind: AuthorizationBoundaryKind; readonly boundaryPrincipalId: string | null; readonly cogneeDatasetId: string | null; readonly state: MemoryDatasetState }, command: AdmitPersonalMemoryOperationCommand): void
	{
		if (dataset.boundaryKind !== AuthorizationBoundaryKind.Personal || dataset.boundaryPrincipalId !== command.actorPrincipalId)
			throw new PersonalMemoryOperationInvalidState("personal-memory dataset does not belong to the authenticated actor");
		if (command.kind === PersonalMemoryOperationKinds.Remember && command.providerDatasetId === null)
		{
			if (dataset.state !== MemoryDatasetState.Provisioning || dataset.cogneeDatasetId !== null)
				throw new PersonalMemoryOperationInvalidState("new personal-memory dataset is not waiting for provider adoption");
			return;
		}
		if (dataset.state !== MemoryDatasetState.Active || dataset.cogneeDatasetId !== command.providerDatasetId)
			throw new PersonalMemoryOperationInvalidState("personal-memory command does not match an active adopted dataset");
	}

	/** Adopts the provider UUID before the matching operation transition, within the same transaction. */
	private async _adoptDatasetForEvent(dataset: { readonly id: string; readonly siloId: string; readonly boundaryKind: AuthorizationBoundaryKind; readonly boundaryPrincipalId: string | null; readonly cogneeDatasetId: string | null; readonly state: MemoryDatasetState }, operation: PersonalMemoryOperationRecord, event: PersonalMemoryOperationEvent): Promise<boolean>
	{
		if (event.event !== PersonalMemoryOperationEvents.DatasetEnsured)
			return false;
		if (dataset.boundaryKind !== AuthorizationBoundaryKind.Personal || dataset.boundaryPrincipalId !== operation.actorPrincipalId)
			throw new PersonalMemoryOperationInvalidState("personal-memory dataset adoption lost its personal owner");
		if (dataset.state === MemoryDatasetState.Active)
		{
			if (dataset.cogneeDatasetId !== event.providerDatasetId)
				throw new PersonalMemoryOperationInvalidState("active personal-memory dataset has another provider UUID");
			return false;
		}
		if (dataset.state !== MemoryDatasetState.Provisioning || dataset.cogneeDatasetId !== null)
			throw new PersonalMemoryOperationInvalidState("personal-memory dataset cannot adopt a provider UUID in its current state");
		const adopted = await this.transaction.memoryDataset.updateMany({
			where: { id: dataset.id, siloId: dataset.siloId, boundaryKind: AuthorizationBoundaryKind.Personal, boundaryPrincipalId: operation.actorPrincipalId, state: MemoryDatasetState.Provisioning, cogneeDatasetId: null },
			data: { state: MemoryDatasetState.Active, cogneeDatasetId: event.providerDatasetId },
		});
		if (adopted.count !== 1)
			throw new PersonalMemoryOperationInvalidState("personal-memory dataset provider adoption lost its state fence");
		return true;
	}

	/** Applies exact catalog evidence only after the lifecycle planner accepts the event. */
	private async _applyCatalogEvent(operation: PersonalMemoryOperationRecord, event: PersonalMemoryOperationEvent, recordedAt: Date): Promise<boolean>
	{
		if (event.event === PersonalMemoryOperationEvents.CatalogCommitted)
		{
			const data = _PersonalMemoryFactCreateData(operation, recordedAt);
			if (data === null)
				throw new PersonalMemoryOperationInvalidState("personal-memory catalog commit lacks immutable fact evidence");
			await this.transaction.memoryFactCatalog.create({ data: { ...data, state: MemoryFactState.Active, consentState: MemoryConsentState.Explicit } });
			return true;
		}
		if (event.event !== PersonalMemoryOperationEvents.CatalogFinalized)
			return false;
		if (operation.kind !== PersonalMemoryOperationKinds.Forget || operation.targetFactId === null || operation.targetDocumentId === null || operation.expectedFactRevision === null)
			throw new PersonalMemoryOperationInvalidState("personal-memory catalog finalization lacks immutable target evidence");
		const finalized = await this.transaction.memoryFactCatalog.updateMany({
			where: { id: operation.targetFactId, datasetId: operation.datasetId, cogneeExternalId: operation.targetDocumentId, state: MemoryFactState.ForgetPending, revision: operation.expectedFactRevision + 1 },
			data: { state: MemoryFactState.Forgotten, forgottenAt: recordedAt },
		});
		if (finalized.count !== 1)
			throw new PersonalMemoryOperationInvalidState("personal-memory Forget target lost its finalization fence");
		return true;
	}

	/** Locks referenced facts by sorted ID and verifies the target provider document coordinate. */
	private async _lockFacts(datasetId: string, factIds: readonly string[], targetDocumentId: string | null): Promise<readonly { readonly id: string; readonly revision: number; readonly state: MemoryFactState }[]>
	{
		const ordered = [...new Set(factIds)].sort();
		const lockedFacts: { readonly id: string; readonly revision: number; readonly state: MemoryFactState }[] = [];
		for (const factId of ordered)
		{
			const fact = await this.transaction.memoryFactCatalog.findFirst({ where: { id: factId, datasetId }, select: { id: true, cogneeExternalId: true, revision: true, state: true } });
			if (fact === null || (targetDocumentId !== null && fact.cogneeExternalId !== targetDocumentId))
				throw new PersonalMemoryOperationInvalidState("personal-memory target fact does not match the admitted dataset and document");
			const locked = await this.transaction.memoryFactCatalog.updateMany({ where: { id: fact.id, datasetId, state: fact.state }, data: { state: fact.state } });
			if (locked.count !== 1)
				throw new PersonalMemoryOperationInvalidState("personal-memory target fact changed before it could be locked");
			lockedFacts.push({ id: fact.id, revision: fact.revision, state: fact.state });
		}
		return lockedFacts;
	}

	/** Hides a new Forget target in the same transaction that saves its operation. */
	private async _hideForgottenTarget(facts: readonly { readonly id: string; readonly revision: number; readonly state: MemoryFactState }[], command: AdmitPersonalMemoryOperationCommand): Promise<void>
	{
		const target = facts[0];
		if (target === undefined || (target.state !== MemoryFactState.Active && target.state !== MemoryFactState.Corrected) || target.revision !== command.expectedFactRevision)
			throw new PersonalMemoryOperationInvalidState("personal-memory Forget target is not Active or Corrected at the expected revision");
		const hidden = await this.transaction.memoryFactCatalog.updateMany({
			where: { id: target.id, datasetId: command.datasetId, state: target.state, revision: command.expectedFactRevision! },
			data: { state: MemoryFactState.ForgetPending, forgetRequestedAt: command.admittedAt },
		});
		if (hidden.count !== 1)
			throw new PersonalMemoryOperationInvalidState("personal-memory Forget target lost its admission fence");
	}

	/** Locks the operation after its dataset and facts, then returns the reread validated state. */
	private async _lockOperation(row: PrismaOperationRow): Promise<PersonalMemoryOperationRecord>
	{
		await this.transaction.personalMemoryOperation.updateMany({ where: { id: row.id, revision: row.revision }, data: { phase: row.phase } });
		const locked = await this.transaction.personalMemoryOperation.findUnique({ where: { id: row.id } });
		if (locked === null)
			throw new PersonalMemoryOperationInvalidState("personal-memory operation disappeared while acquiring its lock");
		return _PersonalMemoryOperationRecord(locked);
	}

	/** Compares immutable user-command evidence without requiring retry-generated identities to match. */
	private _isExactReplay(operation: PersonalMemoryOperationRecord, command: AdmitPersonalMemoryOperationCommand): boolean
	{
		return operation.siloId === command.siloId
			&& operation.datasetId === command.datasetId
			&& operation.actorPrincipalId === command.actorPrincipalId
			&& operation.idempotencyKeyDigest === command.idempotencyKeyDigest
			&& operation.commandDigest === command.commandDigest
			&& operation.kind === command.kind
			&& operation.expectedContentDigest === command.contentDigest
			&& operation.targetFactId === command.targetFactId
			&& operation.targetDocumentId === command.targetDocumentId
			&& operation.expectedFactRevision === command.expectedFactRevision
			&& operation.admittedProviderDatasetId === command.providerDatasetId
			&& operation.task.taskName === command.task.taskName
			&& operation.task.taskKey === command.task.taskKey
			&& this._sameSource(operation.source, command.source);
	}

	/** Compares exact source coordinates while treating two absent sources as equal. */
	private _sameSource(left: PersonalMemoryOperationMessageSource | null, right: PersonalMemoryOperationMessageSource | null): boolean
	{
		if (left === null || right === null)
			return left === right;
		return left.conversationId === right.conversationId
			&& left.messageId === right.messageId
			&& left.messagePosition === right.messagePosition
			&& left.payloadRef === right.payloadRef
			&& left.ciphertextDigest === right.ciphertextDigest
			&& left.authorPrincipalId === right.authorPrincipalId;
	}
}
