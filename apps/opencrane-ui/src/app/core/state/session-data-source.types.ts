import { Signal } from "@angular/core";

import { UiSessionState } from "../models/session.types.js";
import { UiAccessState, UiDataPresentationState, UiMutationState } from "../models/ui-data.types.js";

/** Provider-neutral Session state and actions consumed by the UI facade. */
export interface UiSessionDataSource
{
	/** Read-only Session presentation state. */
	readonly state: Signal<UiSessionState>;

	/** Read-only identity and route-access state. */
	readonly access: Signal<UiAccessState>;

	/** Provider-neutral loading, error, permission, limit, offline, and overflow flags. */
	readonly presentation: Signal<UiDataPresentationState>;

	/** Lifecycle of the most recent Session mutation. */
	readonly mutation: Signal<UiMutationState>;

	/** Selects an existing Session route or the new-session state. */
	selectSession(sessionId: string | null): void;

	/** Sends one user message through the selected provider. */
	sendMessage(content: string): void;

	/** Cancels any provider response currently in progress. */
	cancelStreaming(): void;

	/** Cancels a pending Session mutation before it commits. */
	cancelMutation(): void;
}
