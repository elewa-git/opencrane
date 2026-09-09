import type { OpenCraneHistoryStoreConfig } from "@opencrane/backend/server/infra/history-store";
import type { StandaloneFirstUserAdmissionConfig } from "@opencrane/backend/server/iam/identity";
import { OrganizationMembershipDeploymentModes, type StandaloneOrganizationMembershipConfig } from "@opencrane/backend/server/iam/organization-members";
import type { FleetOrganizationMembershipHttpClientConfig } from "@opencrane/backend/server/infra/organization-membership-gateway";

/**
 * Selects the sole authority for organisation directory, invitation, seat, and payment decisions.
 * The application composes one branch at startup, so request data cannot switch modes or trigger a
 * Fleet-to-standalone fallback.
 */
export type OpenCraneOrganizationMembershipConfig =
	| { readonly mode: OrganizationMembershipDeploymentModes.Standalone; readonly standalone: StandaloneOrganizationMembershipConfig }
	| { readonly mode: OrganizationMembershipDeploymentModes.Fleet; readonly fleet: FleetOrganizationMembershipHttpClientConfig };

/** Release-owned Agent Sandbox profile used for every 0.11 conversation computer. */
export interface AgentSandboxReleaseProfileConfig
{
	/** Immutable image digest that identifies the admitted profile revision. */
	readonly profileRevisionId: string;
	/** Profile name fixed by the release. */
	readonly profileName: string;
	/** Warm pool selected by server-created claims. */
	readonly warmPoolName: string;
	/** Namespace where the external Agent Sandbox controller accepts claims. */
	readonly namespace: string;
	/** ServiceAccount fixed on every conversation-computer Pod. */
	readonly serviceAccountName: string;
	/** Maximum lifetime of one fenced computer lease. */
	readonly leaseTtlMilliseconds: number;
	/** Hard per-turn LiteLLM spend ceiling in micro-US-dollars. */
	readonly maximumTurnCostUsdMicros: number;
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
	/** Namespace reserved for skill-authoring validation Jobs. */
	readonly skillAuthoringNamespace: string;
	/** Namespace containing the OpenCrane server and agent controller. */
	readonly serverNamespace: string;
	/** Silo that owns every OCI MCP runtime row served by this process. */
	readonly siloId: string;
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
	/** Per-service process capacity applied before personal run admission reaches PostgreSQL. */
	readonly runAdmission: RunAdmissionCapacityConfig;
	/** Namespace in which OIDC authentication resources are resolved. */
	readonly authWatchNamespace: string;
	/** Absolute path of the Secret-mounted conversation private-payload encryption keyring. */
	readonly conversationPrivatePayloadKeyringPath: string;
	/** TLS-only KurrentDB history connection settings frozen for this process. */
	readonly historyStore: OpenCraneHistoryStoreConfig;
	/** Port exposed only to platform workloads. */
	readonly internalPort: number;
	/** Workload-facing identity and dispatch configuration. */
	readonly runtime: InternalRuntimeConfig;
	/** Public ingress-facing API port. */
	readonly publicPort: number;
	/** Optional verified-email contract that can claim exactly one standalone-silo owner. */
	readonly standaloneFirstUserAdmission: StandaloneFirstUserAdmissionConfig | null;
	/** Durable control-plane task and MCP protocol-check settings. */
	readonly workflows: OpenCraneWorkflowConfig;
}

/** Process-local bounds that protect PostgreSQL from one service's admission burst. */
export interface RunAdmissionCapacityConfig
{
	/** Largest number of admissions for one silo and AgentService that may execute together. */
	readonly maxConcurrentAdmissions: number;
	/** Largest number of admissions for one silo and AgentService that may wait outside PostgreSQL. */
	readonly maxQueuedAdmissions: number;
}
