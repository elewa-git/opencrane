import type { Prisma } from "@prisma/client";

import { PrismaConversationAttachmentAdmissionRepository } from "./prisma-conversation-attachment-admission.js";

/** Creates attachment admission on message/run admission's exact transaction. */
export function _CreateConversationAttachmentAdmission(transaction: { readonly prisma: Prisma.TransactionClient }): PrismaConversationAttachmentAdmissionRepository
{
	return new PrismaConversationAttachmentAdmissionRepository(transaction.prisma);
}
