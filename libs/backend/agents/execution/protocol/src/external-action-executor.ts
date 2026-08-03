import type { JsonValue } from "@opencrane/util";
import type { RunInputSnapshot, RuntimeExternalActionCandidate } from "@opencrane/contracts";
import { IntegrationAssignmentUnavailableError } from "./external-action-errors.js";
import { ExternalActionToolRevisionPrefixes } from "./external-action-executor.types.js";
import type { ExternalActionExecutorDependencies, IntegrationToolReference } from "./external-action-executor.types.js";
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

/** Typed failure emitted when an admitted snapshot did not authorize a personal memory dataset. */
export class MemoryScopeUnavailableError extends Error
{
	/** Creates a failure that cannot fall back to subject-selected memory. */
	constructor()
	{
		super("personal memory scope is unavailable for this run snapshot");
		this.name = "MemoryScopeUnavailableError";
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
 * Select the personal Cognee dataset frozen into an admitted snapshot.
 *
 * Runtime arguments and subject identifiers are deliberately ignored: memory recall is available
 * only when admission sealed a non-empty dataset under a personal memory policy for a user identity.
 *
 * @param snapshot - Immutable run input snapshot admitted by the control plane.
 * @returns The frozen dataset identifier, or null for every non-personal or malformed policy.
 */
export function __PersonalMemoryDatasetId(snapshot: RunInputSnapshot): string | null
{
	if (snapshot.identitySnapshot.kind !== "user") return null;
	const policy = snapshot.memoryQueryPolicy;
	if (policy === null || typeof policy !== "object" || Array.isArray(policy)) return null;
	const record = policy as Readonly<Record<string, unknown>>;
	if (record["scope"] !== "personal") return null;
	const candidate = record["cogneeDatasetId"];
	return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : null;
}

/** Parse the exact integration/tool identity minted by the target prompt compiler. */
function _integrationTool(toolRevisionId: string): IntegrationToolReference | null
{
	const parts = toolRevisionId.split(":");
	if (parts.length !== 3 || parts[0] !== ExternalActionToolRevisionPrefixes.Integration || !parts[1] || !parts[2]) return null;
	return { integrationId: parts[1], toolName: parts[2] };
}

/** Execute one integration tool after rechecking the active assignment and its custody reference. */
async function _executeIntegrationAction(candidate: RuntimeExternalActionCandidate, dependencies: ExternalActionExecutorDependencies, tool: IntegrationToolReference): Promise<JsonValue>
{
	const resolved = await dependencies.integrations.resolveAssignment({ siloId: dependencies.siloId, agentRevisionId: dependencies.agentRevisionId, integrationId: tool.integrationId });
	if (resolved.outcome !== "resolved") throw new IntegrationAssignmentUnavailableError(tool.integrationId, resolved.reason);
	const result = await dependencies.obotMcpInvocation.invokeTool({ siloId: dependencies.siloId, integrationId: resolved.assignment.integrationId, obotCustodyReference: resolved.assignment.obotCustodyReference, toolName: tool.toolName, arguments: candidate.arguments, allowedTools: resolved.assignment.allowedTools });
	return result.content;
}

/** Execute one sandbox tool using all candidate coordinates required to fence the isolated Job. */
async function _executeSandboxAction(candidate: RuntimeExternalActionCandidate, dependencies: ExternalActionExecutorDependencies): Promise<JsonValue>
{
	const result = await dependencies.sandboxExecutor.runJob({ siloId: dependencies.siloId, runId: candidate.runId, attempt: candidate.attempt, toolRevisionId: candidate.toolRevisionId, toolInvocationId: candidate.toolInvocationId, argumentsDigest: candidate.argumentsDigest, arguments: candidate.arguments });
	return result.output;
}

/** Query only the memory dataset admitted into this user run; arguments cannot select a dataset. */
async function _executeMemoryAction(candidate: RuntimeExternalActionCandidate, dependencies: ExternalActionExecutorDependencies): Promise<JsonValue>
{
	if (dependencies.cogneeDatasetId === null) throw new MemoryScopeUnavailableError();
	const query = _stringArgument(candidate, "query") ?? "";
	const result = await dependencies.memoryGateway.query({ siloId: dependencies.siloId, cogneeDatasetId: dependencies.cogneeDatasetId, subjectId: dependencies.subjectId, query, maxResults: 20 });
	return result.facts.map(function _fact(fact) { return { factId: fact.factId, content: fact.content }; });
}

/** Select the sole external transport allowed by the candidate's compiler-issued tool revision. */
async function _executeExternalAction(candidate: RuntimeExternalActionCandidate, dependencies: ExternalActionExecutorDependencies): Promise<JsonValue>
{
	const integrationTool = _integrationTool(candidate.toolRevisionId);
	if (integrationTool !== null) return _executeIntegrationAction(candidate, dependencies, integrationTool);
	if (_hasToolRevisionPrefix(candidate.toolRevisionId, ExternalActionToolRevisionPrefixes.Sandbox)) return _executeSandboxAction(candidate, dependencies);
	if (_hasToolRevisionPrefix(candidate.toolRevisionId, ExternalActionToolRevisionPrefixes.Memory)) return _executeMemoryAction(candidate, dependencies);
	throw new UnsupportedExternalActionError(candidate.toolRevisionId);
}

/** Match only a complete tool-kind prefix, preventing similarly named revisions from selecting a transport. */
function _hasToolRevisionPrefix(toolRevisionId: string, prefix: ExternalActionToolRevisionPrefixes): boolean
{
	return toolRevisionId.startsWith(`${prefix}:`);
}

/**
 * Build the concrete external-action executor for one admitted candidate, in the composition root.
 *
 * This is the ONLY place the integration, sandbox, and memory transports are wired together, keeping
 * `scope:execution-protocol` and `scope:authorization` free of any transport import. The returned executor
 * routes `integration:<id>:<tool>` through the Obot invocation port, `sandbox:` through the sandbox
 * Job executor, and `memory:` through the memory gateway. Each transport currently defaults to its
 * fail-closed stub, so an action against an unavailable dependency raises rather than fabricating a
 * result, and `__ExecuteExternalAction` marks the reserved invocation failed. An unknown revision kind
 * is refused the same way.
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
			return _executeExternalAction(candidate, dependencies);
		},
	};
}
