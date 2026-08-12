import type { JsonValue } from "@opencrane/util";

/**
 * One tool call to run in a sandbox, with everything the executor needs to run it and
 * everything the caller needs to match the answer back to its own records.
 *
 * The identity fields (silo, run, attempt, tool revision, invocation) are for correlation
 * and for rejecting stale work; {@link RunSandboxJobCommand.arguments} is the only payload.
 * Arguments may contain user data, so this boundary neither logs nor stores them.
 */
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

/**
 * What a finished sandbox Job reported back. Only ever built from the executor's own
 * output — a caller that cannot get a real result must throw instead of filling one in,
 * since these values are stored as the tool's actual answer.
 *
 * A non-zero {@link SandboxJobResult.exitCode} is a Job that RAN and failed, which is
 * different from a Job that could not be started at all.
 */
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

/**
 * The port for running one external tool call somewhere isolated — today a Kubernetes Job.
 *
 * It is deliberately free of any Kubernetes type, so the code that decides WHAT to run does
 * not depend on HOW it runs and can be tested against a stub. An implementation must return
 * only what the sandbox actually produced: never a locally invented exit code or output,
 * because callers store the result as the tool's real answer.
 *
 * Implemented by: {@link __UnavailableSandboxJobExecutor} (./unavailable-sandbox-execution.ts),
 * the fail-closed default until a real transport exists.
 * Called by: the external-action path in
 * libs/backend/agents/execution/protocol (it holds one as `sandboxExecutor`, see
 * external-action-executor.types.ts line 66); wired in
 * apps/opencrane/src/app/external-action-composition.ts.
 */
export interface SandboxJobExecutor
{
	/**
	 * Run one tool call and wait for it to finish.
	 *
	 * @param command - What to run; see {@link RunSandboxJobCommand}.
	 * @returns The result, only once the Job has completed. Never a partial or predicted one.
	 * @throws When the call could not be run at all — for example
	 *         {@link SandboxExecutionUnavailableError} when no transport is configured. A
	 *         throw must be distinguishable from a Job that ran and failed, which returns a
	 *         non-zero `exitCode` instead.
	 */
	runJob(command: RunSandboxJobCommand): Promise<SandboxJobResult>;
}
