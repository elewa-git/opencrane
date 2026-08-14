import type { ConversationElicitation } from "@opencrane/contracts";

import { ConversationActivityKinds, type ConversationActivityRow, type ToolFailureActivityAttempt, type ToolFailureActivitySource } from "./conversation-activity.types";

/** Map one canonical request reference into the derived Activity index. */
export function __MapElicitationActivity(elicitation: ConversationElicitation): ConversationActivityRow
{
	return { kind: ConversationActivityKinds.Elicitation, id: elicitation.requestId, label: elicitation.body.prompt, occurredAt: elicitation.requestedAt, status: elicitation.state, target: { conversationId: elicitation.conversationId, runId: elicitation.runId, requestId: elicitation.requestId } };
}

/** Map every visible failed attempt, including retrying attempts, into ordered Activity rows. */
export function __MapToolActivity(conversationId: string, runId: string, tool: ToolFailureActivitySource): readonly ConversationActivityRow[]
{
	return tool.failures.map(function _Failure(failure: ToolFailureActivityAttempt, index): ConversationActivityRow
	{
		return { kind: ConversationActivityKinds.ToolFailure, id: `${tool.id}:${index}`, label: failure.technicalDetails.summary ?? "Tool attempt failed.", occurredAt: failure.technicalDetails.occurredAt, retrying: failure.retrying, technicalDetails: failure.technicalDetails, target: { conversationId, runId, toolCallId: tool.id } };
	});
}
