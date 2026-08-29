import type { WarmRuntimePoolProfiles } from "@opencrane/backend/agents/runtime/controller";
import type { McpExecutorJobProfile } from "@opencrane/backend/agents/runtime/mcp-executor/k8s-launcher";
import type { SkillWorkloadControllerProfiles } from "@opencrane/backend/agents/skills/controller";
import type { ArtifactPreprocessorJobProfile } from "@opencrane/backend/artifacts/preprocessor/k8s-launcher";

/** Fully validated process configuration for the per-silo agent controller. */
export interface AgentControllerProcessConfig
{
	/** PostgreSQL URL shared with the server that admitted these durable tasks. */
	readonly databaseUrl: string;
	/** Maximum database connections reserved for this process's workflow workers. */
	readonly workflowDatabasePoolSize: number;
	/** Maximum number of durable tasks handled concurrently by this process. */
	readonly workflowWorkerConcurrency: number;
	/** Delay between checks for durable tasks on the controller-owned queues. */
	readonly workflowPollIntervalMilliseconds: number;
	/** Silo that every registered workflow task must match. */
	readonly siloId: string;
	/** Internal OpenCrane origin used for claim and assignment calls. */
	readonly openCraneInternalUrl: string;
	/** Exact Kubernetes Service name that owns the internal OpenCrane origin. */
	readonly serverServiceName: string;
	/** Namespace shared by the OpenCrane server and this controller process. */
	readonly serverNamespace: string;
	/** Absolute path of the rotating OpenCrane-audience projected token. */
	readonly controllerTokenPath: string;
	/** Delay after an idle poll or handled error. */
	readonly pollIntervalMilliseconds: number;
	/** Hard timeout independently applied to each OpenCrane or Kubernetes call. */
	readonly requestTimeoutMilliseconds: number;
	/** Fixed personal and managed warm pools keyed by their server-selected profile names. */
	readonly warmRuntimeProfiles: WarmRuntimePoolProfiles;
	/** Immutable profiles for governed skill Jobs, including the task-owned authoring handler. */
	readonly skillWorkloadProfiles: SkillWorkloadControllerProfiles;
	/** Immutable profile for OCI-backed MCP executor Jobs. */
	readonly mcpExecutorProfile: McpExecutorJobProfile;
	/** Optional immutable profile for the feature-gated PDF preprocessing Job class. */
	readonly artifactPreprocessorProfile: ArtifactPreprocessorJobProfile | undefined;
}
