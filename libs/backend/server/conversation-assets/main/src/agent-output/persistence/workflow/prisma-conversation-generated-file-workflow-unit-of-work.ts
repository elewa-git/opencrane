import type { PrismaClient } from "@prisma/client";

import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import type { GeneratedFilePromotionAuthorityCommand, GeneratedFilePromotionAuthorityEvidence } from "../../promotion/generated-file-promotion.types";
import type { GeneratedFilePromotionReceipt, GeneratedFileQuarantineOutcomes, GeneratedFileWorkflowSnapshot } from "../../workflow/generated-file-workflow.types";
import type { ConversationGeneratedFileTaskInput } from "../generated-file-capture.types";
import type { GeneratedFileWorkflowPersistenceDependencies, GeneratedFileWorkflowUnitOfWork } from "./generated-file-workflow-persistence.types";
import { PrismaConversationGeneratedFileWorkflowRepository } from "./prisma-conversation-generated-file-workflow-repository";

/** Opens one serializable transaction per generated-file workflow or promotion authority step. */
export class PrismaConversationGeneratedFileWorkflowUnitOfWork implements GeneratedFileWorkflowUnitOfWork
{
	/** Create fresh transaction-bound owners for every complete retry attempt. */
	constructor(private readonly prisma: PrismaClient, private readonly dependencies: GeneratedFileWorkflowPersistenceDependencies) {}

	/** Reload current operation state and authority in one bounded transaction. */
	loadCurrent(input: ConversationGeneratedFileTaskInput, task: IWorkflowTaskReceipt, now: Date): Promise<GeneratedFileWorkflowSnapshot | null>
	{
		const dependencies = this.dependencies;
		return ___RunInPrismaUnitOfWork(this.prisma, async function _LoadCurrent(transaction)
		{
			const repository = new PrismaConversationGeneratedFileWorkflowRepository(transaction, dependencies);
			return repository.loadCurrent(input, task, now);
		}, { isolationLevel: "Serializable", operation: "load generated file workflow state", attemptLimit: 3 });
	}

	/** Open verified custody only inside the transaction that rechecks current authority. */
	openVerifiedBytes(snapshot: GeneratedFileWorkflowSnapshot, task: IWorkflowTaskReceipt, now: Date): Promise<Uint8Array | null>
	{
		const dependencies = this.dependencies;
		return ___RunInPrismaUnitOfWork(this.prisma, async function _OpenVerifiedBytes(transaction)
		{
			const repository = new PrismaConversationGeneratedFileWorkflowRepository(transaction, dependencies);
			return repository.openVerifiedBytes(snapshot, task, now);
		}, { isolationLevel: "Serializable", operation: "open generated file custody", attemptLimit: 3 });
	}

	/** Commit quarantine receipt and asset progression as one serializable change. */
	finalizeQuarantine(snapshot: GeneratedFileWorkflowSnapshot, task: IWorkflowTaskReceipt, receipt: GeneratedFilePromotionReceipt, now: Date): Promise<GeneratedFileQuarantineOutcomes>
	{
		const dependencies = this.dependencies;
		return ___RunInPrismaUnitOfWork(this.prisma, async function _FinalizeQuarantine(transaction)
		{
			const repository = new PrismaConversationGeneratedFileWorkflowRepository(transaction, dependencies);
			return repository.finalizeQuarantine(snapshot, task, receipt, now);
		}, { isolationLevel: "Serializable", operation: "finalize generated file quarantine", attemptLimit: 3 });
	}

	/** Recheck the exact original fixed lease immediately before Artifact transfer. */
	admitCurrent(command: GeneratedFilePromotionAuthorityCommand, now: Date): Promise<GeneratedFilePromotionAuthorityEvidence | null>
	{
		const dependencies = this.dependencies;
		return ___RunInPrismaUnitOfWork(this.prisma, async function _AdmitPromotion(transaction)
		{
			const repository = new PrismaConversationGeneratedFileWorkflowRepository(transaction, dependencies);
			return repository.admitCurrent(command, now);
		}, { isolationLevel: "Serializable", operation: "admit generated file promotion", attemptLimit: 3 });
	}
}
