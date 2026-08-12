import type { RunSandboxJobCommand, SandboxJobExecutor, SandboxJobResult } from "./sandbox-execution.types.js";

/**
 * Thrown when a tool call was asked for but this deployment has no sandbox transport wired.
 *
 * It has its own type so callers can tell "we never ran it" from "it ran and failed":
 * libs/backend/agents/execution/protocol/src/production-external-action-adapter.ts
 * checks with `instanceof` and reports the call as provider-unavailable, which is retried
 * rather than recorded as a tool failure.
 */
export class SandboxExecutionUnavailableError extends Error
{
	/** Creates a failure that cannot be mistaken for a completed sandboxed Job. */
	constructor()
	{
		super("Sandbox execution authority is unavailable");
		this.name = "SandboxExecutionUnavailableError";
	}
}

/**
 * The placeholder executor a deployment gets when no real sandbox transport exists: every
 * call throws {@link SandboxExecutionUnavailableError}.
 *
 * It exists so the external-action path always has an executor and can be composed and
 * tested normally, while making it impossible to mistake "no sandbox configured" for a
 * tool call that ran and produced nothing.
 *
 * Called by: apps/opencrane/src/app/external-action-composition.ts.
 *
 * @implements {SandboxJobExecutor}
 */
export class __UnavailableSandboxJobExecutor implements SandboxJobExecutor
{
	/** Rejects execution rather than inventing a Job result. */
	async runJob(_command: RunSandboxJobCommand): Promise<SandboxJobResult>
	{
		throw new SandboxExecutionUnavailableError();
	}
}
