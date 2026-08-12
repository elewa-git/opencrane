import type { JsonValue } from "@opencrane/util";
import type { ResolveIntegrationAssignmentResult } from "@opencrane/backend/server/gateways/integrations";

import { IntegrationAssignmentUnavailableError, IntegrationToolReturnedError } from "./external-action-errors.js";
import { ExternalActionRevisionKinds, type DurableExternalActionCommand, type ExternalActionExecutorDependencies } from "./external-action-executor.types.js";

/** The success outcome value `resolveAssignment` returns, written out once here. */
const _resolvedIntegrationAssignmentOutcome: Extract<ResolveIntegrationAssignmentResult, { readonly assignment: unknown }>["outcome"] = "resolved";

/**
 * Thrown when a tool revision id names no wired transport.
 *
 * Always a wiring or compilation bug, never a race: the revision id was built by the prompt
 * compiler, so a revision the executor cannot route means the two sides disagree. Nothing has been
 * sent, so the catcher completes the invocation as failed - `_provenPreDispatchFailure` maps it to
 * `external_action_unsupported` - instead of retrying, because a retry would fail identically for
 * ever.
 *
 * Raised by `__CreateExternalActionExecutor`'s `execute` and by
 * `_ExecuteIntegrationExternalAction`; caught by `_provenPreDispatchFailure`
 * (production-external-action-adapter.ts).
 *
 * @see ExternalActionRevisionKinds for the prefixes that are wired.
 */
export class UnsupportedExternalActionError extends Error
{
	/** Creates a failure that a caller cannot mistake for a successful tool result. */
	constructor(toolRevisionId: string)
	{
		super(`no external-action transport is wired for tool revision ${toolRevisionId}`);
		this.name = "UnsupportedExternalActionError";
	}
}

/** Split an `integration:<id>:<tool>` revision id into the integration id and the tool name. */
function _integrationTool(toolRevisionId: string): { readonly integrationId: string; readonly toolName: string } | null
{
	const parts = toolRevisionId.split(":");
	if (parts.length !== 3 || parts[0] !== ExternalActionRevisionKinds.Integration || !parts[1] || !parts[2]) return null;
	return { integrationId: parts[1], toolName: parts[2] };
}

/**
 * Resolve an integration's live custody assignment and invoke its exact allowed tool through Obot.
 *
 * The frozen tool revision provides only the integration and tool names. The active assignment is
 * always re-resolved immediately before custody-backed dispatch, so a revoked or expired assignment
 * refuses before Obot receives the request.
 *
 * @param candidate - Admitted invocation candidate with the compiler-minted tool revision.
 * @param dependencies - Concrete custody and integration-resolution ports for this invocation.
 * @returns Tool content returned by Obot.
 * @throws {UnsupportedExternalActionError} When the revision is not a complete integration identity.
 * @throws {IntegrationAssignmentUnavailableError} When live custody no longer authorizes the action.
 */
export async function _ExecuteIntegrationExternalAction(candidate: DurableExternalActionCommand, dependencies: ExternalActionExecutorDependencies): Promise<JsonValue>
{
	// 1. Read the integration from the revision id, so tool arguments cannot pick which credentials are used.
	const integrationTool = _integrationTool(candidate.toolRevisionId);
	if (integrationTool === null) throw new UnsupportedExternalActionError(candidate.toolRevisionId);

	// 2. Check the assignment again right before sending, so a revoked or expired one refuses here.
	const resolved = await dependencies.integrations.resolveAssignment({ siloId: dependencies.siloId, agentRevisionId: dependencies.agentRevisionId, integrationId: integrationTool.integrationId });
	if (resolved.outcome !== _resolvedIntegrationAssignmentOutcome) throw new IntegrationAssignmentUnavailableError(integrationTool.integrationId, resolved.reason);

	// 3. Pass the custody reference and allow-list to the Obot port, which is the only holder of credentials.
	const result = await dependencies.obotMcpInvocation.invokeTool({ siloId: dependencies.siloId, integrationId: resolved.assignment.integrationId, obotCustodyReference: resolved.assignment.obotCustodyReference, toolName: integrationTool.toolName, arguments: candidate.arguments, allowedToolNames: resolved.assignment.toolDefinitions.map(function _Name(definition): string { return definition.name; }) });
	if (result.isError) throw new IntegrationToolReturnedError();
	return result.content;
}
