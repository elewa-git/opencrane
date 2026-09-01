import type { WarmRuntimePoolProfiles } from "@opencrane/backend/agents/runtime/controller";
import type { LocalAgentRuntimeModelStrategies, LocalDevelopmentProfileKinds } from "@opencrane/models/local-development";

/** Model endpoint and strategy derived from one Agent-enabled development profile. */
export interface LocalAgentControllerModelConfiguration
{
	/** LiteLLM origin used only by profiles that make real model requests. */
	readonly litellmBaseUrl?: string;
	/** Runtime event source selected before the child process starts. */
	readonly modelStrategy: LocalAgentRuntimeModelStrategies;
}

/** Fully validated configuration for the development-only warm-runtime controller. */
export interface LocalAgentControllerProcessConfig
{
	/** Selected Tier 2 Agent profile; core never starts this process. */
	readonly profile: Exclude<LocalDevelopmentProfileKinds, LocalDevelopmentProfileKinds.Core>;
	/** Loopback OpenCrane origin reached through the development authority adapter. */
	readonly openCraneInternalUrl: string;
	/** Fixed synthetic Service name used to retain the production authority validation boundary. */
	readonly serverServiceName: string;
	/** Fixed synthetic server namespace shared by the Tier 2 identity contract. */
	readonly serverNamespace: string;
	/** Fixed local silo that owns every durable workflow task. */
	readonly siloId: string;
	/** Loopback PostgreSQL URL shared with the Tier 2 server. */
	readonly databaseUrl: string;
	/** Absolute path to the controller-only local bearer token. */
	readonly controllerTokenPath: string;
	/** Absolute path to the launch secret used to sign runtime bearers. */
	readonly runtimeLaunchSecretPath: string;
	/** Absolute path to the Python agent-runtime application. */
	readonly runtimeApplicationDirectory: string;
	/** Python executable used to launch the existing runtime application. */
	readonly pythonExecutable: string;
	/** Local warm-runtime URL used by binding, commands, and candidates. */
	readonly runtimeStreamUrl: string;
	/** Local or remote LiteLLM URL; simulated mode does not define a model endpoint. */
	readonly litellmBaseUrl?: string;
	/** Development model strategy derived from the selected profile. */
	readonly modelStrategy: LocalAgentRuntimeModelStrategies;
	/** Immutable synthetic warm pools keyed by server-selected workload profile. */
	readonly warmRuntimeProfiles: WarmRuntimePoolProfiles;
	/** Maximum PostgreSQL connections reserved for local workflow workers. */
	readonly workflowDatabasePoolSize: number;
	/** Maximum durable AgentRun tasks handled concurrently. */
	readonly workflowWorkerConcurrency: number;
	/** Delay between checks for durable AgentRun tasks. */
	readonly workflowPollIntervalMilliseconds: number;
	/** Delay after a warm-pool miss or lifecycle check. */
	readonly pollIntervalMilliseconds: number;
	/** Hard timeout independently applied to each OpenCrane request. */
	readonly requestTimeoutMilliseconds: number;
}
