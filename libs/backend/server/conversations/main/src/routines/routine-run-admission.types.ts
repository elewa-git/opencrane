import type { Prisma, PrismaClient } from "@prisma/client";

import type { RoutineOccurrenceRunAdmissionRepositoryFactory } from "@opencrane/backend/server/agents/scheduling/contract";
import type { ConversationPrivatePayloadCipher } from "@opencrane/backend/server/conversations/history";
import type { HumanMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

import type { RoutineOccurrenceHistory } from "./routine-occurrence-history";

/** Existing owners needed to admit a routine run and its turn task atomically. */
export interface RoutineRunAdmissionDependencies
{
	/** Run admission owns transactions on this product database. */
	readonly prisma: PrismaClient;
	/** Scheduling supplies its authority without exposing its database delegates. */
	readonly routines: RoutineOccurrenceRunAdmissionRepositoryFactory<Prisma.TransactionClient>;
	/** Validates the immutable service instruction and its original requester. */
	readonly occurrences: Pick<RoutineOccurrenceHistory, "readRecord">;
	/** Supplies current managed identity and computer history. */
	readonly history: HistoryStore;
	/** Decrypts the attested instruction inside the final compilation transaction. */
	readonly cipher: ConversationPrivatePayloadCipher;
	/** Current membership freshness policy, selected by deployment. */
	readonly membership: HumanMembershipEvidenceConfig;
	/** Spawns the existing turn task using the run owner's transaction. */
	readonly workflows: Pick<IWorkflowEngine, "spawn">;
}
