import { ConversationAssetState, type Prisma } from "@prisma/client";

import { ConversationAssetCleanPublicationDecisions, ConversationAssetScanLifecycleStates, type ConversationAssetScanLifecycleRepository } from "@opencrane/backend/server/agents/artifacts";
import type { GeneratedFileScanAuthority } from "./conversation-asset-scan.types";
import { GeneratedFileWorkflowStates } from "./agent-output/workflow/generated-file-workflow.types";

/** Applies scanner verdicts to uploaded and generated conversation assets. */
export class PrismaConversationAssetScanRepository implements ConversationAssetScanLifecycleRepository
{
	/** Keep asset updates and task wakes on the scanner's transaction. */
	private readonly transaction: Prisma.TransactionClient;
	/** Rechecks generated-file authority and records its completed outcome. */
	private readonly generatedFiles: GeneratedFileScanAuthority | null;

	/** Binds scanner updates to the caller-owned artifact transaction. */
	constructor(transaction: Prisma.TransactionClient, generatedFiles: GeneratedFileScanAuthority | null = null)
	{
		this.transaction = transaction;
		this.generatedFiles = generatedFiles;
	}

	/** Recheck one generated operation before a clean scan publishes its quarantined revision. */
	async beforeCleanPublication(command: { readonly revisionId: string; readonly now: Date }): Promise<ConversationAssetCleanPublicationDecisions>
	{
		const operation = await this.transaction.conversationGeneratedFile.findUnique({
			where: { revisionId: command.revisionId },
			select: { id: true, siloId: true, workflowTaskId: true, workflowTaskName: true, workflowTaskKey: true },
		});
		if (operation === null)
			return ConversationAssetCleanPublicationDecisions.NotGenerated;
		if (this.generatedFiles === null)
			throw new Error("Generated-file scan authority is not configured");
		const task = { taskId: operation.workflowTaskId, taskName: operation.workflowTaskName, idempotencyKey: operation.workflowTaskKey };
		const current = await this.generatedFiles.loadCurrent({ operationId: operation.id, siloId: operation.siloId }, task, command.now);
		if (current === null || current.state === GeneratedFileWorkflowStates.Failed)
			return ConversationAssetCleanPublicationDecisions.Denied;
		if (current.state !== GeneratedFileWorkflowStates.ScanPending)
			throw new Error("Generated-file scan publication requires pending scan state");
		return ConversationAssetCleanPublicationDecisions.PublishGenerated;
	}

	/** Moves one quarantined conversation asset to the scanner-selected terminal state. */
	async report(command: { readonly revisionId: string; readonly state: ConversationAssetScanLifecycleStates; readonly failureCode: "unsafe_file" | "scan_failed" | null }): Promise<boolean>
	{
		const state = command.state === ConversationAssetScanLifecycleStates.Ready ? ConversationAssetState.Ready : ConversationAssetState.Failed;
		const changed = await this.transaction.conversationAsset.updateMany({
			where: { revisionId: command.revisionId, state: ConversationAssetState.Processing },
			data: { state, failureCode: command.failureCode },
		});
		return changed.count === 1;
	}

	/** Wake the generated-file task and parent turn after their complete scan outcome is readable. */
	async afterScanSettlement(revisionId: string): Promise<void>
	{
		const operation = await this.transaction.conversationGeneratedFile.findUnique({ where: { revisionId }, select: { id: true } });
		if (operation === null)
			return;
		if (this.generatedFiles === null)
			throw new Error("Generated-file scan notifications are not configured");
		await this.generatedFiles.emitTerminal(operation.id);
	}
}
