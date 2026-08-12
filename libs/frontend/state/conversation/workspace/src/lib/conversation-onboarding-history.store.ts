import { Injectable, inject, signal } from "@angular/core";

import { CONVERSATION_WORKSPACE_GATEWAY } from "./conversation-workspace.gateway.js";
import { ConversationOnboardingHistoryStatuses, type ConversationOnboardingHistoryProjection } from "./conversation-workspace.types.js";

/** Initial honest state before the optional onboarding history read completes. */
const _UNAVAILABLE_ONBOARDING_HISTORY: ConversationOnboardingHistoryProjection = { status: ConversationOnboardingHistoryStatuses.Unavailable, history: null };

/** Component-scoped owner for the optional read-only onboarding projection and its selection. */
@Injectable()
export class ConversationOnboardingHistoryStore
{
	/** Signed-in gateway that reads the server-owned onboarding exchange. */
	private readonly _gateway = inject(CONVERSATION_WORKSPACE_GATEWAY);
	/** Latest honest availability and transcript result. */
	private readonly _projection = signal<ConversationOnboardingHistoryProjection>(_UNAVAILABLE_ONBOARDING_HISTORY);
	/** Whether the read-only transcript is selected in the workspace. */
	private readonly _selected = signal(false);
	/** Public onboarding availability and transcript. */
	public readonly projection = this._projection.asReadonly();
	/** Public read-only selection state. */
	public readonly selected = this._selected.asReadonly();

	/** Read optional onboarding history without adopting it ahead of the workspace generation fence. */
	public async load(): Promise<ConversationOnboardingHistoryProjection>
	{
		try { return await this._gateway.onboardingHistory(); }
		catch { return _UNAVAILABLE_ONBOARDING_HISTORY; }
	}

	/** Adopt only the history result admitted by the owning workspace load generation. */
	public adopt(projection: ConversationOnboardingHistoryProjection): void
	{
		this._projection.set(projection);
		if (this._projection().status !== ConversationOnboardingHistoryStatuses.Ready) this._selected.set(false);
	}

	/** Select history only when a completed transcript is present. */
	public select(): boolean
	{
		if (this._projection().status !== ConversationOnboardingHistoryStatuses.Ready) return false;
		this._selected.set(true);
		return true;
	}

	/** Clear history selection when an ordinary conversation or access state takes over. */
	public clearSelection(): void { this._selected.set(false); }
}
