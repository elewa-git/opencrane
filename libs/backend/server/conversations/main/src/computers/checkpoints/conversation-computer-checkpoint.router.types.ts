import type { RuntimeTokenReviewer } from "@opencrane/backend/server/infra/workload-identity";

import type { ConversationComputerCheckpointRestoreCommand, ConversationComputerCheckpointRestoreResult } from "./conversation-computer-checkpoint.types";

/** Restores current checkpoint bytes after the router supplies TokenReviewed Pod identity. */
export interface ConversationComputerCheckpointRestorer
{
	/** Rechecks history, reads the exact revision, and streams it into the sandbox. */
	restore(command: ConversationComputerCheckpointRestoreCommand): Promise<ConversationComputerCheckpointRestoreResult | null>;
}

/** Fixed silo and projected-token dependencies for the private restore route. */
export interface ConversationComputerCheckpointRouterOptions
{
	/** Verifies the projected Pod token, audience, namespace, and ServiceAccount. */
	readonly tokenReviewer: RuntimeTokenReviewer;
	/** Prevents request input from selecting another organisation. */
	readonly siloId: string;
	/** Executes exact-revision restoration after authentication. */
	readonly authority: ConversationComputerCheckpointRestorer;
}
