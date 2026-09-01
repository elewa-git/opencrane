import type { ChildProcess } from "node:child_process";

import type { WarmRuntimePodCandidate, WarmRuntimePoolProfile } from "@opencrane/backend/agents/runtime/k8s-launcher";
import type { LocalAgentRuntimeModelStrategies } from "@opencrane/models/local-development";

import type { WarmRuntimePoolProfiles } from "./warm-runtime-controller.types";

/** Process-spawning seam used by the local warm-runtime host. */
export interface LocalAgentRuntimeProcessSpawner
{
	/** Starts one existing Python runtime with an allowlisted environment. */
	(executable: string, arguments_: readonly string[], options: LocalAgentRuntimeSpawnOptions): ChildProcess;
}

/** Options passed to the injected process spawner. */
export interface LocalAgentRuntimeSpawnOptions
{
	/** Agent-runtime application directory used as the Python module root. */
	readonly cwd: string;
	/** Allowlisted runtime configuration; it contains file paths, never credential contents. */
	readonly env: Readonly<Record<string, string>>;
	/** Keeps local runtime output visible in the developer's terminal. */
	readonly stdio: "inherit";
}

/** Configuration for the development-only local warm-runtime store. */
export interface LocalProcessWarmRuntimeStoreOptions
{
	/** Absolute path to the Python agent-runtime application. */
	readonly runtimeApplicationDirectory: string;
	/** Python executable used to launch one claimed local runtime. */
	readonly pythonExecutable: string;
	/** Loopback OpenCrane warm-runtime endpoint used by binding and command streaming. */
	readonly runtimeStreamUrl: string;
	/** Local or remote LiteLLM endpoint; simulated mode omits it. */
	readonly litellmBaseUrl?: string;
	/** File containing the local-session secret used to sign runtime bearers. */
	readonly runtimeLaunchSecretPath: string;
	/** Model strategy selected by the owning Tier 2 profile. */
	readonly modelStrategy: LocalAgentRuntimeModelStrategies;
	/** Fixed local warm pools keyed by the workload profile selected by the server. */
	readonly profiles: WarmRuntimePoolProfiles;
	/** Stops every spawned runtime when the local controller exits. */
	readonly shutdownSignal: AbortSignal;
	/** Parent directory for private runtime directories. */
	readonly temporaryDirectoryRoot?: string;
	/** Injected process seam used by focused tests. */
	readonly spawnProcess?: LocalAgentRuntimeProcessSpawner;
	/** Injected readiness transport used by focused tests. */
	readonly fetch?: typeof fetch;
}

/** Private files owned by one synthetic warm Pod. */
export interface LocalAgentRuntimeFiles
{
	/** Private per-Pod temporary directory. */
	readonly directory: string;
	/** Signed runtime bearer path. */
	readonly tokenPath: string;
	/** Public proof-evidence path isolated from every other local runtime. */
	readonly proofEvidencePath: string;
}

/** Mutable local projection of one synthetic warm Pod. */
export interface LocalWarmRuntime
{
	/** Profile name saved in the server's workflow record. */
	readonly profileName: string;
	/** Fixed pool configuration selected for this runtime. */
	readonly pool: WarmRuntimePoolProfile;
	/** Synthetic immutable Pod identity exposed to the warm workflow. */
	readonly candidate: WarmRuntimePodCandidate;
	/** Resource version returned after profile activation. */
	activationResourceVersion?: string;
	/** Private files created only after database reservation wins. */
	files?: LocalAgentRuntimeFiles;
	/** Spawned existing runtime process. */
	process?: ChildProcess;
	/** Records that the child exited before workflow-owned deletion. */
	terminal?: boolean;
}

/** Fixed identity coordinates the development server binds to signed local runtime tokens. */
export interface LocalAgentRuntimeTokenReviewerOptions
{
	/** Absolute `0600` file holding the local-session launch secret. */
	readonly launchSecretPath: string;
	/** Runtime namespace configured in the server and controller profile. */
	readonly namespace: string;
	/** Runtime ServiceAccount configured for the selected profile. */
	readonly serviceAccountName: string;
}

/** Authenticated runtime identity returned after a local token signature matches. */
interface LocalAgentRuntimeIdentity
{
	/** Kubernetes-shaped subject retained by the warm-runtime authority. */
	readonly subject: string;
	/** Fixed local runtime namespace. */
	readonly namespace: string;
	/** Fixed local runtime ServiceAccount. */
	readonly serviceAccountName: string;
	/** Synthetic Pod identity authenticated inside the signed bearer. */
	readonly podUid: string;
}

/** Development token-review port structurally compatible with warm-runtime identity review. */
export interface LocalAgentRuntimeTokenReviewer
{
	/** Verifies one signed local runtime bearer. */
	__Review(token: string): Promise<LocalAgentRuntimeIdentity | null>;
}
