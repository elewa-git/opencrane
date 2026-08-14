import type { TextMessageStartEvent } from "@ag-ui/core";

/** Browser-visible lifecycle for one projected conversation message. */
export enum AgUiMessageStatuses
{
	/** Message content may still receive deltas. */
	Streaming = "streaming",
	/** Message content completed normally. */
	Completed = "completed",
	/** Message generation failed. */
	Failed = "failed",
	/** Message generation was cancelled. */
	Cancelled = "cancelled",
}

/** One conversation message, assembled in the browser from the stream's text events. */
export interface AgUiMessageView
{
	/** Stable message identifier. */
	readonly id: string;
	/** Projected AG-UI role. */
	readonly role: TextMessageStartEvent["role"];
	/** Assembled display-safe message text. */
	readonly text: string;
	/** Whether the message is finished or still streaming, exactly as the server reported it. */
	readonly status: AgUiMessageStatuses;
}
