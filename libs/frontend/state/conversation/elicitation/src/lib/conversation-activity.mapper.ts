import type { ConversationElicitation } from "@opencrane/contracts";
import type { AgUiToolFailure, AgUiToolView } from "@opencrane/state/conversation/ag-ui";

import { ConversationActivityKinds, type ConversationActivityRow } from "./conversation-activity.types.js";

/** Map one canonical request reference into the derived Activity index. */
export function __MapElicitationActivity(elicitation: ConversationElicitation): ConversationActivityRow
{
	return { kind: ConversationActivityKinds.Elicitation, id: elicitation.requestId, label: elicitation.body.prompt, occurredAt: elicitation.requestedAt, status: elicitation.state, target: { conversationId: elicitation.conversationId, runId: elicitation.runId, requestId: elicitation.requestId } };
}

/** Map every visible failed attempt, including retrying attempts, into ordered Activity rows. */
export function __MapToolActivity(conversationId: string, runId: string, tool: AgUiToolView): readonly ConversationActivityRow[]
{
	return tool.failures.map(function _Failure(failure: AgUiToolFailure, index): ConversationActivityRow
	{
		return { kind: ConversationActivityKinds.ToolFailure, id: `${tool.id}:${index}`, label: failure.technicalDetails.summary ?? "Tool attempt failed.", occurredAt: failure.technicalDetails.occurredAt, retrying: failure.retrying, technicalDetails: failure.technicalDetails, target: { conversationId, runId, toolCallId: tool.id } };
	});
}
