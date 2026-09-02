import type { PrismaClient } from "@prisma/client";

import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";

import { ConversationHistoryReader } from "../conversation-history-reader";
import type { ConversationPrivatePayloadStore } from "../conversation-private-payload-store.types";
import type { ConversationReplayUnitOfWork } from "../replay-reader.types";
import { PrismaConversationHistoryReplayUnitOfWork } from "./prisma-conversation-history-replay-unit-of-work";

/** Builds the history-backed replay port that public transports use after the AgentSession cutover. */
export function _CreateConversationHistoryReplayRepository(prisma: PrismaClient, historyStore: Pick<HistoryStore, "readHead" | "readStream">, payloads: Pick<ConversationPrivatePayloadStore, "readText">): ConversationReplayUnitOfWork
{
	return new PrismaConversationHistoryReplayUnitOfWork(prisma, new ConversationHistoryReader(historyStore), payloads);
}
