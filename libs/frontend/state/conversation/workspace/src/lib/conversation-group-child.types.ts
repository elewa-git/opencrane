import type { GroupChildCreateCommand, GroupChildShareCommand, GroupChildView } from "@opencrane/models/conversations";

/** Tracks a browser command without implying that the assistant's work has completed. */
export enum ConversationGroupCommandStates
{
	/** The participant may edit or submit the current intent. */
	Idle = "idle",
	/** The selected command is in flight and its input is locked. */
	Submitting = "submitting",
	/** A response was lost or refused; the same intent retains its retry key. */
	Failed = "failed",
	/** The server accepted the reviewed human share. */
	Accepted = "accepted"
}

/** Gives the picker a company assistant that the server currently permits the caller to invoke. */
export interface ConversationCompanyAssistant
{
	/** Identifies the selected managed service without revealing its deployment coordinates. */
	readonly agentServiceId: string;
	/** Supplies the server-approved name displayed by the picker. */
	readonly displayName: string;
}

/** Captures a visible message for an explicit request or reviewed result share. */
export interface ConversationGroupSource
{
	/** Identifies the immutable source message. */
	readonly entryId: string;
	/** Retains its decimal stream revision without converting it to a number. */
	readonly position: string;
	/** Contains the resolved text shown in the request or review dialog. */
	readonly text: string;
}

/** Authenticates and validates group-child operations through the existing browser session. */
export interface ConversationGroupChildGateway
{
	/** Reads child requests after rechecking current group access. */
	listChildren(parentConversationId: string, signal: AbortSignal): Promise<readonly GroupChildView[]>;
	/** Admits an explicitly selected company assistant against the requester's own message. */
	createChild(parentConversationId: string, command: GroupChildCreateCommand, signal: AbortSignal): Promise<GroupChildView>;
	/** Posts reviewed text to the immediate group as the signed-in human, never as the assistant. */
	shareChild(childConversationId: string, command: GroupChildShareCommand, signal: AbortSignal): Promise<void>;
}
