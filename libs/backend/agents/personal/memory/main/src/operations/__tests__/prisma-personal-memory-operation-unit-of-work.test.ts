import { AuthorizationBoundaryKind, MemoryDatasetState, PersonalMemoryOperationKind as PrismaKind, PersonalMemoryOperationPhase as PrismaPhase, type PersonalMemoryOperation as PrismaOperationRow, type Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { MemoryMutationDeliveryStates } from "@opencrane/contracts";

import { PersonalMemoryOperationPersistenceOutcomes } from "../personal-memory-operation-persistence.types";
import { PrismaPersonalMemoryOperationUnitOfWork } from "../prisma-personal-memory-operation-unit-of-work";
import { PersonalMemoryOperationEvents, PersonalMemoryOperationFailureCodes, PersonalMemoryOperationKinds } from "../personal-memory-operation.types";

const _OPERATION_ID = "00000000-0000-4000-8000-000000000001";
const _TASK_ID = "00000000-0000-4000-8000-000000000003";
const _CONTENT_DIGEST = `sha256:${"a".repeat(64)}`;
const _CIPHERTEXT_DIGEST = `sha256:${"b".repeat(64)}`;
const _IDEMPOTENCY_DIGEST = `sha256:${"c".repeat(64)}`;
const _COMMAND_DIGEST = `sha256:${"d".repeat(64)}`;
const _RECORDED_AT = new Date("2026-09-13T08:05:00.000Z");

describe("PrismaPersonalMemoryOperationUnitOfWork", function _Suite()
{
	it("constructs the lifecycle repository on the exact serializable callback transaction", async function _ExactTransaction()
	{
		const transaction = _Transaction();
		const rootUpdate = vi.fn(function _RootUpdate() { throw new Error("root delegate must not be used"); });
		const prisma = {
			personalMemoryOperation: { updateMany: rootUpdate },
			$transaction: vi.fn(async function _TransactionCallback(work, policy)
			{
				expect(policy).toMatchObject({ isolationLevel: "Serializable" });
				return work(transaction);
			}),
		} as unknown as PrismaClient;
		const unitOfWork = new PrismaPersonalMemoryOperationUnitOfWork(prisma);
		const event = { operationId: _OPERATION_ID, kind: PersonalMemoryOperationKinds.Remember, expectedRevision: 1, event: PersonalMemoryOperationEvents.MutationFailed, failureCode: PersonalMemoryOperationFailureCodes.DatasetUnavailable, deliveryState: MemoryMutationDeliveryStates.ProvenNotSent } as const;

		await expect(unitOfWork.apply(event, _RECORDED_AT)).resolves.toMatchObject({ outcome: PersonalMemoryOperationPersistenceOutcomes.Retry, operation: { operationId: _OPERATION_ID } });
		expect(rootUpdate).not.toHaveBeenCalled();
		expect(prisma.$transaction).toHaveBeenCalledTimes(1);
	});

	it("propagates a transaction failure without retrying an unknown error", async function _RollbackFailure()
	{
		const failure = new Error("transaction rolled back");
		const prisma = { $transaction: vi.fn(async function _FailTransaction() { throw failure; }) } as unknown as PrismaClient;
		const unitOfWork = new PrismaPersonalMemoryOperationUnitOfWork(prisma);
		const event = { operationId: _OPERATION_ID, kind: PersonalMemoryOperationKinds.Remember, expectedRevision: 1, event: PersonalMemoryOperationEvents.MutationFailed, failureCode: PersonalMemoryOperationFailureCodes.DatasetUnavailable, deliveryState: MemoryMutationDeliveryStates.ProvenNotSent } as const;

		await expect(unitOfWork.apply(event, _RECORDED_AT)).rejects.toBe(failure);
		expect(prisma.$transaction).toHaveBeenCalledTimes(1);
	});
});

/** Creates the callback transaction whose delegates own every lifecycle read and write. */
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
		admittedAt: new Date("2026-09-13T08:00:00.000Z"),
		recoveryRecordedAt: null,
		completedAt: null,
	};
	return {
		memoryDataset: {
			findFirst: vi.fn(async function _FindDataset() { return { id: "dataset-1", siloId: "silo-1", boundaryKind: AuthorizationBoundaryKind.Personal, boundaryPrincipalId: "principal-1", cogneeDatasetId: null, state: MemoryDatasetState.Provisioning }; }),
			updateMany: vi.fn(async function _LockDataset() { return { count: 1 }; }),
		},
		memoryFactCatalog: { findFirst: vi.fn(), updateMany: vi.fn() },
		personalMemoryOperation: {
			findUnique: vi.fn(async function _FindOperation() { return row; }),
			updateMany: vi.fn(async function _LockOperation() { return { count: 1 }; }),
		},
	} as unknown as Prisma.TransactionClient;
}
