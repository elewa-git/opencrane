import type { ElicitationRequestStates, SafeToolTechnicalDetails } from "@opencrane/contracts";

/** Supported derived Activity row kinds. */
export enum ConversationActivityKinds
{
	Elicitation = "elicitation",
	ToolFailure = "tool_failure",
}

/** Deep link back to canonical transcript or request coordinates. */
export interface ConversationActivityTarget
{
	readonly conversationId: string;
	readonly runId: string;
	readonly requestId?: string;
	readonly toolCallId?: string;
}

/** Browser-only row derived from canonical references, never a copied transcript. */
export type ConversationActivityRow =
	| { readonly kind: ConversationActivityKinds.Elicitation; readonly id: string; readonly label: string; readonly occurredAt: string; readonly status: ElicitationRequestStates; readonly target: ConversationActivityTarget }
	| { readonly kind: ConversationActivityKinds.ToolFailure; readonly id: string; readonly label: string; readonly occurredAt: string; readonly retrying: boolean; readonly technicalDetails: SafeToolTechnicalDetails; readonly target: ConversationActivityTarget };
