import type { ElicitationRequestStates, SafeToolTechnicalDetails, paths } from "@opencrane/contracts";

/** Supported derived Activity row kinds. */
export enum ConversationActivityKinds
{
	Elicitation = "elicitation",
	ToolFailure = "tool_failure",
	/** Shows the current server-owned state of recent personal work. */
	Run = "run",
}

/** Deep link back to canonical transcript or request coordinates. */
export interface ConversationActivityTarget
{
	readonly conversationId: string;
	readonly runId: string;
	readonly requestId?: string;
	readonly toolCallId?: string;
	/** Identifies an answer that is already present in the current authorized transcript. */
	readonly entryId?: string;
}

/** Reuses the public status vocabulary without importing execution authority into browser state. */
export type ConversationActivityRunState = paths["/me/runs/{runId}"]["get"]["responses"][200]["content"]["application/json"]["state"];

/** Reuses the public tool phase without adding tool identities or private payload fields. */
export type ConversationActivityRunToolProgress = paths["/me/runs/{runId}"]["get"]["responses"][200]["content"]["application/json"]["latestTool"];

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
	| { readonly kind: ConversationActivityKinds.ToolFailure; readonly id: string; readonly label: string; readonly occurredAt: string; readonly retrying: boolean; readonly technicalDetails: SafeToolTechnicalDetails; readonly target: ConversationActivityTarget }
	| { readonly kind: ConversationActivityKinds.Run; readonly id: string; readonly label: string; readonly occurredAt: string; readonly status: ConversationActivityRunState; readonly latestTool: ConversationActivityRunToolProgress; readonly target: ConversationActivityTarget | null };
