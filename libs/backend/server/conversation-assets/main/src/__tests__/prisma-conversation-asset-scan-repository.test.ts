import { ConversationAssetState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { ConversationAssetCleanPublicationDecisions, ConversationAssetScanLifecycleStates } from "@opencrane/backend/server/agents/artifacts";

import { GeneratedFileWorkflowStates } from "../agent-output/workflow/generated-file-workflow.types";
import { PrismaConversationAssetScanRepository } from "../prisma-conversation-asset-scan-repository";

const _NOW = new Date("2026-09-13T12:00:00.000Z");
const _OPERATION = { id: "operation-1", siloId: "silo-1", workflowTaskId: "task-1", workflowTaskName: "conversation-generated-file", workflowTaskKey: "operation-1" };

/** Build the scanner-facing transaction and current generated-file authority. */
function _Fixture(operation: typeof _OPERATION | null = _OPERATION)
{
	const transaction = {
		conversationGeneratedFile: { findUnique: vi.fn().mockResolvedValue(operation) },
		conversationAsset: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
	};
	const loadCurrent = vi.fn().mockResolvedValue({ state: GeneratedFileWorkflowStates.ScanPending });
	const emitTerminal = vi.fn().mockResolvedValue(undefined);
	const repository = new PrismaConversationAssetScanRepository(transaction as never, { loadCurrent, emitTerminal });
	return { transaction, loadCurrent, emitTerminal, repository };
}

describe("conversation asset scan lifecycle", function _Suite()
{
	it("leaves participant uploads on the existing scanner path", async function _ParticipantUpload()
	{
		const f = _Fixture(null);
		await expect(f.repository.beforeCleanPublication({ revisionId: "revision-1", now: _NOW })).resolves.toBe(ConversationAssetCleanPublicationDecisions.NotGenerated);
		expect(f.loadCurrent).not.toHaveBeenCalled();
	});

	it("admits only a currently authorized pending generated-file scan", async function _GeneratedCurrent()
	{
		const f = _Fixture();
		await expect(f.repository.beforeCleanPublication({ revisionId: "revision-1", now: _NOW })).resolves.toBe(ConversationAssetCleanPublicationDecisions.PublishGenerated);
		expect(f.loadCurrent).toHaveBeenCalledExactlyOnceWith({ operationId: "operation-1", siloId: "silo-1" }, { taskId: "task-1", taskName: "conversation-generated-file", idempotencyKey: "operation-1" }, _NOW);
	});

	it.each([null, { state: GeneratedFileWorkflowStates.Failed }])("denies generated publication after authority closes %#", async function _GeneratedDenied(current)
	{
		const f = _Fixture();
		f.loadCurrent.mockResolvedValue(current);
		await expect(f.repository.beforeCleanPublication({ revisionId: "revision-1", now: _NOW })).resolves.toBe(ConversationAssetCleanPublicationDecisions.Denied);
	});

	it("reports whether exactly one processing asset accepted the scanner verdict", async function _ExactReport()
	{
		const f = _Fixture();
		await expect(f.repository.report({ revisionId: "revision-1", state: ConversationAssetScanLifecycleStates.Ready, failureCode: null })).resolves.toBe(true);
		expect(f.transaction.conversationAsset.updateMany).toHaveBeenCalledWith({ where: { revisionId: "revision-1", state: ConversationAssetState.Processing }, data: { state: ConversationAssetState.Ready, failureCode: null } });
		f.transaction.conversationAsset.updateMany.mockResolvedValue({ count: 0 });
		await expect(f.repository.report({ revisionId: "revision-1", state: ConversationAssetScanLifecycleStates.Ready, failureCode: null })).resolves.toBe(false);
	});
	it("saves the generated operation wake through its transaction-bound owner", async function _NotifyGeneratedOutcome()
	{
		const f = _Fixture();
		await f.repository.afterScanSettlement("revision-1");
		expect(f.transaction.conversationGeneratedFile.findUnique).toHaveBeenCalledExactlyOnceWith({ where: { revisionId: "revision-1" }, select: { id: true } });
		expect(f.emitTerminal).toHaveBeenCalledExactlyOnceWith("operation-1");
		expect(f.loadCurrent).not.toHaveBeenCalled();
	});

	it("leaves participant-upload settlement with no generated task event", async function _NoGeneratedWake()
	{
		const f = _Fixture(null);
		await f.repository.afterScanSettlement("revision-1");
		expect(f.emitTerminal).not.toHaveBeenCalled();
	});

	it("fails closed when generated-file settlement has no workflow owner", async function _MissingGeneratedOwner()
	{
		const f = _Fixture();
		const repository = new PrismaConversationAssetScanRepository(f.transaction as never);
		await expect(repository.afterScanSettlement("revision-1")).rejects.toThrow("notifications are not configured");
	});

});
