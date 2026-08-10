import type { JsonValue } from "@opencrane/util";

/** Request to run one external tool call inside a sandboxed Kubernetes Job. */
export interface RunSandboxJobCommand
{
	/** Silo that owns the run. */
	readonly siloId: string;
	/** Run whose action step is being executed. */
	readonly runId: string;
	/** Attempt number for this action step; distinguishes retries. */
	readonly attempt: number;
	/** Immutable tool revision to execute. */
	readonly toolRevisionId: string;
	/** Invocation identity used as remote correlation context. */
	readonly toolInvocationId: string;
	/** Canonical digest of the arguments; lets the executor reject drift. */
	readonly argumentsDigest: string;
	/** Arguments handed to the tool; never persisted or logged by this boundary. */
	readonly arguments: JsonValue;
}

/** Result returned only after a sandboxed Job completes. */
export interface SandboxJobResult
{
	/** Invocation this result answers; echoed back from the command. */
	readonly toolInvocationId: string;
	/** Process exit code reported by the sandboxed Job. */
	readonly exitCode: number;
	/** Tool output captured from the Job; never locally synthesized. */
	readonly output: JsonValue;
	/** Remote completion time reported by the executor. */
	readonly completedAt: Date;
}

/** Runtime-neutral boundary for running a tool call inside a sandboxed Job. */
export interface SandboxJobExecutor
{
	/** Runs one tool call remotely and returns only executor-originated output. */
	runJob(command: RunSandboxJobCommand): Promise<SandboxJobResult>;
}
