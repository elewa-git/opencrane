import type { RunInputSnapshot } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

import { ExternalActionRevisionKinds, type DurableExternalActionCommand, type ExternalActionExecutor, type ExternalActionExecutorDependencies } from "./external-action-executor.types";
import { _ExecuteMemoryExternalAction } from "./memory-external-action-executor";
import { _ExecuteSandboxExternalAction } from "./sandbox-external-action-executor";

/** Thrown before dispatch when a saved revision does not name a supported generic action class. */
export class UnsupportedExternalActionError extends Error
{
	/** Create a refusal that identifies the unsupported revision without exposing arguments. */
	constructor(toolRevisionId: string)
	{
		super(`unsupported external action revision: ${toolRevisionId}`);
		this.name = "UnsupportedExternalActionError";
	}
}

/**
 * Return the personal Cognee dataset frozen into an admitted snapshot.
 *
 * Tool arguments and subject ids are ignored on purpose: recall works only when admission wrote a
 * non-empty dataset id under a personal memory policy for a user identity. That is what stops a
 * managed run, or a crafted tool argument, from reading another person's memory.
 *
 * Called by: `ProductionExternalActionAdapterFactory.prepare`
 * (production-external-action-adapter.ts), which passes the result as `cogneeDatasetId`.
 *
 * @param snapshot - Immutable run input snapshot admitted by the server.
 * @returns The frozen dataset id, or null for any non-personal or malformed policy. Null means this
 * run may not recall memory at all: `_ExecuteMemoryExternalAction` then throws
 * {@link MemoryScopeUnavailableError} rather than falling back to a dataset of its own.
 */
export function __PersonalMemoryDatasetId(snapshot: RunInputSnapshot): string | null
{
	const policy = snapshot.memoryQueryPolicy;
	if (policy === null || typeof policy !== "object" || Array.isArray(policy)) return null;
	const record = policy as Readonly<Record<string, unknown>>;
	if (record["scope"] !== "personal") return null;
	const candidate = record["cogneeDatasetId"];
	return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : null;
}

/**
 * Build the executor for one admitted candidate.
 *
 * This factory only picks the transport, from the prefix of the tool revision id. Each executor
	 * then handles one generic server-owned action: the sandbox executor submits the invocation
	 * unchanged, while the memory executor refuses persisted delivery until its transient path exists.
	 * MCP revisions are admitted by the class-specific MCP authority before this factory is reached.
	 * An unavailable transport or an unknown prefix throws, so the worker records the invocation as
	 * failed or ambiguous instead of inventing a successful result.
 *
 * Called by: `ProductionExternalActionAdapterFactory.prepare`
 * (production-external-action-adapter.ts), which wraps the returned executor in the
 * manual-recovery adapter.
 *
 * @param candidate - The saved invocation, whose tool revision prefix picks the transport.
	 * @param dependencies - The injected transports and frozen silo and memory coordinates.
 * @returns An executor whose `execute` makes exactly one routed call.
 * @throws {UnsupportedExternalActionError} From `execute`, when the tool revision names no wired
 * transport.
 * @see ExternalActionRevisionKinds for the prefixes it matches.
	 * @see ExternalActionRevisionKinds for the remaining generic transport classes.
 */
export function __CreateExternalActionExecutor(candidate: DurableExternalActionCommand, dependencies: ExternalActionExecutorDependencies): ExternalActionExecutor<JsonValue>
{
	return {
		async execute(): Promise<JsonValue>
		{
			const toolRevisionId = candidate.toolRevisionId;
			if (toolRevisionId.startsWith(`${ExternalActionRevisionKinds.Sandbox}:`)) return _ExecuteSandboxExternalAction(candidate, dependencies);
			if (toolRevisionId.startsWith(`${ExternalActionRevisionKinds.Memory}:`)) return _ExecuteMemoryExternalAction(candidate, dependencies);
			throw new UnsupportedExternalActionError(toolRevisionId);
		},
	};
}
