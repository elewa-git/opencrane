import type { ProviderEffectCommandExecutor } from "@opencrane/backend/server/gateways/providers";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import type { PublicHealthReportReader } from "@opencrane/backend/server/infra/http";

import type { ConversationComputerReleaseProfileConfig } from "../app/config.types";
import type { McpWorkflowComposition } from "../app/mcp-workflow-composition.types";
import type { OrganizationMembersComposition } from "../app/organization-members-composition.types";
import type { ___CreatePrismaClient } from "../infra/db/db";

/** Product database client returned by the application-owned Prisma adapter. */
type DevelopmentPrismaClient = ReturnType<typeof ___CreatePrismaClient>;

/** Current product-route dependencies supplied by the Tier 2 process composition. */
export interface DevelopmentPublicAppDependencies
{
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
	/** Loopback-only standalone membership routes with development invitation links. */
	readonly organizationMembers: OrganizationMembersComposition;
	/** Current product profile used as the local admission ceiling. */
	readonly profile: ConversationComputerReleaseProfileConfig;
	/** Product database created from the clean target baseline. */
	readonly prisma: DevelopmentPrismaClient;
	/** Current provider effect executor selected by the local profile. */
	readonly providerEffects: ProviderEffectCommandExecutor;
}
