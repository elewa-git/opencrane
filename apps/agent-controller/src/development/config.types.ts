import type { AgentControllerRuntimeProfiles, LocalAgentRuntimeModelStrategies } from "@opencrane/backend/agents/runtime/controller";
import type { LocalDevelopmentProfileKinds } from "@opencrane/models/local-development";

/** Model endpoint and strategy derived from one Agent-enabled development profile. */
export interface LocalAgentControllerModelConfiguration
{
	/** LiteLLM origin used only by profiles that make real model requests. */
	readonly litellmBaseUrl?: string;
	/** Runtime event source selected before the child process starts. */
	readonly modelStrategy: LocalAgentRuntimeModelStrategies;
}

/** Fully validated configuration for the development-only local Agent controller. */
export interface LocalAgentControllerProcessConfig
{
	/** Selected Tier 2 Agent profile; core never starts this process. */
	readonly profile: Exclude<LocalDevelopmentProfileKinds, LocalDevelopmentProfileKinds.Core>;
	/** Internal local OpenCrane origin used for controller claims and commits. */
	readonly openCraneInternalUrl: string;
	/** Absolute path to the controller-only local bearer token. */
	readonly controllerTokenPath: string;
	/** Absolute path to the launch secret used to sign per-attempt runtime bearers. */
	readonly runtimeLaunchSecretPath: string;
	/** Absolute path to the existing Python agent-runtime application. */
	readonly runtimeApplicationDirectory: string;
	/** Python executable used to launch the existing runtime application. */
	readonly pythonExecutable: string;
	/** Local runtime-stream URL used by bootstrap, commands, and candidates. */
	readonly runtimeStreamUrl: string;
	/** Local or remote LiteLLM URL; simulated mode does not define a model endpoint. */
	readonly litellmBaseUrl?: string;
	/** Development model strategy derived from the selected profile. */
	readonly modelStrategy: LocalAgentRuntimeModelStrategies;
	/** Immutable workload profiles, keyed by the profile name OpenCrane assigns. */
	readonly profiles: AgentControllerRuntimeProfiles;
	/** Delay after an idle claim or handled failure. */
	readonly pollIntervalMilliseconds: number;
	/** Delay between bounded outbox-pruning passes. */
	readonly outboxPruneIntervalMilliseconds: number;
	/** Hard timeout independently applied to each OpenCrane HTTP request. */
	readonly requestTimeoutMilliseconds: number;
}
