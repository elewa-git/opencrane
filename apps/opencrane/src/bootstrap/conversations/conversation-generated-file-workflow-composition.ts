import type { Prisma, PrismaClient } from "@prisma/client";

import { _CreateArtifactServicePromotionPort, _CreateArtifactUploadCryptoPort, _InternalArtifactServiceUrl, PrismaArtifactQuarantineRepository } from "@opencrane/backend/server/agents/artifacts";
import { _RegisterConversationGeneratedFileWorkflow, GeneratedFileArtifactPromotionPort, PrismaConversationGeneratedFileOutputLinkUnitOfWork, PrismaConversationGeneratedFileResultRepository, PrismaConversationAssetScanRepository, PrismaConversationGeneratedFileWorkflowRepository, PrismaConversationGeneratedFileWorkflowUnitOfWork, type GeneratedFileWorkflowPersistenceDependencies } from "@opencrane/backend/server/conversation-assets";
import { KurrentConversationComputerTurnStore, PrismaConversationComputerTurnWorkflowEventRepository, PrismaConversationToolDispatchAuthority } from "@opencrane/backend/server/conversations";
import { AesGcmConversationPrivatePayloadCipher, _ReadConversationPrivatePayloadKeyring } from "@opencrane/backend/server/conversations/history";
import type { McpToolInvocationTransactionParticipantFactory } from "@opencrane/backend/server/iam/authorization";
import { _CreateHumanMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

import { _CreateConversationToolDispatchDependencies } from "../workflows/mcp-runtime-composition";
import type { ConversationGeneratedFileWorkflowComposition } from "./conversation-generated-file-workflow-composition.types";

/** Registers generated-file progression and shares its current-authority checks with the scanner. */
export function _CreateConversationGeneratedFileWorkflowComposition(prisma: PrismaClient, history: HistoryStore, keyringPath: string, toolInvocations: McpToolInvocationTransactionParticipantFactory, workflows: IWorkflowEngine): ConversationGeneratedFileWorkflowComposition
{
	const custodyCipher = AesGcmConversationPrivatePayloadCipher.fromDocument(_ReadConversationPrivatePayloadKeyring(keyringPath));
	const dispatchDependencies = _CreateConversationToolDispatchDependencies(history, _CreateHumanMembershipEvidenceConfig());
	const dependencies: GeneratedFileWorkflowPersistenceDependencies = {
		custodyCipher, toolInvocations, workflows,
		artifactQuarantine: function _Quarantine(transaction)
		{
			return new PrismaArtifactQuarantineRepository(transaction as Prisma.TransactionClient);
		},
		conversationAdmission: function _ConversationAdmission(transaction)
		{
			return new PrismaConversationToolDispatchAuthority(transaction as Prisma.TransactionClient, dispatchDependencies);
		},
		turnEvents: function _TurnEvents(transaction)
		{
			const events = new PrismaConversationComputerTurnWorkflowEventRepository(transaction as Prisma.TransactionClient, workflows);
			return { emit: events.emitGeneratedFile.bind(events) };
		},
	};
	const persistence = new PrismaConversationGeneratedFileWorkflowUnitOfWork(prisma, dependencies);
	const service = _CreateArtifactServicePromotionPort(_InternalArtifactServiceUrl(process.env.ARTIFACT_SERVICE_URL ?? ""));
	const promotion = new GeneratedFileArtifactPromotionPort(persistence, service, _CreateArtifactUploadCryptoPort());
	_RegisterConversationGeneratedFileWorkflow(workflows, { persistence, promotion });
	/** Share one transaction-bound file reader between continuation and saved-output linkage. */
	function _ResultReader(transaction: unknown)
	{
		const currentTransaction = transaction as Prisma.TransactionClient;
		const generatedFiles = new PrismaConversationGeneratedFileWorkflowRepository(currentTransaction, dependencies);
		return new PrismaConversationGeneratedFileResultRepository(currentTransaction, generatedFiles);
	}
	const turns = new KurrentConversationComputerTurnStore(history);
	const outputLinker = new PrismaConversationGeneratedFileOutputLinkUnitOfWork(prisma, turns, _ResultReader, dispatchDependencies);
	return {
		resultReader: _ResultReader, outputLinker,
		scanAssets(transaction)
		{
			const generatedFiles = new PrismaConversationGeneratedFileWorkflowRepository(transaction, dependencies);
			return new PrismaConversationAssetScanRepository(transaction, generatedFiles);
		},
	};
}
