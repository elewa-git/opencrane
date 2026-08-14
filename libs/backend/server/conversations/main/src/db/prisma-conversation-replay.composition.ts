import type { PrismaClient } from "@prisma/client";

import { PrismaConversationReplayUnitOfWork } from "./prisma-conversation-replay-unit-of-work.js";
import type { ConversationReplayUnitOfWork } from "../replay-reader.types.js";

/**
 * Build the replay reader an app hands to a router.
 *
 * Returns the port type, not the class, so an app composition root never depends on Prisma or
 * on the transaction and query classes behind it — the streaming code sees only
 * {@link ConversationReplayUnitOfWork}.
 *
 * Called by: `_CreateSelfConversationReplayRouter`
 * (prisma-self-conversation-replay.router.ts) and
 * apps/opencrane/src/app/runtime-composition.ts.
 *
 * @param prisma - Client used to open one short transaction per page read.
 * @returns The replay reader, ready to pass as a router's `repository`.
 */
export function _CreateConversationReplayRepository(prisma: PrismaClient): ConversationReplayUnitOfWork
{
	return new PrismaConversationReplayUnitOfWork(prisma);
}
