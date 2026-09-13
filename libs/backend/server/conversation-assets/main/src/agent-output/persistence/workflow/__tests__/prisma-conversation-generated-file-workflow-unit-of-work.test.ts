import type { PrismaClient } from "@prisma/client";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import { describe, expect, it, vi } from "vitest";

import { GeneratedFileWorkflowStates, type GeneratedFileWorkflowSnapshot } from "../../../workflow/generated-file-workflow.types";
import type { GeneratedFileWorkflowPersistenceDependencies } from "../generated-file-workflow-persistence.types";
import { PrismaConversationGeneratedFileWorkflowUnitOfWork } from "../prisma-conversation-generated-file-workflow-unit-of-work";

const _repository = vi.hoisted(function _RepositoryMocks()
{
	return { constructor: vi.fn(), loadCurrent: vi.fn() };
});

vi.mock("../prisma-conversation-generated-file-workflow-repository", function _RepositoryModule()
{
	return { PrismaConversationGeneratedFileWorkflowRepository: class
	{
		/** Record exact transaction and dependency binding for this synthetic owner. */
		constructor(transaction: unknown, dependencies: unknown) { _repository.constructor(transaction, dependencies); }
		/** Delegate the observed load call to the test-owned result. */
		loadCurrent(input: unknown, task: unknown, now: unknown): unknown { return _repository.loadCurrent(input, task, now); }
	} };
});

/** Minimal complete snapshot returned by the transaction-scoped repository double. */
function _Snapshot(): GeneratedFileWorkflowSnapshot
{
	return { siloId: "silo-1", operationId: "operation-1", artifactId: "artifact-1", artifactRevisionId: "revision-1", uploadLeaseId: "lease-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 10, mediaType: "text/csv;charset=utf-8", notAfterEpochMs: Date.now() + 60_000, state: GeneratedFileWorkflowStates.PromotionRequired };
}

describe("PrismaConversationGeneratedFileWorkflowUnitOfWork", function _Suite()
{
	it("binds the repository to the exact serializable callback transaction", async function _BindsTransaction()
	{
		const transaction = { transaction: "exact" };
		const execute = vi.fn(async function _Execute(work: (value: unknown) => Promise<unknown>, options: unknown)
		{
			expect(options).toEqual(expect.objectContaining({ isolationLevel: "Serializable" }));
			return work(transaction);
		});
		const prisma = { $transaction: execute } as unknown as PrismaClient;
		const dependencies = {} as GeneratedFileWorkflowPersistenceDependencies;
		const unitOfWork = new PrismaConversationGeneratedFileWorkflowUnitOfWork(prisma, dependencies);
		const input = { siloId: "silo-1", operationId: "operation-1" };
		const task: IWorkflowTaskReceipt = { taskId: "task-1", taskName: "conversation-generated-file", idempotencyKey: "key-1" };
		const now = new Date("2026-09-13T12:00:00.000Z");
		const snapshot = _Snapshot();
		_repository.loadCurrent.mockResolvedValueOnce(snapshot);

		await expect(unitOfWork.loadCurrent(input, task, now)).resolves.toEqual(snapshot);
		expect(_repository.constructor).toHaveBeenCalledExactlyOnceWith(transaction, dependencies);
		expect(_repository.loadCurrent).toHaveBeenCalledExactlyOnceWith(input, task, now);
		expect(execute).toHaveBeenCalledOnce();
	});
});
