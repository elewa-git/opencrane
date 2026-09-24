import { InjectionToken } from "@angular/core";

import type { paths } from "@opencrane/contracts";

import type { ConversationWorkspaceDetail } from "./conversation-workspace.types";

/** Generated public response whose non-state fields remain the browser model source. */
type GeneratedConversationPersonalRun = paths["/me/runs/{runId}"]["get"]["responses"][200]["content"]["application/json"];

/**
 * Public personal-work lifecycle accepted by the browser and rendered by the workspace.
 *
 * The generated API stores these values on `ConversationPersonalRun.state`. The personal-run store
 * uses active members to admit Stop locally, and the feature mapper renders settling and terminal
 * members without inferring completion from the Stop message response.
 */
export enum ConversationPersonalRunStates
{
	/** Request was admitted but has not entered the queue. */
	Accepted = "accepted",
	/** Work is waiting for capacity. */
	Queued = "queued",
	/** Work has an executor but has not started. */
	Assigned = "assigned",
	/** The assistant is actively processing the request. */
	Running = "running",
	/** The assistant is paused for a participant response. */
	WaitingForInput = "waiting_for_input",
	/** Stop was admitted and cleanup or effect reconciliation is still running. */
	Cancelling = "cancelling",
	/** Stop reached the durable terminal state. */
	Cancelled = "cancelled",
	/** External effects cannot be safely classified without attention. */
	RecoveryRequired = "recovery_required",
	/** Work finished normally. */
	Completed = "completed",
	/** Work ended without completing. */
	Failed = "failed",
}

/** Reuses the generated public response with the frontend's exhaustive lifecycle vocabulary. */
export type ConversationPersonalRun = Omit<GeneratedConversationPersonalRun, "state"> & { readonly state: `${ConversationPersonalRunStates}` };

/** Reads only the signed-in person's bounded recent run list. */
export interface ConversationPersonalRunsGateway
{
	/** Supplies browser-safe status rows; the cookie supplies identity and the signal cancels obsolete reads. */
	listPersonalRuns(signal: AbortSignal): Promise<readonly ConversationPersonalRun[]>;
	/** Appends one explicit Stop control message for the signed-in requester. */
	requestStop(command: ConversationWorkStopCommand): Promise<void>;
}

/** Retry-stable Stop control message owned by the selected personal work store. */
export interface ConversationWorkStopCommand
{
	/** Selected personal conversation whose current work may stop. */
	readonly conversationId: string;
	/** Stable command identity reused while one Stop outcome remains uncertain. */
	readonly idempotencyKey: string;
}

/** Browser-owned retry coordinates for one selected run attempt. */
export interface ConversationWorkStopAttempt extends ConversationWorkStopCommand
{
	/** Opaque run coordinate used only to reject stale local completions. */
	readonly runId: string;
	/** Attempt visible when the participant requested Stop. */
	readonly attempt: number;
	/** Exact selection object whose access epoch owns the command. */
	readonly selection: ConversationWorkspaceDetail;
}

/** Keeps a Stop failure attached to the chat and run that produced it. */
export interface ConversationWorkStopFailure
{
	/** Original command, including its selected chat and run attempt. */
	readonly command: ConversationWorkStopAttempt;
	/** Display-safe explanation; never contains a server error body. */
	readonly message: string;
}

/** Binds the recent-work read owner to the host's existing generated-client adapter. */
export const CONVERSATION_PERSONAL_RUNS_GATEWAY = new InjectionToken<ConversationPersonalRunsGateway>("CONVERSATION_PERSONAL_RUNS_GATEWAY");

/** Fences a read to one authenticated selection and one accepted history checkpoint. */
export interface ConversationPersonalRunsScope
{
	/** Distinguishes a new admission of the same conversation after access changes. */
	readonly selection: ConversationWorkspaceDetail;
	/** Invalidates local data when the verified browser identity changes. */
	readonly subject: string;
	/** Refreshes work after new messages and completed answers arrive. */
	readonly position: string;
}

/** Returns either validated status rows or a fixed display-safe failure for that exact scope. */
export interface ConversationPersonalRunsRead extends ConversationPersonalRunsScope
{
	/** Contains only rows for the selected conversation, never the whole personal index. */
	readonly runs: readonly ConversationPersonalRun[];
	/** Reports a read failure without retaining old rows or exposing response details. */
	readonly error: string | null;
	/** Stops automatic and manual retries until the participant reopens authorized work. */
	readonly accessChanged: boolean;
}
