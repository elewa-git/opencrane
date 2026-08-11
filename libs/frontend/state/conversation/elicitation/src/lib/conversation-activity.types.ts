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

/** One visible failed attempt accepted by the derived Activity mapper. */
export interface ToolFailureActivityAttempt
{
	/** Whether the control plane will retry after this failed attempt. */
	readonly retrying: boolean;
	/** Explicit browser-safe fields selected by server adapter vocabularies. */
	readonly technicalDetails: SafeToolTechnicalDetails;
}

/** Minimal safe tool view consumed by Activity without depending on another state package. */
export interface ToolFailureActivitySource
{
	/** Stable tool-call coordinate. */
	readonly id: string;
	/** Display-safe tool label. */
	readonly name: string;
	/** Ordered safe failed attempts. */
	readonly failures: readonly ToolFailureActivityAttempt[];
}

/** Browser-only row derived from canonical references, never a copied transcript. */
export type ConversationActivityRow =
	| { readonly kind: ConversationActivityKinds.Elicitation; readonly id: string; readonly label: string; readonly occurredAt: string; readonly status: ElicitationRequestStates; readonly target: ConversationActivityTarget }
	| { readonly kind: ConversationActivityKinds.ToolFailure; readonly id: string; readonly label: string; readonly occurredAt: string; readonly retrying: boolean; readonly technicalDetails: SafeToolTechnicalDetails; readonly target: ConversationActivityTarget };
