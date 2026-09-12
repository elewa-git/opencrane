import { randomUUID } from "node:crypto";

import { AuthorizationBoundaryKind, MemoryConsentState, MemoryDatasetState, MemoryFactState, PrincipalProvenance, Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MemoryMutationDeliveryStates } from "@opencrane/contracts";

import { PersonalMemoryOperationAdmissionOutcomes, PersonalMemoryOperationPersistenceOutcomes, type AdmitPersonalMemoryOperationCommand } from "../personal-memory-operation-persistence.types";
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
		providerDatasetId: null, task: { taskId: randomUUID(), taskName: "personal-memory-operation", taskKey: operationId }, admittedAt: new Date(),
	};
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

	it("admits one operation and one reserved task identity under concurrent replay", async function _ConcurrentAdmission()
	{
		const command = await _Fixture();
		const first = new PrismaPersonalMemoryOperationUnitOfWork(_First);
		const second = new PrismaPersonalMemoryOperationUnitOfWork(_Second);
		const results = await Promise.all([first.admit(command), second.admit(command)]);
		expect(results.filter(result => result.outcome === PersonalMemoryOperationAdmissionOutcomes.Created)).toHaveLength(1);
		expect(results.filter(result => result.outcome === PersonalMemoryOperationAdmissionOutcomes.Replayed)).toHaveLength(1);
		expect(results.map(result => result.operation.task.taskId)).toEqual([command.task.taskId, command.task.taskId]);
		expect(await _First.personalMemoryOperation.count({ where: { siloId: command.siloId } })).toBe(1);
	});

	it("adopts a provider dataset once and returns the saved operation after client restart", async function _ConcurrentAdoption()
	{
		const command = await _Fixture();
		const first = new PrismaPersonalMemoryOperationUnitOfWork(_First);
		const second = new PrismaPersonalMemoryOperationUnitOfWork(_Second);
		await first.admit(command);
		const providerDatasetId = randomUUID();
		const event = { operationId: command.operationId, kind: command.kind, expectedRevision: 1, event: PersonalMemoryOperationEvents.DatasetEnsured, providerDatasetId } as const;
		const results = await Promise.all([first.apply(event, new Date()), second.apply(event, new Date())]);
		expect(results.filter(result => result.outcome === PersonalMemoryOperationPersistenceOutcomes.Advanced)).toHaveLength(1);
		expect(await _First.memoryDataset.findUnique({ where: { id: command.datasetId } })).toMatchObject({ state: MemoryDatasetState.Active, cogneeDatasetId: providerDatasetId });
		const restartedClient = new PrismaClient();
		try
		{
			const restarted = new PrismaPersonalMemoryOperationUnitOfWork(restartedClient);
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
			await repository.admit(command);
			throw new Error("synthetic admission failure");
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })).rejects.toThrow("synthetic admission failure");
		expect(await _Second.memoryDataset.findUnique({ where: { id: command.datasetId } })).toBeNull();
		expect(await _Second.personalMemoryOperation.findUnique({ where: { id: command.operationId } })).toBeNull();
	});

	it("rolls back provider adoption together with the operation's saved step", async function _AdoptionRollback()
	{
		const command = await _Fixture();
		const owner = new PrismaPersonalMemoryOperationUnitOfWork(_First);
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
		const owner = new PrismaPersonalMemoryOperationUnitOfWork(_First);
		await owner.admit(command);
		await owner.apply({ operationId: command.operationId, kind: command.kind, expectedRevision: 1, event: PersonalMemoryOperationEvents.DatasetEnsured, providerDatasetId: randomUUID() }, new Date());
		await owner.apply({ operationId: command.operationId, kind: command.kind, expectedRevision: 2, event: PersonalMemoryOperationEvents.MutationFailed, failureCode: PersonalMemoryOperationFailureCodes.DocumentConflict, deliveryState: MemoryMutationDeliveryStates.Ambiguous }, new Date());
		const restartedClient = new PrismaClient();
		try
		{
			const restarted = new PrismaPersonalMemoryOperationUnitOfWork(restartedClient);
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
		const first = new PrismaPersonalMemoryOperationUnitOfWork(_First);
		const second = new PrismaPersonalMemoryOperationUnitOfWork(_Second);
		const results = await Promise.all([first.admit(forget), second.admit(forget)]);
		expect(results.filter(result => result.outcome === PersonalMemoryOperationAdmissionOutcomes.Created)).toHaveLength(1);
		expect(await _First.memoryFactCatalog.findUnique({ where: { id: factId } })).toMatchObject({ revision: expectedFactRevision + 1, state: MemoryFactState.ForgetPending });
		expect(results.every(result => result.operation.expectedFactRevision === expectedFactRevision)).toBe(true);
	});
});
