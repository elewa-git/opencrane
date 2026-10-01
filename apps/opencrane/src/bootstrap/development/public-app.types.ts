import type { ProviderEffectCommandExecutor } from "@opencrane/backend/server/gateways/providers";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import type { PublicHealthReportReader } from "@opencrane/backend/server/infra/http";

import type { ConversationComputerReleaseProfileConfig } from "../configuration/config.types";
import type { PersonalMemoryWorkflowCompositionOptions } from "../conversations/personal-memory-operation-workflow-composition.types";
import type { McpWorkflowComposition } from "../workflows/mcp-workflow-composition.types";
import type { OrganizationMembersComposition } from "../http/organization-members-composition.types";
import type { ___CreatePrismaClient } from "@opencrane/backend/server/infra/prisma-unit-of-work";

/** Product database client returned by the application-owned Prisma adapter. */
type DevelopmentPrismaClient = ReturnType<typeof ___CreatePrismaClient>;

/** Current product-route dependencies supplied by the Tier 2 process composition. */
export interface DevelopmentPublicAppDependencies
{
	/** Exact browser origin allowed through the development session boundary. */
	readonly browserOrigin: string;
	/** Whether the local profile starts an artifact scanner consumer. */
	readonly artifactScannerEnabled: boolean;
	/** Per-launch browser credential read from an owner-only coordinator file. */
	readonly browserSessionCredential: string;
	/** Path to the local private-payload keyring used by current conversation history. */
	readonly conversationPrivatePayloadKeyringPath: string;
	/** Current KurrentDB HistoryStore used by conversation and computer authorities. */
	readonly historyStore: HistoryStore;
	/** Public-safe readiness projection for the selected local services. */
	readonly health: PublicHealthReportReader;
	/** Current durable workflow composition shared with product route admission. */
	readonly mcpWorkflows: McpWorkflowComposition;
	/** Unavailable local memory gateway retained behind the current workflow port. */
	readonly memoryWorkflow: PersonalMemoryWorkflowCompositionOptions;
	/** Loopback-only standalone membership routes with development invitation links. */
	readonly organizationMembers: OrganizationMembersComposition;
	/** Current product profile used as the local admission ceiling. */
	readonly profile: ConversationComputerReleaseProfileConfig;
	/** Product database created from the clean target baseline. */
	readonly prisma: DevelopmentPrismaClient;
	/** Current provider effect executor selected by the local profile. */
	readonly providerEffects: ProviderEffectCommandExecutor;
}
