import type { ConversationComputerCredentialIssuer, ConversationComputerModelTransport, ConversationComputerRealizer, ConversationComputerRunAdmissionPort, ConversationToolProposalRuntimeAdmission } from "@opencrane/backend/server/conversations";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";

import type { ___CreatePrismaClient } from "../infra/db/db";

type OpenCranePrismaClient = ReturnType<typeof ___CreatePrismaClient>;

/** Supplies the realization-neutral authorities needed to compose conversation-computer turns. */
export interface ConversationComputerTurnAuthorityCompositionOptions
{
	readonly credentials: ConversationComputerCredentialIssuer;
	readonly endpoint: string;
	readonly history: HistoryStore;
	readonly keyringPath: string;
	readonly maximumTurnCostUsdMicros: number;
	readonly model: ConversationComputerModelTransport;
	readonly prisma: OpenCranePrismaClient;
	readonly realizer: ConversationComputerRealizer;
	readonly runAdmission: ConversationComputerRunAdmissionPort;
	readonly runtimeAdmission: ConversationToolProposalRuntimeAdmission;
	readonly siloId: string;
}
