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

/** Registers generated-file processing and returns the adapters used by tool results, output linkage and scanning. */
export function _CreateConversationGeneratedFileWorkflowComposition(prisma: PrismaClient, history: HistoryStore, keyringPath: string, toolInvocations: McpToolInvocationTransactionParticipantFactory, workflows: IWorkflowEngine): ConversationGeneratedFileWorkflowComposition
{
	const custodyCipher = AesGcmConversationPrivatePayloadCipher.fromDocument(_ReadConversationPrivatePayloadKeyring(keyringPath));
	const dispatchDependencies = _CreateConversationToolDispatchDependencies(history, _CreateHumanMembershipEvidenceConfig());
	// These factories bind quarantine, admission checks and turn wake-ups to each caller's database transaction.
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
	// The workflow and artifact promotion share persistence, including the current conversation admission checks.
	const persistence = new PrismaConversationGeneratedFileWorkflowUnitOfWork(prisma, dependencies);
	const service = _CreateArtifactServicePromotionPort(_InternalArtifactServiceUrl(process.env.ARTIFACT_SERVICE_URL ?? ""));
	const promotion = new GeneratedFileArtifactPromotionPort(persistence, service, _CreateArtifactUploadCryptoPort());
	_RegisterConversationGeneratedFileWorkflow(workflows, { persistence, promotion });
	/** Builds the same file reader for tool-result continuation and output linkage inside each caller's transaction. */
	function _ResultReader(transaction: unknown)
	{
		const currentTransaction = transaction as Prisma.TransactionClient;
		const generatedFiles = new PrismaConversationGeneratedFileWorkflowRepository(currentTransaction, dependencies);
		return new PrismaConversationGeneratedFileResultRepository(currentTransaction, generatedFiles);
	}
	// Linkage reloads the saved turn and rechecks dispatch authority before attaching generated files to its output.
	const turns = new KurrentConversationComputerTurnStore(history);
	const outputLinker = new PrismaConversationGeneratedFileOutputLinkUnitOfWork(prisma, turns, _ResultReader, dispatchDependencies);
	return {
		resultReader: _ResultReader, outputLinker,
		/** Keeps generated-file authority checks, scan outcomes and workflow wake-ups on the scanner's transaction. */
		scanAssets(transaction)
		{
			const generatedFiles = new PrismaConversationGeneratedFileWorkflowRepository(transaction, dependencies);
			return new PrismaConversationAssetScanRepository(transaction, generatedFiles);
		},
	};
}
