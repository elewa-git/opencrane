import type { JsonValue } from "@opencrane/util";
import type { RuntimeExternalActionCandidate } from "@opencrane/contracts";
import type { ExternalActionExecutorDependencies } from "./external-action-executor.types.js";
import type { ExternalActionExecutor } from "./external-action-authority.types.js";

/** Typed failure raised for a candidate whose tool revision names no wired transport kind. */
export class UnsupportedExternalActionError extends Error
{
	/** Creates a failure that a caller cannot mistake for a successful tool result. */
	constructor(toolRevisionId: string)
	{
		super(`no external-action transport is wired for tool revision ${toolRevisionId}`);
		this.name = "UnsupportedExternalActionError";
	}
}

/** Read a string field from a candidate's canonical argument object, or null when absent. */
function _stringArgument(candidate: RuntimeExternalActionCandidate, key: string): string | null
{
	const args = candidate.arguments;
	if (!args || typeof args !== "object" || Array.isArray(args)) return null;
	const value = (args as { readonly [field: string]: JsonValue })[key];
	return typeof value === "string" ? value : null;
}

/**
 * Build the concrete external-action executor for one admitted candidate, in the composition root.
 *
 * This is the ONLY place the MCP, sandbox, and memory transports are wired together, keeping
 * `scope:execution-protocol` and `scope:authorization` free of any transport import. The returned executor
 * routes by the tool-revision prefix minted by the run-input compiler: `mcp-server:` goes through the
 * Obot custody port, `sandbox:` through the sandbox Job executor, and `memory:` through the memory
 * gateway. Each transport currently defaults to its fail-closed stub, so an action against an
 * unavailable dependency raises rather than fabricating a result, and `__ExecuteExternalAction` marks
 * the reserved invocation failed. An unknown revision kind is refused the same way.
 *
 * @param candidate - Runtime external-action candidate whose tool revision selects the transport.
 * @param dependencies - Injected concrete transports and correlation identity.
 * @returns An executor whose `execute` performs exactly one routed, fail-closed tool call.
 */
export function __CreateExternalActionExecutor(candidate: RuntimeExternalActionCandidate, dependencies: ExternalActionExecutorDependencies): ExternalActionExecutor<JsonValue>
{
	return {
		async execute(): Promise<JsonValue>
		{
			const toolRevisionId = candidate.toolRevisionId;
			if (toolRevisionId.startsWith("mcp-server:"))
			{
				// An MCP tool call needs Obot-held custody first; the unavailable adapter fails closed here.
				await dependencies.obotCustody.provision({ siloId: dependencies.siloId, integrationId: toolRevisionId, obotCatalogEntryId: toolRevisionId, credential: [] });
				throw new UnsupportedExternalActionError(toolRevisionId);
			}
			if (toolRevisionId.startsWith("sandbox:"))
			{
				const result = await dependencies.sandboxExecutor.runJob({ siloId: dependencies.siloId, runId: candidate.runId, attempt: candidate.attempt, toolRevisionId, toolInvocationId: candidate.toolInvocationId, argumentsDigest: candidate.argumentsDigest, arguments: candidate.arguments });
				return result.output;
			}
			if (toolRevisionId.startsWith("memory:"))
			{
				const query = _stringArgument(candidate, "query") ?? "";
				const result = await dependencies.memoryGateway.query({ siloId: dependencies.siloId, subjectId: dependencies.subjectId, query, maxResults: 20 });
				return result.facts.map(function _fact(fact) { return { factId: fact.factId, content: fact.content }; });
			}
			throw new UnsupportedExternalActionError(toolRevisionId);
		},
	};
}
