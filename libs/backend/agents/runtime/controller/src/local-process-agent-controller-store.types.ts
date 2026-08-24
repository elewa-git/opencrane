import type { ChildProcess } from "node:child_process";
import type { V1Job, V1Pod } from "@kubernetes/client-node";

/**
 * Selects how the development runtime obtains model output after OpenCrane admits an attempt.
 *
 * The controller passes this value only to the development runtime entrypoint. Production images
 * never read it. `litellm` retains the normal attempt-key boundary, while `simulated` replaces the
 * model request with a deterministic event source after the same bootstrap and command-stream flow.
 */
export enum LocalAgentRuntimeModelStrategies
{
	/** Uses the configured LiteLLM endpoint with the attempt key issued by OpenCrane. */
	LiteLlm = "litellm",
	/** Produces deterministic neutral events without contacting LiteLLM or reading a provider key. */
	Simulated = "simulated",
}

/**
 * Process-spawning seam used by the local workload host.
 *
 * Tests replace this port so they can prove credential-file and lifecycle policy without starting
 * Python. The development controller supplies Node's `spawn`; production never constructs this
 * adapter.
 */
export interface LocalAgentRuntimeProcessSpawner
{
	/**
	 * Starts the existing agent-runtime development entrypoint with an allowlisted environment.
	 * @param executable - Python executable resolved by the developer's shell.
	 * @param arguments_ - Module arguments that select the development entrypoint.
	 * @param options - Working directory and credential-free environment for the child.
	 * @returns The process handle used for shutdown and deadline enforcement.
	 */
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

/** Configuration for the development-only local process workload host. */
export interface LocalProcessAgentControllerStoreOptions
{
	/** Absolute path to the Python application directory that contains the `src` package. */
	readonly runtimeApplicationDirectory: string;
	/** Python executable used to launch the existing agent-runtime process. */
	readonly pythonExecutable: string;
	/** Local OpenCrane runtime-stream endpoint used by bootstrap, stream, and candidate requests. */
	readonly runtimeStreamUrl: string;
	/** LiteLLM endpoint used by Alternatives A and B; simulated mode must omit it. */
	readonly litellmBaseUrl?: string;
	/** File containing the local launch secret used to sign per-attempt runtime bearers. */
	readonly runtimeLaunchSecretPath: string;
	/** Model strategy selected by the owning Tier 2 development profile. */
	readonly modelStrategy: LocalAgentRuntimeModelStrategies;
	/** Stops every spawned attempt when the local controller exits. */
	readonly shutdownSignal: AbortSignal;
	/** Parent directory for private per-attempt temporary directories. */
	readonly temporaryDirectoryRoot?: string;
	/** Injected process seam used by focused tests. */
	readonly spawnProcess?: LocalAgentRuntimeProcessSpawner;
	/** Minimal path inherited by the child so `pythonExecutable` dependencies can resolve tools. */
	readonly executablePath?: string;
}

/** Private projected-file paths owned by one local runtime attempt. */
export interface LocalAgentRuntimeAttemptFiles
{
	/** Private per-attempt temporary directory. */
	readonly directory: string;
	/** Copied runtime bearer token path. */
	readonly tokenPath: string;
	/** Projected bootstrap reference path. */
	readonly bootstrapPath: string;
	/** Attempt-scoped LiteLLM key path. */
	readonly keyPath: string;
}

/** Mutable process projection retained while the development controller is alive. */
export interface LocalAgentRuntimeAttempt
{
	/** Exact Job-shaped projection built by the existing controller flow. */
	job: V1Job;
	/** Synthetic workload UID committed through the normal assignment contract. */
	readonly workloadUid: string;
	/** Private projected files for this attempt. */
	readonly files: LocalAgentRuntimeAttemptFiles;
	/** Synthetic Pod evidence registered through the normal workload contract. */
	pod?: V1Pod;
	/** Spawned existing agent-runtime process after release. */
	process?: ChildProcess;
	/** Timer that enforces the admitted assignment deadline. */
	deadline?: NodeJS.Timeout;
}

/** Fixed identity coordinates the development server binds to signed local runtime tokens. */
export interface LocalAgentRuntimeTokenReviewerOptions
{
	/** Absolute `0600` file holding the local-session launch secret. */
	readonly launchSecretPath: string;
	/** Runtime namespace configured in the server and controller profile. */
	readonly namespace: string;
	/** Runtime ServiceAccount name configured for the selected personal or managed profile. */
	readonly serviceAccountName: string;
}

/** Authenticated attempt identity returned after a local runtime token signature matches. */
export interface LocalAgentRuntimeIdentity
{
	/** Kubernetes-shaped subject retained by the existing assignment authority. */
	readonly subject: string;
	/** Fixed local runtime namespace for the selected personal or managed profile. */
	readonly namespace: string;
	/** Fixed local ServiceAccount for the selected personal or managed profile. */
	readonly serviceAccountName: string;
	/** Attempt process identity authenticated inside the signed bearer. */
	readonly podUid: string;
}

/** Development token-review port structurally compatible with the runtime stream's reviewer. */
export interface LocalAgentRuntimeTokenReviewer
{
	/**
	 * Verifies one signed local runtime bearer and returns its bound process identity.
	 * @param token - Bearer presented to bootstrap, stream, or candidate routes.
	 * @returns Fixed namespace/ServiceAccount plus authenticated Pod UID, or null for any mismatch.
	 */
	__Review(token: string): Promise<LocalAgentRuntimeIdentity | null>;
}
