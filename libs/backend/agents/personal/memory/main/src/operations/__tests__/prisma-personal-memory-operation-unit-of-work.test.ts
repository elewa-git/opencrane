import { AuthorizationBoundaryKind, MemoryDatasetState, PersonalMemoryOperationKind as PrismaKind, PersonalMemoryOperationPhase as PrismaPhase, type PersonalMemoryOperation as PrismaOperationRow, type Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PersonalMemoryOperationAdmissionOutcomes, type AdmitPersonalMemoryOperationCommand } from "../personal-memory-operation-persistence.types";
import { PrismaPersonalMemoryOperationUnitOfWork } from "../prisma-personal-memory-operation-unit-of-work";
import { PersonalMemoryOperationKinds } from "../personal-memory-operation.types";

const _OPERATION_ID = "00000000-0000-4000-8000-000000000001";
const _DATASET_ID = "00000000-0000-4000-8000-000000000002";
const _TASK_ID = "00000000-0000-4000-8000-000000000003";
const _CONTENT_DIGEST = `sha256:${"a".repeat(64)}`;
const _CIPHERTEXT_DIGEST = `sha256:${"b".repeat(64)}`;
const _IDEMPOTENCY_DIGEST = `sha256:${"c".repeat(64)}`;
const _COMMAND_DIGEST = `sha256:${"d".repeat(64)}`;
const _ADMITTED_AT = new Date("2026-09-13T08:00:00.000Z");

describe("PrismaPersonalMemoryOperationUnitOfWork", function _Suite()
{
	it("constructs the repository on the exact serializable callback transaction", async function _ExactTransaction()
	{
		const transaction = _Transaction();
		const rootCreate = vi.fn(function _RootCreate() { throw new Error("root delegate must not be used"); });
		const prisma = {
			personalMemoryOperation: { create: rootCreate },
			$transaction: vi.fn(async function _TransactionCallback(work, policy)
			{
				expect(policy).toMatchObject({ isolationLevel: "Serializable" });
				return work(transaction);
			}),
		} as unknown as PrismaClient;
		const unitOfWork = new PrismaPersonalMemoryOperationUnitOfWork(prisma);

		await expect(unitOfWork.admit(_Command())).resolves.toMatchObject({ outcome: PersonalMemoryOperationAdmissionOutcomes.Created, operation: { operationId: _OPERATION_ID } });
		expect(rootCreate).not.toHaveBeenCalled();
		expect(prisma.$transaction).toHaveBeenCalledTimes(1);
	});

	it("propagates a transaction failure without claiming task admission or retrying an unknown error", async function _RollbackFailure()
	{
		const failure = new Error("transaction rolled back");
		const prisma = { $transaction: vi.fn(async function _FailTransaction() { throw failure; }) } as unknown as PrismaClient;
		const unitOfWork = new PrismaPersonalMemoryOperationUnitOfWork(prisma);

		await expect(unitOfWork.admit(_Command())).rejects.toBe(failure);
		expect(prisma.$transaction).toHaveBeenCalledTimes(1);
	});
});

/** Creates a valid new-dataset Remember command with a reserved task UUID. */
function _Command(): AdmitPersonalMemoryOperationCommand
{
	return {
		operationId: _OPERATION_ID,
		siloId: "silo-1",
		datasetId: "dataset-1",
		actorPrincipalId: "principal-1",
		idempotencyKeyDigest: _IDEMPOTENCY_DIGEST,
		commandDigest: _COMMAND_DIGEST,
		kind: PersonalMemoryOperationKinds.Remember,
		source: { conversationId: "conversation-1", messageId: "message-1", messagePosition: 2n, payloadRef: "payload-1", ciphertextDigest: _CIPHERTEXT_DIGEST, authorPrincipalId: "principal-1" },
		contentDigest: _CONTENT_DIGEST,
		targetFactId: null,
		targetDocumentId: null,
		expectedFactRevision: null,
		providerDatasetId: null,
		task: { taskId: _TASK_ID, taskName: "personal-memory-operation", taskKey: _OPERATION_ID },
		admittedAt: _ADMITTED_AT,
	};
}

/** Creates the callback transaction whose delegates own every operation read and write. */
function _Transaction(): Prisma.TransactionClient
{
	const row: PrismaOperationRow = {
		id: _OPERATION_ID,
		siloId: "silo-1",
		datasetId: "dataset-1",
		actorPrincipalId: "principal-1",
		idempotencyKeyDigest: _IDEMPOTENCY_DIGEST,
		commandDigest: _COMMAND_DIGEST,
		kind: PrismaKind.Remember,
		phase: PrismaPhase.DatasetEnsurePending,
		recoveryPhase: null,
		revision: 1,
		sourceConversationId: "conversation-1",
		sourceMessageId: "message-1",
		sourceMessagePosition: 2n,
		sourcePayloadRef: "payload-1",
		sourceCiphertextDigest: _CIPHERTEXT_DIGEST,
		sourceAuthorPrincipalId: "principal-1",
		contentDigest: _CONTENT_DIGEST,
		targetFactId: null,
		targetDocumentId: null,
		expectedFactRevision: null,
		admittedProviderDatasetId: null,
		providerDatasetId: null,
		providerDocumentId: null,
		indexingOperationId: null,
		expectedInputEvidenceDigest: null,
		pipelineRunId: null,
		failureCode: null,
		deliveryState: null,
		workflowTaskId: _TASK_ID,
		workflowTaskName: "personal-memory-operation",
		workflowTaskKey: _OPERATION_ID,
		admittedAt: _ADMITTED_AT,
		recoveryRecordedAt: null,
		completedAt: null,
	};
	return {
		memoryDataset: {
			findFirst: vi.fn(async function _FindDataset() { return { id: "dataset-1", siloId: "silo-1", boundaryKind: AuthorizationBoundaryKind.Personal, boundaryPrincipalId: "principal-1", cogneeDatasetId: null, state: MemoryDatasetState.Provisioning }; }),
			updateMany: vi.fn(async function _LockDataset() { return { count: 1 }; }),
		},
		memoryFactCatalog: {
			findFirst: vi.fn(),
			updateMany: vi.fn(),
		},
		personalMemoryOperation: {
			findUnique: vi.fn(async function _FindOperation() { return null; }),
			create: vi.fn(async function _CreateOperation() { return row; }),
			updateMany: vi.fn(),
		},
	} as unknown as Prisma.TransactionClient;
}
