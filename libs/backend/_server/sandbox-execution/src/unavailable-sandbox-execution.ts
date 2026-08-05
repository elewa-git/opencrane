import type { RunSandboxJobCommand, SandboxJobExecutor, SandboxJobResult } from "./sandbox-execution.types.js";

/** Typed failure emitted when no sandbox execution transport is configured. */
export class SandboxExecutionUnavailableError extends Error
{
	/** Creates a failure that cannot be mistaken for a completed sandboxed Job. */
	constructor()
	{
		super("Sandbox execution authority is unavailable");
		this.name = "SandboxExecutionUnavailableError";
	}
}

/** Fail-closed executor used until a real sandbox Job transport is wired. */
export class __UnavailableSandboxJobExecutor implements SandboxJobExecutor
{
	/** Rejects execution rather than inventing a Job result. */
	async runJob(_command: RunSandboxJobCommand): Promise<SandboxJobResult>
	{
		throw new SandboxExecutionUnavailableError();
	}
}
