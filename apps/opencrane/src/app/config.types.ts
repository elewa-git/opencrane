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

/** Settings read once at startup, used to compose workload identity, dispatch, and worker routes. */
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
	/** Maximum time a controller claim remains valid. */
	readonly claimLeaseMilliseconds: number;
	/** Complete resolver and replay configuration, or null when the channel boundary is disabled. */
	readonly channelTargets: ChannelTargetRuntimeConfig | null;
	/** Maximum age of a runtime command before it is refused. */
	readonly commandTtlMilliseconds: number;
	/** Delay before recovering an unacknowledged runtime command. */
	readonly commandRecoveryMilliseconds: number;
	/** Namespace reserved for managed-agent runtime Jobs. */
	readonly managedRuntimeNamespace: string | undefined;
	/** Hard timeout applied to every memory-gateway HTTP exchange. */
	readonly memoryGatewayTimeoutMilliseconds: number;
	/** Absolute path of the projected audience-bound memory-gateway caller token. */
	readonly memoryGatewayTokenPath: string;
	/** Release-local private memory-gateway origin; the client validates its exact shape. */
	readonly memoryGatewayUrl: string;
	/** Maximum number of published runtime outbox rows deleted in one prune pass. */
	readonly outboxPruneBatchSize: number;
	/** Namespace reserved for personal-agent runtime Jobs. */
	readonly personalRuntimeNamespace: string | undefined;
	/** Retention period for delivered runtime outbox rows. */
	readonly publishedOutboxRetentionMilliseconds: number;
	/** Namespace containing the OpenCrane server and agent controller. */
	readonly serverNamespace: string;
	/** Lifetime of one durable runtime assignment. */
	readonly assignmentTtlMilliseconds: number;
}

/** The Obot management transport settings the deployment supplies: origin, credential path, and timeout. */
export interface OpenCraneObotConfig
{
	/** In-cluster Obot origin (`http`, `*.svc.cluster.local`) with no path, query, or credentials. */
	readonly gatewayUrl: string;
	/** Absolute path of the mounted Obot service credential, re-read per call. */
	readonly serviceTokenPath: string;
	/** Hard timeout applied to every Obot management exchange. */
	readonly requestTimeoutMilliseconds: number;
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
	/** Delay between checks for newly admitted durable tasks. */
	readonly pollIntervalMilliseconds: number;
	/** Silo that owns every task admitted by this server process. */
	readonly siloId: string;
	/** Maximum number of durable tasks handled in parallel. */
	readonly workerConcurrency: number;
}

/**
 * One deployment-supplied provider credential that must be registered with the release-local
 * LiteLLM before the silo accepts work. The key is read only from a Kubernetes Secret reference.
 */
export interface InitialModelBootstrapConfig
{
	/** Supported upstream provider whose catalogue LiteLLM will register. */
	readonly provider: string;
	/** Raw upstream API key read from the mounted Secret and never logged or returned. */
	readonly apiKey: string;
}

/** Process-owned settings that shape the OpenCrane server lifecycle. */
export interface OpenCraneProcessConfig
{
	/** Namespace in which OIDC authentication resources are resolved. */
	readonly authWatchNamespace: string;
	/** Optional deployment-time model credential that must be seeded into LiteLLM before startup. */
	readonly initialModelBootstrap: InitialModelBootstrapConfig | null;
	/** Port exposed only to platform workloads. */
	readonly internalPort: number;
	/** Obot management transport, or null when the deployment leaves the feature off. */
	readonly obot: OpenCraneObotConfig | null;
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
