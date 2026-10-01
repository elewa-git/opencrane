import type { Prisma } from "@prisma/client";

import type { ConversationToolExecutionAdmissionAuthority } from "@opencrane/backend/server/conversations";
import type { ConversationPrivatePayloadCipher } from "@opencrane/backend/server/conversations/history";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

import { ConversationGeneratedFileResultParticipant } from "./conversation-generated-file-result-participant";
import { PrismaConversationGeneratedFileCaptureRepository } from "./prisma-conversation-generated-file-capture-repository";

/** Bind generated-resource capture to the exact transaction used by MCP and IAM completion. */
export function _CreateConversationGeneratedFileResultParticipant(transaction: Prisma.TransactionClient, cipher: ConversationPrivatePayloadCipher, workflows: Pick<IWorkflowEngine, "spawn">, dispatch: ConversationToolExecutionAdmissionAuthority, scannerEnabled: boolean): ConversationGeneratedFileResultParticipant
{
	return new ConversationGeneratedFileResultParticipant(function _Capture(currentExecution)
	{
		return new PrismaConversationGeneratedFileCaptureRepository(transaction, cipher, workflows, currentExecution);
	}, dispatch, scannerEnabled);
}
