import { randomUUID } from "node:crypto";

import { AuthorizationBoundaryKind, MemoryConsentState, MemoryDatasetState, MemoryFactState, PersonalMemoryOperationPhase as PrismaOperationPhase, PrincipalProvenance, Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { MemoryFactProvenanceSourceKinds, MemoryMutationDeliveryStates } from "@opencrane/contracts";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import { PersonalMemoryOperationAdmissionOutcomes, PersonalMemoryOperationInvalidState, PersonalMemoryOperationPersistenceOutcomes, type AdmitPersonalMemoryOperationCommand, type PersonalMemoryOperationTaskAdmission } from "../personal-memory-operation-persistence.types";
import { PersonalMemoryOperationEvents, PersonalMemoryOperationFailureCodes, PersonalMemoryOperationKinds, PersonalMemoryOperationPhases } from "../personal-memory-operation.types";
import { PrismaPersonalMemoryOperationRepository } from "../prisma-personal-memory-operation-repository";
import { PrismaPersonalMemoryOperationUnitOfWork } from "../prisma-personal-memory-operation-unit-of-work";

/** Separate database clients expose committed winners and Serializable retries. */
const _First = new PrismaClient();
/** Competing caller with no shared transaction state. */
const _Second = new PrismaClient();
/** Synthetic content digest; no plaintext is read or sent by these persistence proofs. */
const _ContentDigest = `sha256:${"a".repeat(64)}`;

/** Creates only the identity needed by the dataset's real foreign key. */
async function _Principal(): Promise<string>
{
	const id = randomUUID();
	await _First.principal.create({ data: { id, siloId: id, issuer: "https://identity.example.test", subject: id, provenance: PrincipalProvenance.External } });
	return id;
}

/** Builds immutable synthetic message coordinates without creating a provider or workflow task. */
function _Command(principalId: string, datasetId: string): AdmitPersonalMemoryOperationCommand
{
	const operationId = randomUUID();
	return {
		operationId, siloId: principalId, datasetId, actorPrincipalId: principalId,
		idempotencyKeyDigest: `sha256:${operationId.replaceAll("-", "").repeat(2)}`,
		commandDigest: `sha256:${"b".repeat(64)}`, kind: PersonalMemoryOperationKinds.Remember,
		source: { conversationId: randomUUID(), messageId: randomUUID(), messagePosition: 0n, payloadRef: randomUUID(), ciphertextDigest: `sha256:${"c".repeat(64)}`, authorPrincipalId: principalId },
		contentDigest: _ContentDigest, targetFactId: null, targetDocumentId: null, expectedFactRevision: null,
		providerDatasetId: null, task: { taskName: "personal-memory-operation", taskKey: operationId }, admittedAt: new Date(),
	};
}

/** Returns a synthetic receipt for persistence tests; this does not prove an engine admission. */
async function _AdmitSyntheticTask(coordinates: Parameters<PersonalMemoryOperationTaskAdmission>[0])
{
	return { taskId: coordinates.taskKey, ...coordinates };
}

/** Runs repository admission through the shared Serializable retry boundary. */
function _Admit(client: PrismaClient, command: AdmitPersonalMemoryOperationCommand, admitTask: PersonalMemoryOperationTaskAdmission = _AdmitSyntheticTask)
{
	return ___RunInPrismaUnitOfWork(client, async function _AdmitOperation(transaction)
	{
		return new PrismaPersonalMemoryOperationRepository(transaction).admit(command, admitTask);
	}, { isolationLevel: "Serializable", attemptLimit: 3, operation: "personal-memory operation SQL admission" });
}

/** Combines composite test admission with the remaining lifecycle-only UnitOfWork. */
function _Owner(client: PrismaClient)
{
	const lifecycle = new PrismaPersonalMemoryOperationUnitOfWork(client);
	return { admit(command: AdmitPersonalMemoryOperationCommand) { return _Admit(client, command); }, apply: lifecycle.apply.bind(lifecycle) };
}

/** Creates a provisional dataset inside whichever transaction owns the command admission. */
async function _Dataset(transaction: Prisma.TransactionClient, principalId: string, datasetId: string): Promise<void>
{
	await transaction.memoryDataset.create({ data: { id: datasetId, siloId: principalId, boundaryKind: AuthorizationBoundaryKind.Personal, boundaryPrincipalId: principalId, createdBy: principalId, state: MemoryDatasetState.Provisioning, cogneeDatasetId: null } });
}

/** Seeds one committed provisional dataset for concurrency and restart proofs. */
async function _Fixture(): Promise<AdmitPersonalMemoryOperationCommand>
{
	const principalId = await _Principal();
	const datasetId = randomUUID();
	await _First.$transaction(async function _Seed(transaction) { await _Dataset(transaction, principalId, datasetId); });
	return _Command(principalId, datasetId);
}

describe("personal-memory operations on fresh PostgreSQL", function _Suite()
{
	beforeAll(async function _Connect()
	{
		if (!process.env.DATABASE_URL)
			throw new Error("Personal-memory SQL proofs require DATABASE_URL and the fresh target baseline");
		await Promise.all([_First.$connect(), _Second.$connect()]);
	});
	afterAll(async function _Disconnect() { await Promise.all([_First.$disconnect(), _Second.$disconnect()]); });

	it("admits one workflow receipt and one operation under concurrent replay", async function _ConcurrentAdmission()
	{
		const command = await _Fixture();
		const admitTask = vi.fn(_AdmitSyntheticTask);
		const results = await Promise.all([_Admit(_First, command, admitTask), _Admit(_Second, command, admitTask)]);
		expect(results.filter(result => result.outcome === PersonalMemoryOperationAdmissionOutcomes.Created)).toHaveLength(1);
		expect(results.filter(result => result.outcome === PersonalMemoryOperationAdmissionOutcomes.Replayed)).toHaveLength(1);
		expect(results.map(result => result.operation.task.taskId)).toEqual([command.operationId, command.operationId]);
		expect(admitTask).toHaveBeenCalledOnce();
		expect(await _First.personalMemoryOperation.count({ where: { siloId: command.siloId } })).toBe(1);
	});

	it("adopts a provider dataset once and returns the saved operation after client restart", async function _ConcurrentAdoption()
	{
		const command = await _Fixture();
		const first = _Owner(_First);
		const second = _Owner(_Second);
		await first.admit(command);
		const providerDatasetId = randomUUID();
		const event = { operationId: command.operationId, kind: command.kind, expectedRevision: 1, event: PersonalMemoryOperationEvents.DatasetEnsured, providerDatasetId } as const;
		const results = await Promise.all([first.apply(event, new Date()), second.apply(event, new Date())]);
		expect(results.filter(result => result.outcome === PersonalMemoryOperationPersistenceOutcomes.Advanced)).toHaveLength(1);
		expect(await _First.memoryDataset.findUnique({ where: { id: command.datasetId } })).toMatchObject({ state: MemoryDatasetState.Active, cogneeDatasetId: providerDatasetId });
		const restartedClient = new PrismaClient();
		try
		{
				const restarted = _Owner(restartedClient);
			await expect(restarted.admit(command)).resolves.toMatchObject({ outcome: PersonalMemoryOperationAdmissionOutcomes.Replayed, operation: { revision: 2, phase: PersonalMemoryOperationPhases.DocumentAddPending, admittedProviderDatasetId: null, providerDatasetId } });
		}
		finally { await restartedClient.$disconnect(); }
	});

	it("rolls back a provisional dataset and operation together when admission fails", async function _AdmissionRollback()
	{
		const principalId = await _Principal();
		const command = _Command(principalId, randomUUID());
		await expect(_First.$transaction(async function _FailAdmission(transaction)
		{
			await _Dataset(transaction, principalId, command.datasetId);
			const repository = new PrismaPersonalMemoryOperationRepository(transaction);
			await repository.admit(command, async function _MismatchedTask(coordinates) { return { taskId: randomUUID(), taskName: `${coordinates.taskName}-other`, taskKey: coordinates.taskKey }; });
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })).rejects.toBeInstanceOf(PersonalMemoryOperationInvalidState);
		expect(await _Second.memoryDataset.findUnique({ where: { id: command.datasetId } })).toBeNull();
		expect(await _Second.personalMemoryOperation.findUnique({ where: { id: command.operationId } })).toBeNull();
	});

	it("rolls back provider adoption together with the operation's saved step", async function _AdoptionRollback()
	{
		const command = await _Fixture();
		const owner = _Owner(_First);
		await owner.admit(command);
		await expect(_First.$transaction(async function _FailAdoption(transaction)
		{
			const repository = new PrismaPersonalMemoryOperationRepository(transaction);
			await repository.apply({ operationId: command.operationId, kind: command.kind, expectedRevision: 1, event: PersonalMemoryOperationEvents.DatasetEnsured, providerDatasetId: randomUUID() }, new Date());
			throw new Error("synthetic adoption failure");
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })).rejects.toThrow("synthetic adoption failure");
		expect(await _Second.memoryDataset.findUnique({ where: { id: command.datasetId } })).toMatchObject({ state: MemoryDatasetState.Provisioning, cogneeDatasetId: null });
		expect(await _Second.personalMemoryOperation.findUnique({ where: { id: command.operationId } })).toMatchObject({ revision: 1, providerDatasetId: null });
	});

	it("keeps an uncertain document effect durable across a new client", async function _RecoveryAfterRestart()
	{
		const command = await _Fixture();
		const owner = _Owner(_First);
		await owner.admit(command);
		await owner.apply({ operationId: command.operationId, kind: command.kind, expectedRevision: 1, event: PersonalMemoryOperationEvents.DatasetEnsured, providerDatasetId: randomUUID() }, new Date());
		await owner.apply({ operationId: command.operationId, kind: command.kind, expectedRevision: 2, event: PersonalMemoryOperationEvents.MutationFailed, failureCode: PersonalMemoryOperationFailureCodes.DocumentConflict, deliveryState: MemoryMutationDeliveryStates.Ambiguous }, new Date());
		const restartedClient = new PrismaClient();
		try
		{
				const restarted = _Owner(restartedClient);
			await expect(restarted.admit(command)).resolves.toMatchObject({ operation: { revision: 3, phase: PersonalMemoryOperationPhases.RecoveryRequired, recoveryPhase: PersonalMemoryOperationPhases.DocumentAddPending, failureCode: PersonalMemoryOperationFailureCodes.DocumentConflict, deliveryState: MemoryMutationDeliveryStates.Ambiguous } });
		}
		finally { await restartedClient.$disconnect(); }
	});

	it.each([MemoryFactState.Active, MemoryFactState.Corrected])("hides a %s fact once and replays against its original expected revision", async function _ForgetReplay(state)
	{
		const command = await _Fixture();
		const providerDatasetId = randomUUID();
		await _First.memoryDataset.update({ where: { id: command.datasetId }, data: { state: MemoryDatasetState.Active, cogneeDatasetId: providerDatasetId } });
		const factId = randomUUID();
		const documentId = randomUUID();
		await _First.memoryFactCatalog.create({ data: { id: factId, datasetId: command.datasetId, cogneeExternalId: documentId, contentDigest: _ContentDigest, state: MemoryFactState.Active, consentState: MemoryConsentState.Explicit, sensitivity: "ordinary", provenance: { user_statement: true }, recordedBy: command.actorPrincipalId } });
		if (state === MemoryFactState.Corrected)
		{
			await _First.memoryFactCatalog.create({ data: { id: randomUUID(), datasetId: command.datasetId, cogneeExternalId: randomUUID(), contentDigest: `sha256:${"d".repeat(64)}`, state: MemoryFactState.Active, consentState: MemoryConsentState.Explicit, sensitivity: "ordinary", provenance: { user_statement: true }, recordedBy: command.actorPrincipalId, supersedesFactId: factId } });
		}
		const expectedFactRevision = state === MemoryFactState.Corrected ? 2 : 1;
		const forget = { ...command, kind: PersonalMemoryOperationKinds.Forget, source: null, contentDigest: null, targetFactId: factId, targetDocumentId: documentId, expectedFactRevision, providerDatasetId };
		const first = _Owner(_First);
		const second = _Owner(_Second);
		const results = await Promise.all([first.admit(forget), second.admit(forget)]);
		expect(results.filter(result => result.outcome === PersonalMemoryOperationAdmissionOutcomes.Created)).toHaveLength(1);
		expect(await _First.memoryFactCatalog.findUnique({ where: { id: factId } })).toMatchObject({ revision: expectedFactRevision + 1, state: MemoryFactState.ForgetPending });
		expect(results.every(result => result.operation.expectedFactRevision === expectedFactRevision)).toBe(true);
	});

	it("publishes one Remember fact and replays the completed operation after restart", async function _RememberCatalogCompletion()
	{
		const pending = await _RememberAtCatalogPending();
		const recordedAt = _CatalogRecordedAt(pending.command);
		const owner = _Owner(_First);
		await expect(owner.apply({ operationId: pending.command.operationId, kind: pending.command.kind, expectedRevision: 5, event: PersonalMemoryOperationEvents.CatalogCommitted }, recordedAt)).resolves.toMatchObject({ outcome: PersonalMemoryOperationPersistenceOutcomes.Advanced, operation: { phase: PersonalMemoryOperationPhases.Completed, revision: 6 } });

		const restartedClient = new PrismaClient();
		try
		{
			const operation = await restartedClient.personalMemoryOperation.findUniqueOrThrow({ where: { id: pending.command.operationId } });
			const facts = await restartedClient.memoryFactCatalog.findMany({ where: { datasetId: pending.command.datasetId } });
			expect(operation).toMatchObject({ phase: PrismaOperationPhase.Completed, revision: 6, completedAt: recordedAt });
			expect(facts).toHaveLength(1);
			expect(facts[0]).toMatchObject({ id: pending.command.operationId, datasetId: pending.command.datasetId, cogneeExternalId: pending.documentId, contentDigest: pending.command.contentDigest, state: MemoryFactState.Active, revision: 1, consentState: MemoryConsentState.Explicit, sensitivity: "personal", sourceArtifactRevisionId: null, sourceMessageId: pending.command.source?.messageId, supersedesFactId: null, recordedBy: pending.command.actorPrincipalId, recordedAt: recordedAt });
			expect(facts[0]?.provenance).toEqual({ sourceKind: MemoryFactProvenanceSourceKinds.Message, operationId: pending.command.operationId, conversationId: pending.command.source?.conversationId, messagePosition: pending.command.source?.messagePosition.toString(), authorPrincipalId: pending.command.source?.authorPrincipalId });
			await expect(_Owner(restartedClient).admit(pending.command)).resolves.toMatchObject({ outcome: PersonalMemoryOperationAdmissionOutcomes.Replayed, operation: { phase: PersonalMemoryOperationPhases.Completed, revision: 6 } });
		}
		finally { await restartedClient.$disconnect(); }
	});

	it("publishes one Correct successor, fences its predecessor, and ignores duplicate completion", async function _CorrectCatalogCompletion()
	{
		const pending = await _CorrectAtCatalogPending();
		const recordedAt = _CatalogRecordedAt(pending.command);
		const event = { operationId: pending.command.operationId, kind: pending.command.kind, expectedRevision: 4, event: PersonalMemoryOperationEvents.CatalogCommitted } as const;
		const results = await Promise.allSettled([_Owner(_First).apply(event, recordedAt), _Owner(_Second).apply(event, recordedAt)]);
		expect(results.every(result => result.status === "fulfilled")).toBe(true);
		expect(results.filter(result => result.status === "fulfilled" && result.value.outcome === PersonalMemoryOperationPersistenceOutcomes.Advanced)).toHaveLength(1);
		const facts = await _First.memoryFactCatalog.findMany({ where: { datasetId: pending.command.datasetId } });
		const predecessor = facts.find(fact => fact.id === pending.targetFactId);
		const successors = facts.filter(fact => fact.supersedesFactId === pending.targetFactId);
		expect(predecessor).toMatchObject({ state: MemoryFactState.Corrected, revision: 2 });
		expect(successors).toHaveLength(1);
		expect(successors[0]).toMatchObject({ id: pending.command.operationId, state: MemoryFactState.Active, revision: 1, cogneeExternalId: pending.documentId, contentDigest: pending.command.contentDigest, consentState: MemoryConsentState.Explicit, sensitivity: "personal", sourceMessageId: pending.command.source?.messageId, recordedBy: pending.command.actorPrincipalId });
		expect(await _First.personalMemoryOperation.findUniqueOrThrow({ where: { id: pending.command.operationId } })).toMatchObject({ phase: PrismaOperationPhase.PriorDocumentDeletePending, revision: 5 });
	});

	it("finishes Forget at the database-owned revision after restart", async function _ForgetCatalogCompletion()
	{
		const pending = await _ForgetAtCatalogFinalizePending();
		const recordedAt = _CatalogRecordedAt(pending.command);
		await expect(_Owner(_First).apply({ operationId: pending.command.operationId, kind: pending.command.kind, expectedRevision: 2, event: PersonalMemoryOperationEvents.CatalogFinalized }, recordedAt)).resolves.toMatchObject({ outcome: PersonalMemoryOperationPersistenceOutcomes.Advanced, operation: { phase: PersonalMemoryOperationPhases.Completed, revision: 3 } });

		const restartedClient = new PrismaClient();
		try
		{
			const fact = await restartedClient.memoryFactCatalog.findUniqueOrThrow({ where: { id: pending.targetFactId } });
			const operation = await restartedClient.personalMemoryOperation.findUniqueOrThrow({ where: { id: pending.command.operationId } });
			expect(fact).toMatchObject({ state: MemoryFactState.Forgotten, revision: 3, forgottenAt: recordedAt });
			expect(operation).toMatchObject({ phase: PrismaOperationPhase.Completed, revision: 3, completedAt: recordedAt });
		}
		finally { await restartedClient.$disconnect(); }
	});

	it("rolls back Remember catalog publication and operation advancement together", async function _RememberCatalogRollback()
	{
		const pending = await _RememberAtCatalogPending();
		await expect(_First.$transaction(async function _Rollback(transaction)
		{
			await new PrismaPersonalMemoryOperationRepository(transaction).apply({ operationId: pending.command.operationId, kind: pending.command.kind, expectedRevision: 5, event: PersonalMemoryOperationEvents.CatalogCommitted }, _CatalogRecordedAt(pending.command));
			throw new Error("synthetic Remember catalog rollback");
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })).rejects.toThrow("synthetic Remember catalog rollback");
		expect(await _Second.memoryFactCatalog.count({ where: { datasetId: pending.command.datasetId } })).toBe(0);
		expect(await _Second.personalMemoryOperation.findUniqueOrThrow({ where: { id: pending.command.operationId } })).toMatchObject({ phase: PrismaOperationPhase.CatalogCommitPending, revision: 5 });
	});

	it("rolls back Correct successor publication and predecessor transition together", async function _CorrectCatalogRollback()
	{
		const pending = await _CorrectAtCatalogPending();
		await expect(_First.$transaction(async function _Rollback(transaction)
		{
			await new PrismaPersonalMemoryOperationRepository(transaction).apply({ operationId: pending.command.operationId, kind: pending.command.kind, expectedRevision: 4, event: PersonalMemoryOperationEvents.CatalogCommitted }, _CatalogRecordedAt(pending.command));
			throw new Error("synthetic Correct catalog rollback");
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })).rejects.toThrow("synthetic Correct catalog rollback");
		expect(await _Second.memoryFactCatalog.findUniqueOrThrow({ where: { id: pending.targetFactId } })).toMatchObject({ state: MemoryFactState.Active, revision: 1 });
		expect(await _Second.memoryFactCatalog.count({ where: { datasetId: pending.command.datasetId } })).toBe(1);
		expect(await _Second.personalMemoryOperation.findUniqueOrThrow({ where: { id: pending.command.operationId } })).toMatchObject({ phase: PrismaOperationPhase.CatalogCommitPending, revision: 4 });
	});

	it("rolls back Forget completion while retaining its admission hide", async function _ForgetCatalogRollback()
	{
		const pending = await _ForgetAtCatalogFinalizePending();
		await expect(_First.$transaction(async function _Rollback(transaction)
		{
			await new PrismaPersonalMemoryOperationRepository(transaction).apply({ operationId: pending.command.operationId, kind: pending.command.kind, expectedRevision: 2, event: PersonalMemoryOperationEvents.CatalogFinalized }, _CatalogRecordedAt(pending.command));
			throw new Error("synthetic Forget catalog rollback");
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })).rejects.toThrow("synthetic Forget catalog rollback");
		expect(await _Second.memoryFactCatalog.findUniqueOrThrow({ where: { id: pending.targetFactId } })).toMatchObject({ state: MemoryFactState.ForgetPending, revision: 2 });
		expect(await _Second.personalMemoryOperation.findUniqueOrThrow({ where: { id: pending.command.operationId } })).toMatchObject({ phase: PrismaOperationPhase.CatalogFinalizePending, revision: 2 });
	});
});

/** Fixed digest for the synthetic indexing evidence used by every catalog fixture. */
const _InputDigest = `sha256:${"d".repeat(64)}`;

/** Derives a catalog timestamp after the command's live admission timestamp. */
function _CatalogRecordedAt(command: AdmitPersonalMemoryOperationCommand): Date
{
	return new Date(command.admittedAt.getTime() + 1_000);
}

/** Drives a new Remember operation through provider and indexing receipts to catalog completion. */
async function _RememberAtCatalogPending()
{
	const command = await _Fixture();
	const owner = _Owner(_First);
	await owner.admit(command);
	const recordedAt = _CatalogRecordedAt(command);
	const providerDatasetId = randomUUID();
	const documentId = randomUUID();
	await owner.apply({ operationId: command.operationId, kind: command.kind, expectedRevision: 1, event: PersonalMemoryOperationEvents.DatasetEnsured, providerDatasetId }, recordedAt);
	await owner.apply({ operationId: command.operationId, kind: command.kind, expectedRevision: 2, event: PersonalMemoryOperationEvents.DocumentAdded, documentId, contentDigest: command.contentDigest! }, recordedAt);
	await owner.apply({ operationId: command.operationId, kind: command.kind, expectedRevision: 3, event: PersonalMemoryOperationEvents.IndexEvidenceSaved, indexingOperationId: randomUUID(), expectedInputEvidenceDigest: _InputDigest }, recordedAt);
	const operation = await _First.personalMemoryOperation.findUniqueOrThrow({ where: { id: command.operationId } });
	await owner.apply({ operationId: command.operationId, kind: command.kind, expectedRevision: 4, event: PersonalMemoryOperationEvents.IndexingCompleted, indexingOperationId: operation.indexingOperationId!, expectedInputEvidenceDigest: operation.expectedInputEvidenceDigest!, pipelineRunId: randomUUID() }, recordedAt);
	return { command, datasetId: command.datasetId, documentId };
}

/** Seeds one Active fact and drives a Correct operation to catalog completion. */
async function _CorrectAtCatalogPending()
{
	const command = await _Fixture();
	const providerDatasetId = randomUUID();
	await _First.memoryDataset.update({ where: { id: command.datasetId }, data: { state: MemoryDatasetState.Active, cogneeDatasetId: providerDatasetId } });
	const targetFactId = randomUUID();
	const targetDocumentId = randomUUID();
	await _First.memoryFactCatalog.create({ data: { id: targetFactId, datasetId: command.datasetId, cogneeExternalId: targetDocumentId, contentDigest: _ContentDigest, consentState: MemoryConsentState.Explicit, sensitivity: "personal", provenance: { sourceKind: MemoryFactProvenanceSourceKinds.Message }, sourceMessageId: command.source!.messageId, recordedBy: command.actorPrincipalId } });
	const correct = { ...command, kind: PersonalMemoryOperationKinds.Correct, targetFactId, targetDocumentId, expectedFactRevision: 1, providerDatasetId };
	const owner = _Owner(_First);
	await owner.admit(correct);
	const recordedAt = _CatalogRecordedAt(correct);
	const documentId = randomUUID();
	await owner.apply({ operationId: correct.operationId, kind: correct.kind, expectedRevision: 1, event: PersonalMemoryOperationEvents.DocumentAdded, documentId, contentDigest: correct.contentDigest! }, recordedAt);
	await owner.apply({ operationId: correct.operationId, kind: correct.kind, expectedRevision: 2, event: PersonalMemoryOperationEvents.IndexEvidenceSaved, indexingOperationId: randomUUID(), expectedInputEvidenceDigest: _InputDigest }, recordedAt);
	const indexed = await _First.personalMemoryOperation.findUniqueOrThrow({ where: { id: correct.operationId } });
	await owner.apply({ operationId: correct.operationId, kind: correct.kind, expectedRevision: 3, event: PersonalMemoryOperationEvents.IndexingCompleted, indexingOperationId: indexed.indexingOperationId!, expectedInputEvidenceDigest: indexed.expectedInputEvidenceDigest!, pipelineRunId: randomUUID() }, recordedAt);
	return { command: correct, datasetId: command.datasetId, documentId, targetFactId };
}

/** Seeds an Active target, admits Forget, and advances through exact provider absence. */
async function _ForgetAtCatalogFinalizePending()
{
	const command = await _Fixture();
	const providerDatasetId = randomUUID();
	await _First.memoryDataset.update({ where: { id: command.datasetId }, data: { state: MemoryDatasetState.Active, cogneeDatasetId: providerDatasetId } });
	const targetFactId = randomUUID();
	const targetDocumentId = randomUUID();
	await _First.memoryFactCatalog.create({ data: { id: targetFactId, datasetId: command.datasetId, cogneeExternalId: targetDocumentId, contentDigest: _ContentDigest, consentState: MemoryConsentState.Explicit, sensitivity: "personal", provenance: { sourceKind: MemoryFactProvenanceSourceKinds.Message }, sourceMessageId: command.source!.messageId, recordedBy: command.actorPrincipalId } });
	const forget = { ...command, kind: PersonalMemoryOperationKinds.Forget, source: null, contentDigest: null, targetFactId, targetDocumentId, expectedFactRevision: 1, providerDatasetId };
	const owner = _Owner(_First);
	await owner.admit(forget);
	await owner.apply({ operationId: forget.operationId, kind: forget.kind, expectedRevision: 1, event: PersonalMemoryOperationEvents.DocumentDeleted, documentId: targetDocumentId }, _CatalogRecordedAt(forget));
	return { command: forget, targetFactId };
}
