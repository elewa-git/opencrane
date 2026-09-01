import type { StandaloneFirstUserAdmissionConfig } from "@opencrane/backend/server/iam/identity";
import { OrganizationMembershipDeploymentModes, type StandaloneOrganizationMembershipConfig } from "@opencrane/backend/server/iam/organization-members";
import type { FleetOrganizationMembershipHttpClientConfig } from "@opencrane/backend/server/infra/organization-membership-gateway";

/** TLS-only KurrentDB coordinates owned by the HistoryStore deployment boundary. */
export interface OpenCraneHistoryStoreConfig
{
	/** File path of the mounted KurrentDB certificate authority bundle. */
	readonly caCertificatePath: string;
	/** Silo-local KurrentDB host and port without a scheme or credentials. */
	readonly endpoint: string;
	/** File path of the mounted least-privilege KurrentDB service password. */
	readonly passwordPath: string;
	/** File path of the mounted least-privilege KurrentDB service username. */
	readonly usernamePath: string;
}

/**
 * Selects the sole authority for organisation directory, invitation, seat, and payment decisions.
 * The application composes one branch at startup, so request data cannot switch modes or trigger a
 * Fleet-to-standalone fallback.
 */
export type OpenCraneOrganizationMembershipConfig =
	| { readonly mode: OrganizationMembershipDeploymentModes.Standalone; readonly standalone: StandaloneOrganizationMembershipConfig }
	| { readonly mode: OrganizationMembershipDeploymentModes.Fleet; readonly fleet: FleetOrganizationMembershipHttpClientConfig };

/** The channel resolver and replay receiver settings fixed by the deployment. */
export interface ChannelTargetRuntimeConfig
{
	readonly channelProxyServiceAccountName: string;
	readonly invocationContextTtlMilliseconds: number;
	readonly receiverEndpoint: string;
	readonly receiverId: string;
	readonly siloId: string;
	readonly trustedHost: string;
}

/**
 * Names the release-owned Agent Sandbox resources admitted for one immutable computer profile revision.
 *
 * Conversation history stores `profileRevisionId`; the mounted release map resolves that identifier
 * without allowing a queue delivery or a database row to choose a Sandbox profile.
 */
export interface ConversationComputerActivationProfileConfig
{
	/** Names the immutable ConversationComputer profile revision fixed in history. */
	readonly profileRevisionId: string;
	/** Names the namespace containing the release-owned Agent Sandbox resources. */
	readonly namespace: string;
	/** Names the Agent Sandbox profile admitted for this immutable revision. */
	readonly sandboxProfile: string;
	/** Names the release-owned warm pool paired with the sandbox profile. */
	readonly warmPoolName: string;
}

/**
 * Freezes the file-backed profile contract used by the ConversationComputer activation worker.
 *
 * A missing config disables the optional Agent Sandbox activation plane. A configured map must
 * contain every history-bound profile revision this release intends to realize.
 */
export interface ConversationComputerActivationConfig
{
	/** Lists every immutable computer profile revision the release admits to Agent Sandbox. */
	readonly profiles: readonly ConversationComputerActivationProfileConfig[];
}

/** Settings read once at startup, used to compose workload identity, workflow-controller, and worker routes. */
export interface InternalRuntimeConfig
{
	/** Whether the restricted artifact-scanner plane is enabled. */
	readonly artifactScannerEnabled: boolean;
	/** Complete duration allowed for download, scan, and result reporting. */
	readonly artifactScannerClaimLeaseMilliseconds: number;
	/** Namespace reserved for artifact-scanner Pods when enabled. */
	readonly artifactScannerNamespace: string | undefined;
	/** Whether the restricted artifact-preprocessor plane is enabled. */
	readonly artifactPreprocessorEnabled: boolean;
	/** Maximum accepted and promoted artifact-preprocessor output size. */
	readonly artifactPreprocessorMaximumOutputBytes: number;
	/** Namespace reserved for artifact-preprocessor Pods when enabled. */
	readonly artifactPreprocessorNamespace: string | undefined;
	/** Complete resolver and replay configuration, or null when the channel boundary is disabled. */
	readonly channelTargets: ChannelTargetRuntimeConfig | null;
	/** Release-owned profile map used to realize durable ConversationComputer activation commands, when this target plane is enabled. */
	readonly conversationComputerActivation: ConversationComputerActivationConfig | null;
	/** Maximum age of a runtime command before it is refused. */
	readonly commandTtlMilliseconds: number;
	/** Delay before recovering an unacknowledged runtime command. */
	readonly commandRecoveryMilliseconds: number;
	/** Absolute path of the Secret-mounted rotating continuation encryption keyring. */
	readonly continuationKeyringPath: string;
	/** Namespace containing the managed-agent warm Pod pool. */
	readonly managedRuntimeNamespace: string | undefined;
	/** Lease held by one Pod-bound companion command claim. */
	readonly mcpCompanionClaimLeaseMilliseconds: number;
	/** Lease held by one controller claim or release delivery. */
	readonly mcpControllerClaimLeaseMilliseconds: number;
	/** Namespace reserved for OCI MCP executor Jobs. */
	readonly mcpExecutorNamespace: string | undefined;
	/** Hard timeout applied to every memory-gateway HTTP exchange. */
	readonly memoryGatewayTimeoutMilliseconds: number;
	/** Absolute path of the projected audience-bound memory-gateway caller token. */
	readonly memoryGatewayTokenPath: string;
	/** Release-local private memory-gateway origin; the client validates its exact shape. */
	readonly memoryGatewayUrl: string;
	/** Namespace containing the personal-agent warm Pod pool. */
	readonly personalRuntimeNamespace: string | undefined;
	/** Namespace reserved for skill-authoring validation Jobs. */
	readonly skillAuthoringNamespace: string;
	/** Namespace containing the OpenCrane server and agent controller. */
	readonly serverNamespace: string;
	/** Silo that owns every OCI MCP runtime row served by this process. */
	readonly siloId: string;
	/** Lifetime of one durable runtime assignment. */
	readonly assignmentTtlMilliseconds: number;
}

/** Settings for durable control-plane tasks and the remote MCP protocol check. */
export interface OpenCraneWorkflowConfig
{
	/** PostgreSQL URL shared by product writes and Absurd task admission. */
	readonly databaseUrl: string;
	/** Maximum number of database connections reserved for Absurd. */
	readonly databasePoolSize: number;
	/** Largest accepted response body from a remote MCP server. */
	readonly mcpEraProbeMaximumResponseBytes: number;
	/** Hard timeout for one remote MCP protocol check. */
	readonly mcpEraProbeTimeoutMilliseconds: number;
	/** Optional absolute path whose current contents authorize the configured OCI registry. */
	readonly ociRegistryAuthorizationFilePath: string | undefined;
	/** HTTPS origin of the registry that stores admitted OCI images. */
	readonly ociRegistryBaseUrl: string;
	/** Fixed repository below the registry origin used for admitted MCP images. */
	readonly ociRegistryRepository: string;
	/** Hard timeout applied separately to each OCI registry request. */
	readonly ociRegistryTimeoutMilliseconds: number;
	/** Delay between checks for newly admitted durable tasks. */
	readonly pollIntervalMilliseconds: number;
	/** Silo that owns every task admitted by this server process. */
	readonly siloId: string;
	/** Maximum number of durable tasks handled in parallel. */
	readonly workerConcurrency: number;
}

/** Process-owned settings that shape the OpenCrane server lifecycle. */
export interface OpenCraneProcessConfig
{
	/** Namespace in which OIDC authentication resources are resolved. */
	readonly authWatchNamespace: string;
	/** TLS-only KurrentDB history connection settings frozen for this process. */
	readonly historyStore: OpenCraneHistoryStoreConfig;
	/** Port exposed only to platform workloads. */
	readonly internalPort: number;
	/** Workload-facing identity and dispatch configuration. */
	readonly runtime: InternalRuntimeConfig;
	/** Public ingress-facing API port. */
	readonly publicPort: number;
	/** Whether the managed-agent schedule loop should run. */
	readonly schedulerEnabled: boolean;
	/** Delay between managed-agent schedule passes. */
	readonly schedulerIntervalMilliseconds: number;
	/** Optional verified-email contract that can claim exactly one standalone-silo owner. */
	readonly standaloneFirstUserAdmission: StandaloneFirstUserAdmissionConfig | null;
	/** Durable control-plane task and MCP protocol-check settings. */
	readonly workflows: OpenCraneWorkflowConfig;
}
