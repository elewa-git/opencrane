import type { Express } from "express";

import type { ProviderEffectCommandExecutor } from "@opencrane/backend/server/gateways/providers";
import type { IWorkflowWorkerRuntime } from "@opencrane/backend/server/infra/workflows/contract";

import type { OpenCraneHistoryStoreComposition } from "../app/history-store-composition.types";
import type { ___CreatePrismaClient } from "../infra/db/db";

/** Product database client returned by the application-owned Prisma adapter. */
type DevelopmentPrismaClient = ReturnType<typeof ___CreatePrismaClient>;

/** Current Tier 2 public server and the process-owned dependencies it must drain. */
export interface DevelopmentServerComposition
{
	/** Current authenticated product route tree bound to the loopback development identity. */
	readonly app: Express;
	/** TLS KurrentDB client and HistoryStore shared by current conversation authorities. */
	readonly historyStore: OpenCraneHistoryStoreComposition;
	/** Workstation conversation-computer owner selected by Agent profiles. */
	readonly conversationComputer: DevelopmentConversationComputerSupervisor | null;
	/** Current product database created from the clean target baseline. */
	readonly prisma: DevelopmentPrismaClient;
	/** Post-commit provider effect executor retained by current product routes. */
	readonly providerEffects: ProviderEffectCommandExecutor;
	/** Durable workflow worker runtime shared by current product routes. */
	readonly workflowRuntime: IWorkflowWorkerRuntime;
}

/** Process-owned stop handle used by the coordinator and signal boundary. */
export interface DevelopmentServerHandle
{
	/** Drain the listener, workers, history transport, and database exactly once. */
	readonly stop: () => Promise<void>;
}

/** Current Conversation Computer supervisor required by every Tier 2 Agent profile. */
export interface DevelopmentConversationComputerSupervisor
{
	/** Starts the current supervisor and returns the cleanup handle for its listener and child processes. */
	readonly start: () => Promise<{ readonly stop: () => Promise<void> }>;
}
