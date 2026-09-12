import { AuthorizationBoundaryKind, MemoryDatasetState, MemoryFactState, PersonalMemoryOperationDeliveryState as PrismaDeliveryState, PersonalMemoryOperationFailureCode as PrismaFailureCode, PersonalMemoryOperationKind as PrismaKind, PersonalMemoryOperationPhase as PrismaPhase, type PersonalMemoryOperation as PrismaOperationRow, type Prisma } from "@prisma/client";
import { describe, expect, it, vi, type Mock } from "vitest";

import { MemoryMutationDeliveryStates } from "@opencrane/contracts";

import { PersonalMemoryOperationAdmissionOutcomes, PersonalMemoryOperationInvalidState, PersonalMemoryOperationPersistenceOutcomes, PersonalMemoryOperationReplayConflict, type AdmitPersonalMemoryOperationCommand } from "../personal-memory-operation-persistence.types";
import { PrismaPersonalMemoryOperationRepository } from "../prisma-personal-memory-operation-repository";
import { PersonalMemoryOperationEvents, PersonalMemoryOperationFailureCodes, PersonalMemoryOperationKinds, type PersonalMemoryOperationEvent } from "../personal-memory-operation.types";

const _OPERATION_ID = "00000000-0000-4000-8000-000000000001";
const _DATASET_PROVIDER_ID = "00000000-0000-4000-8000-000000000002";
const _TARGET_DOCUMENT_ID = "00000000-0000-4000-8000-000000000003";
const _TASK_ID = "00000000-0000-4000-8000-000000000004";
const _NEW_DOCUMENT_ID = "00000000-0000-4000-8000-000000000005";
const _INDEXING_ID = "00000000-0000-4000-8000-000000000006";
const _PIPELINE_ID = "00000000-0000-4000-8000-000000000007";
const _CONTENT_DIGEST = `sha256:${"a".repeat(64)}`;
const _CIPHERTEXT_DIGEST = `sha256:${"b".repeat(64)}`;
const _IDEMPOTENCY_DIGEST = `sha256:${"c".repeat(64)}`;
const _COMMAND_DIGEST = `sha256:${"d".repeat(64)}`;
const _INPUT_DIGEST = `sha256:${"e".repeat(64)}`;
const _ADMITTED_AT = new Date("2026-09-13T08:00:00.000Z");
const _RECORDED_AT = new Date("2026-09-13T08:05:00.000Z");

/** Prisma delegate shape used by behavior tests without a database process. */
interface _TransactionFixture
{
	/** Transaction client passed to the repository. */
	readonly transaction: Prisma.TransactionClient;
	/** Dataset read used before its no-change lock update. */
	readonly findDataset: Mock;
	/** Dataset update that acquires the first row lock. */
	readonly updateDataset: Mock;
	/** Fact read used before the sorted fact lock. */
	readonly findFact: Mock;
	/** Fact update that acquires the second row lock. */
	readonly updateFact: Mock;
	/** Operation replay and lifecycle reads. */
	readonly findOperation: Mock;
	/** Operation no-change lock and lifecycle CAS updates. */
	readonly updateOperation: Mock;
	/** Operation insert used by a new admission. */
	readonly createOperation: Mock;
}

describe("PrismaPersonalMemoryOperationRepository", function _Suite()
{
	it("creates a secret-free operation after locking its dataset and keeps only encrypted source coordinates", async function _Create()
	{
		const callOrder: string[] = [];
		const row = _CorrectRow();
		const fixture = _Fixture(row, callOrder);
		fixture.findOperation.mockResolvedValueOnce(null);
		fixture.createOperation.mockImplementation(async function _CreateRow()
		{
			callOrder.push("operation-create");
			return row;
		});
		const repository = new PrismaPersonalMemoryOperationRepository(fixture.transaction);
		const result = await repository.admit(_CorrectCommand());

		expect(result).toMatchObject({ outcome: PersonalMemoryOperationAdmissionOutcomes.Created, operation: { operationId: _OPERATION_ID, source: { payloadRef: "payload-1", ciphertextDigest: _CIPHERTEXT_DIGEST } } });
		expect(callOrder).toEqual(["dataset-read", "dataset-lock", "fact-read:fact-1", "fact-lock:fact-1", "operation-create"]);
		const data = fixture.createOperation.mock.calls[0][0].data;
		expect(data).not.toHaveProperty("content");
		expect(data).not.toHaveProperty("plaintext");
		expect(data).not.toHaveProperty("providerPayload");
		expect(data).toMatchObject({ sourcePayloadRef: "payload-1", sourceCiphertextDigest: _CIPHERTEXT_DIGEST, contentDigest: _CONTENT_DIGEST, workflowTaskId: _TASK_ID });
	});

	it("returns the original operation for an exact replay and conflicts when immutable evidence changes", async function _Replay()
	{
		const exact = _Fixture(_CorrectRow());
		const repository = new PrismaPersonalMemoryOperationRepository(exact.transaction);
		await expect(repository.admit(_CorrectCommand())).resolves.toMatchObject({ outcome: PersonalMemoryOperationAdmissionOutcomes.Replayed, operation: { operationId: _OPERATION_ID, revision: 1 } });
		const regenerated = _Fixture(_CorrectRow());
		const regeneratedRepository = new PrismaPersonalMemoryOperationRepository(regenerated.transaction);
		const retryGeneratedIdentity = { ..._CorrectCommand(), operationId: "00000000-0000-4000-8000-000000000099", task: { taskId: "00000000-0000-4000-8000-000000000098", taskName: "personal-memory-operation", taskKey: "retry-generated-key" } };
		await expect(regeneratedRepository.admit(retryGeneratedIdentity)).resolves.toMatchObject({ outcome: PersonalMemoryOperationAdmissionOutcomes.Replayed, operation: { operationId: _OPERATION_ID, task: { taskId: _TASK_ID } } });

		const changedCommands: AdmitPersonalMemoryOperationCommand[] = [
			{ ..._CorrectCommand(), actorPrincipalId: "principal-2", source: { ..._CorrectCommand().source!, authorPrincipalId: "principal-2" } },
			{ ..._CorrectCommand(), commandDigest: `sha256:${"e".repeat(64)}` },
			{ ..._CorrectCommand(), source: { ..._CorrectCommand().source!, messageId: "message-2" } },
			{ ..._CorrectCommand(), targetFactId: "fact-2" },
			{ ..._CorrectCommand(), expectedFactRevision: 8 },
			{ ..._CorrectCommand(), kind: PersonalMemoryOperationKinds.Forget, source: null, contentDigest: null },
		];
		for (const command of changedCommands)
		{
			const fixture = _Fixture(_CorrectRow());
			const changedRepository = new PrismaPersonalMemoryOperationRepository(fixture.transaction);
			await expect(changedRepository.admit(command)).rejects.toBeInstanceOf(PersonalMemoryOperationReplayConflict);
		}
	});

	it("replays Remember after provider dataset adoption by comparing the immutable admitted coordinate", async function _RememberReplayAfterProgress()
	{
		const newDatasetOperation = _RememberRow(null, _DATASET_PROVIDER_ID);
		const newDatasetFixture = _Fixture(newDatasetOperation);
		const newDatasetRepository = new PrismaPersonalMemoryOperationRepository(newDatasetFixture.transaction);
		await expect(newDatasetRepository.admit(_RememberCommand(null))).resolves.toMatchObject({ outcome: PersonalMemoryOperationAdmissionOutcomes.Replayed, operation: { admittedProviderDatasetId: null, providerDatasetId: _DATASET_PROVIDER_ID, revision: 2 } });

		const existingDatasetOperation = _RememberRow(_DATASET_PROVIDER_ID, _DATASET_PROVIDER_ID);
		const existingDatasetFixture = _Fixture(existingDatasetOperation);
		const existingDatasetRepository = new PrismaPersonalMemoryOperationRepository(existingDatasetFixture.transaction);
		await expect(existingDatasetRepository.admit(_RememberCommand(_DATASET_PROVIDER_ID))).resolves.toMatchObject({ outcome: PersonalMemoryOperationAdmissionOutcomes.Replayed, operation: { admittedProviderDatasetId: _DATASET_PROVIDER_ID, providerDatasetId: _DATASET_PROVIDER_ID } });
	});

	it("admits Remember only for a new Provisioning dataset or an exact existing Active dataset", async function _RememberDatasetState()
	{
		const freshRow = _RememberInitialRow(null);
		const freshFixture = _Fixture(freshRow, [], _Dataset(MemoryDatasetState.Provisioning, null));
		freshFixture.findOperation.mockResolvedValueOnce(null);
		freshFixture.createOperation.mockResolvedValueOnce(freshRow);
		const freshRepository = new PrismaPersonalMemoryOperationRepository(freshFixture.transaction);
		await expect(freshRepository.admit(_RememberCommand(null))).resolves.toMatchObject({ outcome: PersonalMemoryOperationAdmissionOutcomes.Created, operation: { providerDatasetId: null } });

		const existingRow = _RememberInitialRow(_DATASET_PROVIDER_ID);
		const existingFixture = _Fixture(existingRow);
		existingFixture.findOperation.mockResolvedValueOnce(null);
		existingFixture.createOperation.mockResolvedValueOnce(existingRow);
		const existingRepository = new PrismaPersonalMemoryOperationRepository(existingFixture.transaction);
		await expect(existingRepository.admit(_RememberCommand(_DATASET_PROVIDER_ID))).resolves.toMatchObject({ outcome: PersonalMemoryOperationAdmissionOutcomes.Created, operation: { providerDatasetId: _DATASET_PROVIDER_ID } });

		const mismatchFixture = _Fixture(freshRow, [], _Dataset(MemoryDatasetState.Active, _DATASET_PROVIDER_ID));
		mismatchFixture.findOperation.mockResolvedValueOnce(null);
		const mismatchRepository = new PrismaPersonalMemoryOperationRepository(mismatchFixture.transaction);
		await expect(mismatchRepository.admit(_RememberCommand(null))).rejects.toBeInstanceOf(PersonalMemoryOperationInvalidState);
	});

	it("adopts a Provisioning dataset UUID before saving the matching DatasetEnsured transition", async function _AdoptDataset()
	{
		const callOrder: string[] = [];
		const initial = _RememberInitialRow(null);
		const advanced = _RememberRow(null, _DATASET_PROVIDER_ID);
		const fixture = _Fixture(initial, callOrder, _Dataset(MemoryDatasetState.Provisioning, null));
		fixture.findOperation.mockReset().mockResolvedValueOnce(initial).mockResolvedValueOnce(initial).mockResolvedValueOnce(advanced);
		fixture.updateOperation.mockReset()
			.mockImplementationOnce(async function _Lock() { callOrder.push("operation-lock"); return { count: 1 }; })
			.mockImplementationOnce(async function _Cas() { callOrder.push("operation-cas"); return { count: 1 }; });
		const repository = new PrismaPersonalMemoryOperationRepository(fixture.transaction);
		const event: PersonalMemoryOperationEvent = { operationId: _OPERATION_ID, kind: PersonalMemoryOperationKinds.Remember, expectedRevision: 1, event: PersonalMemoryOperationEvents.DatasetEnsured, providerDatasetId: _DATASET_PROVIDER_ID };

		await expect(repository.apply(event, _RECORDED_AT)).resolves.toMatchObject({ outcome: PersonalMemoryOperationPersistenceOutcomes.Advanced, operation: { phase: "document_add_pending", providerDatasetId: _DATASET_PROVIDER_ID } });
		expect(callOrder).toEqual(["dataset-read", "dataset-lock", "operation-lock", "dataset-adopt", "operation-cas"]);
		expect(fixture.updateDataset.mock.calls[1][0]).toMatchObject({ where: { state: MemoryDatasetState.Provisioning, cogneeDatasetId: null }, data: { state: MemoryDatasetState.Active, cogneeDatasetId: _DATASET_PROVIDER_ID } });
	});

	it("rejects DatasetEnsured when an Active or Retired dataset cannot adopt that UUID", async function _RejectDatasetMismatch()
	{
		const initial = _RememberInitialRow(null);
		const event: PersonalMemoryOperationEvent = { operationId: _OPERATION_ID, kind: PersonalMemoryOperationKinds.Remember, expectedRevision: 1, event: PersonalMemoryOperationEvents.DatasetEnsured, providerDatasetId: _DATASET_PROVIDER_ID };
		for (const dataset of [_Dataset(MemoryDatasetState.Active, "00000000-0000-4000-8000-000000000099"), _Dataset(MemoryDatasetState.Retired, null)])
		{
			const fixture = _Fixture(initial, [], dataset);
			const repository = new PrismaPersonalMemoryOperationRepository(fixture.transaction);
			await expect(repository.apply(event, _RECORDED_AT)).rejects.toBeInstanceOf(PersonalMemoryOperationInvalidState);
		}
	});

	it("rejects a message attributed to another principal before taking a database lock", async function _OwnMessage()
	{
		const fixture = _Fixture(_CorrectRow());
		const repository = new PrismaPersonalMemoryOperationRepository(fixture.transaction);
		const command = _CorrectCommand();
		const foreignSource = { ...command, source: { ...command.source!, authorPrincipalId: "principal-2" } };

		await expect(repository.admit(foreignSource)).rejects.toBeInstanceOf(PersonalMemoryOperationInvalidState);
		expect(fixture.findDataset).not.toHaveBeenCalled();
	});

	it("hides a new Forget target in the operation transaction and replays after the fact advances", async function _ForgetAdmission()
	{
		const row = _ForgetRow();
		const freshFixture = _Fixture(row);
		freshFixture.findOperation.mockResolvedValueOnce(null);
		const freshRepository = new PrismaPersonalMemoryOperationRepository(freshFixture.transaction);
		await expect(freshRepository.admit(_ForgetCommand())).resolves.toMatchObject({ outcome: PersonalMemoryOperationAdmissionOutcomes.Created, operation: { phase: "document_delete_pending" } });
		expect(freshFixture.updateFact).toHaveBeenCalledTimes(2);
		expect(freshFixture.updateFact.mock.calls[1][0]).toEqual({ where: { id: "fact-1", datasetId: "dataset-1", state: MemoryFactState.Active, revision: 7 }, data: { state: MemoryFactState.ForgetPending, forgetRequestedAt: _ADMITTED_AT } });

		const replayFixture = _Fixture(row, [], _Dataset(MemoryDatasetState.Active, _DATASET_PROVIDER_ID), _Fact(MemoryFactState.ForgetPending, 8));
		const replayRepository = new PrismaPersonalMemoryOperationRepository(replayFixture.transaction);
		await expect(replayRepository.admit(_ForgetCommand())).resolves.toMatchObject({ outcome: PersonalMemoryOperationAdmissionOutcomes.Replayed });
		expect(replayFixture.updateFact).toHaveBeenCalledTimes(1);
	});

	it("hides a Corrected Forget target without making the superseded fact recallable again", async function _ForgetCorrectedFact()
	{
		const row = _ForgetRow();
		const fixture = _Fixture(row, [], _Dataset(MemoryDatasetState.Active, _DATASET_PROVIDER_ID), _Fact(MemoryFactState.Corrected, 7));
		fixture.findOperation.mockResolvedValueOnce(null);
		const repository = new PrismaPersonalMemoryOperationRepository(fixture.transaction);

		await expect(repository.admit(_ForgetCommand())).resolves.toMatchObject({ outcome: PersonalMemoryOperationAdmissionOutcomes.Created });
		expect(fixture.updateFact.mock.calls[1][0]).toEqual({ where: { id: "fact-1", datasetId: "dataset-1", state: MemoryFactState.Corrected, revision: 7 }, data: { state: MemoryFactState.ForgetPending, forgetRequestedAt: _ADMITTED_AT } });
	});

	it("fails closed when a bare catalog event supplies no exact fact mutation evidence", async function _CatalogEvidence()
	{
		const row = { ..._CorrectRow(), phase: PrismaPhase.CatalogCommitPending, revision: 4, providerDocumentId: _NEW_DOCUMENT_ID, indexingOperationId: _INDEXING_ID, expectedInputEvidenceDigest: _INPUT_DIGEST, pipelineRunId: _PIPELINE_ID };
		const fixture = _Fixture(row);
		const repository = new PrismaPersonalMemoryOperationRepository(fixture.transaction);
		const event: PersonalMemoryOperationEvent = { operationId: _OPERATION_ID, kind: PersonalMemoryOperationKinds.Correct, expectedRevision: 4, event: PersonalMemoryOperationEvents.CatalogCommitted };

		await expect(repository.apply(event, _RECORDED_AT)).rejects.toBeInstanceOf(PersonalMemoryOperationInvalidState);
		expect(fixture.updateOperation).toHaveBeenCalledTimes(1);
	});

	it("rejects an impossible saved row before lifecycle planning or any database write", async function _RejectInvalidRow()
	{
		const invalid = { ..._CorrectRow(), phase: PrismaPhase.Completed, completedAt: null };
		const fixture = _Fixture(invalid);
		const repository = new PrismaPersonalMemoryOperationRepository(fixture.transaction);
		const event: PersonalMemoryOperationEvent = { operationId: _OPERATION_ID, kind: PersonalMemoryOperationKinds.Correct, expectedRevision: 1, event: PersonalMemoryOperationEvents.DocumentAdded, documentId: _NEW_DOCUMENT_ID, contentDigest: _CONTENT_DIGEST };

		await expect(repository.apply(event, _RECORDED_AT)).rejects.toBeInstanceOf(PersonalMemoryOperationInvalidState);
		expect(fixture.updateDataset).not.toHaveBeenCalled();
		expect(fixture.updateOperation).not.toHaveBeenCalled();
	});

	it("returns the validated concurrent winner when the revision CAS loses", async function _ConcurrentWinner()
	{
		const initial = _CorrectRow();
		const winner = { ...initial, phase: PrismaPhase.CognifyPending, revision: 2, providerDocumentId: _NEW_DOCUMENT_ID };
		const fixture = _Fixture(initial);
		fixture.findOperation.mockReset().mockResolvedValueOnce(initial).mockResolvedValueOnce(initial).mockResolvedValueOnce(winner);
		fixture.updateOperation.mockReset().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
		const repository = new PrismaPersonalMemoryOperationRepository(fixture.transaction);
		const event: PersonalMemoryOperationEvent = { operationId: _OPERATION_ID, kind: PersonalMemoryOperationKinds.Correct, expectedRevision: 1, event: PersonalMemoryOperationEvents.DocumentAdded, documentId: _NEW_DOCUMENT_ID, contentDigest: _CONTENT_DIGEST };

		await expect(repository.apply(event, _RECORDED_AT)).resolves.toMatchObject({ outcome: PersonalMemoryOperationPersistenceOutcomes.ConcurrentWinner, operation: { revision: 2, phase: "cognify_pending", documentId: _NEW_DOCUMENT_ID } });
		expect(fixture.updateOperation).toHaveBeenCalledTimes(2);
	});

	it("takes dataset, target-fact, and operation locks before planning a retry result", async function _LockOrder()
	{
		const callOrder: string[] = [];
		const recoveryReady = { ..._CorrectRow(), phase: PrismaPhase.DocumentAddPending };
		const fixture = _Fixture(recoveryReady, callOrder);
		const repository = new PrismaPersonalMemoryOperationRepository(fixture.transaction);
		const event: PersonalMemoryOperationEvent = { operationId: _OPERATION_ID, kind: PersonalMemoryOperationKinds.Correct, expectedRevision: 1, event: PersonalMemoryOperationEvents.MutationFailed, failureCode: PersonalMemoryOperationFailureCodes.DocumentConflict, deliveryState: MemoryMutationDeliveryStates.ProvenNotSent };

		await expect(repository.apply(event, _RECORDED_AT)).resolves.toMatchObject({ outcome: PersonalMemoryOperationPersistenceOutcomes.Retry, operation: { revision: 1 } });
		expect(callOrder).toEqual(["operation-read", "dataset-read", "dataset-lock", "fact-read:fact-1", "fact-lock:fact-1", "operation-lock", "operation-reread"]);
	});
});

/** Creates a valid correction admission command with no plaintext field. */
function _CorrectCommand(): AdmitPersonalMemoryOperationCommand
{
	return {
		operationId: _OPERATION_ID,
		siloId: "silo-1",
		datasetId: "dataset-1",
		actorPrincipalId: "principal-1",
		idempotencyKeyDigest: _IDEMPOTENCY_DIGEST,
		commandDigest: _COMMAND_DIGEST,
		kind: PersonalMemoryOperationKinds.Correct,
		source: { conversationId: "conversation-1", messageId: "message-1", messagePosition: 4n, payloadRef: "payload-1", ciphertextDigest: _CIPHERTEXT_DIGEST, authorPrincipalId: "principal-1" },
		contentDigest: _CONTENT_DIGEST,
		targetFactId: "fact-1",
		targetDocumentId: _TARGET_DOCUMENT_ID,
		expectedFactRevision: 7,
		providerDatasetId: _DATASET_PROVIDER_ID,
		task: { taskId: _TASK_ID, taskName: "personal-memory-operation", taskKey: _OPERATION_ID },
		admittedAt: _ADMITTED_AT,
	};
}

/** Creates the matching initial Prisma row returned by the fake transaction. */
function _CorrectRow(): PrismaOperationRow
{
	return {
		id: _OPERATION_ID,
		siloId: "silo-1",
		datasetId: "dataset-1",
		actorPrincipalId: "principal-1",
		idempotencyKeyDigest: _IDEMPOTENCY_DIGEST,
		commandDigest: _COMMAND_DIGEST,
		kind: PrismaKind.Correct,
		phase: PrismaPhase.DocumentAddPending,
		recoveryPhase: null,
		revision: 1,
		sourceConversationId: "conversation-1",
		sourceMessageId: "message-1",
		sourceMessagePosition: 4n,
		sourcePayloadRef: "payload-1",
		sourceCiphertextDigest: _CIPHERTEXT_DIGEST,
		sourceAuthorPrincipalId: "principal-1",
		contentDigest: _CONTENT_DIGEST,
		targetFactId: "fact-1",
		targetDocumentId: _TARGET_DOCUMENT_ID,
		expectedFactRevision: 7,
		admittedProviderDatasetId: _DATASET_PROVIDER_ID,
		providerDatasetId: _DATASET_PROVIDER_ID,
		providerDocumentId: null,
		indexingOperationId: null,
		expectedInputEvidenceDigest: null,
		pipelineRunId: null,
		failureCode: null as PrismaFailureCode | null,
		deliveryState: null as PrismaDeliveryState | null,
		workflowTaskId: _TASK_ID,
		workflowTaskName: "personal-memory-operation",
		workflowTaskKey: _OPERATION_ID,
		admittedAt: _ADMITTED_AT,
		recoveryRecordedAt: null,
		completedAt: null,
	};
}

/** Creates a Remember command for a new or already adopted provider dataset. */
function _RememberCommand(providerDatasetId: string | null): AdmitPersonalMemoryOperationCommand
{
	return {
		..._CorrectCommand(),
		kind: PersonalMemoryOperationKinds.Remember,
		targetFactId: null,
		targetDocumentId: null,
		expectedFactRevision: null,
		providerDatasetId,
	};
}

/** Creates a progressed Remember row while retaining its original provider coordinate separately. */
function _RememberRow(admittedProviderDatasetId: string | null, providerDatasetId: string): PrismaOperationRow
{
	return {
		..._CorrectRow(),
		kind: PrismaKind.Remember,
		phase: PrismaPhase.DocumentAddPending,
		revision: 2,
		targetFactId: null,
		targetDocumentId: null,
		expectedFactRevision: null,
		admittedProviderDatasetId,
		providerDatasetId,
	};
}

/** Creates a Remember row before provider dataset adoption. */
function _RememberInitialRow(providerDatasetId: string | null): PrismaOperationRow
{
	return {
		..._CorrectRow(),
		kind: PrismaKind.Remember,
		phase: PrismaPhase.DatasetEnsurePending,
		targetFactId: null,
		targetDocumentId: null,
		expectedFactRevision: null,
		admittedProviderDatasetId: providerDatasetId,
		providerDatasetId,
	};
}

/** Creates a valid Forget command that targets the active catalog revision. */
function _ForgetCommand(): AdmitPersonalMemoryOperationCommand
{
	return {
		..._CorrectCommand(),
		kind: PersonalMemoryOperationKinds.Forget,
		source: null,
		contentDigest: null,
	};
}

/** Creates the operation row inserted after a Forget target is hidden. */
function _ForgetRow(): PrismaOperationRow
{
	return {
		..._CorrectRow(),
		kind: PrismaKind.Forget,
		phase: PrismaPhase.DocumentDeletePending,
		sourceConversationId: null,
		sourceMessageId: null,
		sourceMessagePosition: null,
		sourcePayloadRef: null,
		sourceCiphertextDigest: null,
		sourceAuthorPrincipalId: null,
		contentDigest: null,
	};
}

/** Creates one local dataset state returned by the fake transaction. */
function _Dataset(state: MemoryDatasetState, cogneeDatasetId: string | null)
{
	return { id: "dataset-1", siloId: "silo-1", boundaryKind: AuthorizationBoundaryKind.Personal, boundaryPrincipalId: "principal-1", cogneeDatasetId, state };
}

/** Creates one target fact state returned by the fake transaction. */
function _Fact(state: MemoryFactState, revision: number)
{
	return { id: "fact-1", cogneeExternalId: _TARGET_DOCUMENT_ID, revision, state };
}

/** Creates fake Prisma delegates and optionally records the externally visible lock sequence. */
function _Fixture(row: PrismaOperationRow, callOrder: string[] = [], dataset = _Dataset(MemoryDatasetState.Active, _DATASET_PROVIDER_ID), fact = _Fact(MemoryFactState.Active, 7)): _TransactionFixture
{
	const findDataset = vi.fn(async function _FindDataset()
	{
		callOrder.push("dataset-read");
		return dataset;
	});
	const updateDataset = vi.fn(async function _UpdateDataset(query)
	{
		callOrder.push(query.data.cogneeDatasetId === undefined ? "dataset-lock" : "dataset-adopt");
		return { count: 1 };
	});
	const findFact = vi.fn(async function _FindFact(query)
	{
		const id = query.where.id;
		callOrder.push(`fact-read:${id}`);
		return { ...fact, id };
	});
	const updateFact = vi.fn(async function _UpdateFact(query)
	{
		const id = query.where.id;
		callOrder.push(`fact-lock:${id}`);
		return { count: 1 };
	});
	const findOperation = vi.fn(async function _FindOperation()
	{
		callOrder.push(callOrder.includes("operation-lock") ? "operation-reread" : "operation-read");
		return row;
	});
	const updateOperation = vi.fn(async function _UpdateOperation()
	{
		callOrder.push("operation-lock");
		return { count: 1 };
	});
	const createOperation = vi.fn(async function _CreateOperation() { return row; });
	const transaction = {
		memoryDataset: { findFirst: findDataset, updateMany: updateDataset },
		memoryFactCatalog: { findFirst: findFact, updateMany: updateFact },
		personalMemoryOperation: { findUnique: findOperation, updateMany: updateOperation, create: createOperation },
	} as unknown as Prisma.TransactionClient;
	return { transaction, findDataset, updateDataset, findFact, updateFact, findOperation, updateOperation, createOperation };
}
