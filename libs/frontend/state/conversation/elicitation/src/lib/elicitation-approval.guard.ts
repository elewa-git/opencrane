import { ElicitationApprovalScopes, ElicitationBodyKinds, ElicitationPurposes, ___ElicitationExecutionConnectionSchema, type ConversationElicitation } from "@opencrane/contracts";

/**
 * Requires the reviewable details before the browser admits an affirmative tool decision.
 *
 * Both the card and store use this check so bypassing response parsing or refreshing a retained
 * draft cannot approve an action whose connection details are missing. Server authority still
 * decides whether the submitted response is allowed.
 */
export function __CanApproveElicitation(elicitation: ConversationElicitation): boolean
{
	const body = elicitation.body;
	if (body.kind !== ElicitationBodyKinds.Approval || body.proposedArguments === null)
		return false;
	if (elicitation.purpose !== ElicitationPurposes.ToolApproval)
		return body.executionConnection === undefined;
	return body.proposedArguments !== undefined && ___ElicitationExecutionConnectionSchema.safeParse(body.executionConnection).success;
}

/** Require the server to offer the selected approval scope with every disclosure it needs. */
export function __CanApproveElicitationScope(elicitation: ConversationElicitation, scope: ElicitationApprovalScopes): boolean
{
	if (!__CanApproveElicitation(elicitation))
		return false;
	const body = elicitation.body;
	if (body.kind !== ElicitationBodyKinds.Approval)
		return false;
	if (elicitation.purpose !== ElicitationPurposes.ToolApproval)
		return scope === ElicitationApprovalScopes.Once;
	if (!body.offeredScopes?.includes(scope))
		return false;
	if (scope === ElicitationApprovalScopes.Always)
		return typeof body.standingScope?.explanation === "string" && body.standingScope.explanation.trim().length > 0;
	return true;
}
