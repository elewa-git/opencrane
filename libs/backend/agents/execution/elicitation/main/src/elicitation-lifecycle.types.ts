import type { ElicitationRequestStates } from "@opencrane/contracts";

/** Events accepted by the durable elicitation state owner. */
export enum ElicitationLifecycleEvents
{
	/** Accept a matching participant answer. */
	Answer = "answer",
	/** Accept an explicit participant decline. */
	Decline = "decline",
	/** Close a request after its server-owned deadline. */
	Expire = "expire",
	/** Close a request because cancellation won. */
	Cancel = "cancel",
	/** Close a request because safe continuation failed. */
	Fail = "fail",
}

/** Result of one exhaustive state and event decision. */
export enum ElicitationLifecycleActions
{
	/** Apply the requested terminal transition. */
	Transition = "transition",
	/** Refuse because the request is already terminal. */
	AlreadyTerminal = "already_terminal",
}

/** Input to the pure elicitation lifecycle authority. */
export interface ElicitationLifecycleInput
{
	/** Currently persisted request state. */
	readonly state: ElicitationRequestStates;
	/** Proposed lifecycle event. */
	readonly event: ElicitationLifecycleEvents;
}
