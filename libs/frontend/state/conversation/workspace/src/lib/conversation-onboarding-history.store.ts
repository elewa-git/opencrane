import { Injectable, inject, signal } from "@angular/core";

import { CONVERSATION_WORKSPACE_GATEWAY } from "./conversation-workspace.gateway";
import { ConversationOnboardingHistoryStatuses, type ConversationOnboardingHistoryProjection } from "./conversation-workspace.types";

/** Initial honest state before the optional onboarding history read completes. */
const _UNAVAILABLE_ONBOARDING_HISTORY: ConversationOnboardingHistoryProjection = { status: ConversationOnboardingHistoryStatuses.Unavailable, history: null };

/**
 * Owns the optional onboarding-history read and its workspace selection.
 *
 * {@link ConversationWorkspaceStore} calls {@link load}, applies its own load-generation check, and
 * then calls {@link adopt}. Keeping those steps separate prevents a late optional request from
 * replacing state loaded by a newer workspace navigation. Selecting this history never opens the
 * conversation stream or grants message and run commands.
 */
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

	/**
	 * Reads optional onboarding history without changing browser state.
	 *
	 * Called by: {@link ConversationWorkspaceStore.load} as part of the parallel workspace read.
	 *
	 * @returns The validated projection, or `Unavailable` when the optional request fails.
	 */
	public async load(): Promise<ConversationOnboardingHistoryProjection>
	{
		try { return await this._gateway.onboardingHistory(); }
		catch { return _UNAVAILABLE_ONBOARDING_HISTORY; }
	}

	/**
	 * Adopts a result after the workspace store confirms that its load generation is still current.
	 *
	 * Called by: {@link ConversationWorkspaceStore.load} after its stale-load check.
	 *
	 * @param projection - The result admitted by the owning workspace load.
	 */
	public adopt(projection: ConversationOnboardingHistoryProjection): void
	{
		this._projection.set(projection);
		if (this._projection().status !== ConversationOnboardingHistoryStatuses.Ready) this._selected.set(false);
	}

	/**
	 * Selects history only when the authority returned a completed transcript.
	 *
	 * Called by: {@link ConversationWorkspaceStore.openOnboardingHistory}.
	 *
	 * @returns `true` when history became selected; otherwise `false` and selection is unchanged.
	 */
	public select(): boolean
	{
		if (this._projection().status !== ConversationOnboardingHistoryStatuses.Ready) return false;
		this._selected.set(true);
		return true;
	}

	/**
	 * Clears history selection when an ordinary conversation or access state takes over.
	 *
	 * Called by: {@link ConversationWorkspaceStore.open} and its selection cleanup paths.
	 */
	public clearSelection(): void { this._selected.set(false); }
}
