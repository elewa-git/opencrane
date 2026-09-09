import { InjectionToken } from "@angular/core";

import type { paths } from "@opencrane/contracts";

import type { ConversationWorkspaceDetail } from "./conversation-workspace.types";

/** Reuses the generated public response rather than copying the server's run model. */
export type ConversationPersonalRun = paths["/me/runs/{runId}"]["get"]["responses"][200]["content"]["application/json"];

/** Reads only the signed-in person's bounded recent run list. */
export interface ConversationPersonalRunsGateway
{
	/** Supplies browser-safe status rows; the cookie supplies identity and the signal cancels obsolete reads. */
	listPersonalRuns(signal: AbortSignal): Promise<readonly ConversationPersonalRun[]>;
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
