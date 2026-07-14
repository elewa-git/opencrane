import { Injectable, inject } from "@angular/core";

import { UI_SESSION_DATA_SOURCE } from "./ui-data-source.tokens.js";

/** Stable orchestration seam consumed by Workspace and Session feature lanes. */
@Injectable({ providedIn: "root" })
export class SessionFacade
{
	/** Provider-neutral Session state owner selected by dependency injection. */
	private readonly _source = inject(UI_SESSION_DATA_SOURCE);

	/** Read-only complete Session state. */
	public readonly state = this._source.state;

	/** Read-only route-access and identity state. */
	public readonly access = this._source.access;

	/** Provider-neutral presentation state for loading, failure, permission, and stress variants. */
	public readonly presentation = this._source.presentation;

	/** Lifecycle of the most recent Session mutation. */
	public readonly mutation = this._source.mutation;

	/** Selects a Session route or the new-session state. */
	public selectSession(sessionId: string | null): void
	{
		this._source.selectSession(sessionId);
	}

	/** Sends a message through the selected provider. */
	public sendMessage(content: string): void
	{
		this._source.sendMessage(content);
	}

	/** Cancels any provider response currently in progress. */
	public cancelStreaming(): void
	{
		this._source.cancelStreaming();
	}

	/** Cancels a pending Session mutation before it commits. */
	public cancelMutation(): void
	{
		this._source.cancelMutation();
	}
}
