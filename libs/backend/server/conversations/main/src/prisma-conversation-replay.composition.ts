import type { PrismaClient } from "@prisma/client";

import { PrismaConversationReplayUnitOfWork } from "./prisma-conversation-replay-unit-of-work.js";
import type { ConversationReplayUnitOfWork } from "./replay-reader.types.js";

/** Composes the stable replay reader surface over its transaction-owning Prisma adapter. */
export function _CreateConversationReplayRepository(prisma: PrismaClient): ConversationReplayUnitOfWork
{
	return new PrismaConversationReplayUnitOfWork(prisma);
}
