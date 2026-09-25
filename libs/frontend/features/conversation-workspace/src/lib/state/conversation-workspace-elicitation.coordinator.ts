import { DestroyRef, Injectable, effect, inject, signal } from "@angular/core";

import { ConversationEntryKinds, ConversationLogKinds, type ConversationEntry } from "@opencrane/contracts";
import { ConversationActivityKinds, ConversationElicitationActivityStore, ConversationElicitationStore, type ConversationActivityTarget } from "@opencrane/state/conversation/elicitation";
import { CONVERSATION_CURRENT_SUBJECT, ConversationWorkspaceRouteStates, ConversationWorkspaceStore } from "@opencrane/state/conversation/workspace";

/**
 * Discovers questions for the signed-in workspace and selects the exact request opened from Activity.
 *
 * This is the single owner of selected-question discovery. While an Activity target is opening,
 * ordinary oldest-request discovery is suspended so it cannot replace the selected question.
 * The API still decides whether the conversation and request may be read or answered.
 */
@Injectable()
export class ConversationWorkspaceElicitationCoordinator
{
	/** Supplies the current authorized conversation and its history. */
	private readonly _workspace = inject(ConversationWorkspaceStore);
	/** Owns the current request, its draft and all response commands. */
	private readonly _elicitation = inject(ConversationElicitationStore);
	/** Owns current-readable question notices across conversations. */
	private readonly _activity = inject(ConversationElicitationActivityStore);
	/** Separates browser state across identities without supplying API authority. */
	private readonly _subject = inject(CONVERSATION_CURRENT_SUBJECT);
	/** Cancels pending navigation when the page is destroyed. */
	private readonly _destroyRef = inject(DestroyRef);
	/** Starts and stops global question reads with the authenticated workspace lifetime. */
	private readonly _identityEffect = effect(this._SyncIdentity.bind(this));
	/** Reconciles selected-question discovery with current conversation history. */
	private readonly _selectionEffect = effect(this._SyncSelection.bind(this));
	/** Last browser identity admitted to this mounted page's private state. */
	private _identity: string | null = null;
	/** Conversation already adopted by the selected-question owner. */
	private _selectedId: string | null = null;
	/** Last approval-history position used for an authority refresh. */
	private _approvalPosition: string | null = null;
	/** Makes a late navigation result unable to affect a newer user selection. */
	private _navigationGeneration = 0;
	/** Prevents oldest-open discovery while an explicit question is being selected. */
	private _openingTarget: ConversationActivityTarget | null = null;
	/** Request ready for a checked, after-render focus handoff. */
	private readonly _focusRequest = signal<ConversationActivityTarget | null>(null);
	/** Fixed feedback for a target that current authority no longer returns. */
	private readonly _navigationError = signal<string | null>(null);
	/** Exact request that the page may focus after checking its rendered projection. */
	public readonly focusRequest = this._focusRequest.asReadonly();
	/** Safe failure copy; no target or provider content is included. */
	public readonly navigationError = this._navigationError.asReadonly();

	/** Tear down pending navigation together with the page-scoped read owner. */
	public constructor() { this._destroyRef.onDestroy(this._Dispose.bind(this)); }

	/** Invalidate a question-opening intent before ordinary rail, route or history navigation. */
	public cancelNavigation(): void
	{
		this._navigationGeneration += 1;
		if (this._openingTarget !== null)
			this._elicitation.clear();
		this._openingTarget = null;
		this._focusRequest.set(null);
		this._navigationError.set(null);
	}

	/** Clear the focus handoff only after the matching rendered card received focus. */
	public acknowledgeFocus(requestId: string): void
	{
		if (this._focusRequest()?.requestId === requestId)
			this._focusRequest.set(null);
	}

	/**
	 * Open one current Activity target and re-read that exact request under current server authority.
	 *
	 * @param target - Coordinates emitted by a question row still present in the Activity read.
	 * @returns True only when the selected conversation and loaded request match all three coordinates.
	 * A stale, denied or overtaken target returns false without falling back to another open question.
	 */
	public async open(target: ConversationActivityTarget): Promise<boolean>
	{
		this.cancelNavigation();
		const identity = this._subject();
		const current = this._activity.rows().some(function _Current(row)
		{
			return row.kind === ConversationActivityKinds.Elicitation && row.target.conversationId === target.conversationId && row.target.runId === target.runId && row.target.requestId === target.requestId;
		});
		if (identity === null || target.requestId === undefined || !current || this._workspace.routeState() !== ConversationWorkspaceRouteStates.Ready)
		{
			this._navigationError.set("That question is no longer available.");
			return false;
		}
		const generation = this._navigationGeneration;
		this._openingTarget = target;
		this._elicitation.clear();
		if (this._workspace.selected()?.id !== target.conversationId)
			await this._workspace.open(target.conversationId);
		if (!this._CurrentNavigation(generation, identity, target))
			return this._Unavailable(generation);
		// Adopt selection before the exact read so a later selection effect cannot clear its result.
		this._SyncSelection();
		await this._elicitation.load(target.conversationId, target.requestId);
		if (!this._CurrentNavigation(generation, identity, target))
			return this._Unavailable(generation);
		const request = this._elicitation.elicitation();
		if (request?.conversationId !== target.conversationId || request.runId !== target.runId || request.requestId !== target.requestId || this._elicitation.error() !== null)
			return this._Unavailable(generation);
		this._openingTarget = null;
		this._focusRequest.set(target);
		void this._activity.refresh();
		return true;
	}

	/** Start reads only for an available workspace; an identity change clears the selected draft too. */
	private _SyncIdentity(): void
	{
		const identity = this._workspace.routeState() === ConversationWorkspaceRouteStates.Ready ? this._subject() : null;
		if (identity === this._identity)
			return;
		this._identity = identity;
		this.cancelNavigation();
		this._elicitation.clear();
		this._selectedId = null;
		this._approvalPosition = null;
		if (identity === null)
			this._activity.deactivate();
		else
		{
			this._activity.activate(identity);
			this._SyncSelection();
		}
	}

	/** Reconcile the selected scope while leaving explicit-target adoption with open(). */
	private _SyncSelection(): void
	{
		const selected = this._workspace.selected();
		const position = _ApprovalInvalidationSequence(this._workspace.live().entries);
		if (selected === null || this._subject() === null || this._workspace.routeState() !== ConversationWorkspaceRouteStates.Ready)
		{
			this._selectedId = null;
			this._approvalPosition = null;
			this._focusRequest.set(null);
			this._elicitation.clear();
			return;
		}
		const changed = selected.id !== this._selectedId;
		const invalidated = position !== this._approvalPosition;
		if (changed)
		{
			this._elicitation.clear();
			this._focusRequest.set(null);
		}
		this._selectedId = selected.id;
		this._approvalPosition = position;
		if (this._openingTarget !== null)
			return;
		if (changed || invalidated)
			void this._elicitation.refresh(selected.id);
	}

	/** Keep an exact read bound to its original user intent and current selected conversation. */
	private _CurrentNavigation(generation: number, identity: string, target: ConversationActivityTarget): boolean
	{
		return generation === this._navigationGeneration && this._subject() === identity && this._workspace.routeState() === ConversationWorkspaceRouteStates.Ready && this._workspace.selected()?.id === target.conversationId;
	}

	/** Clear a failed exact read without allowing an older failure to clear a newer selection. */
	private _Unavailable(generation: number): false
	{
		if (generation === this._navigationGeneration)
		{
			this._openingTarget = null;
			this._focusRequest.set(null);
			this._elicitation.clear();
			this._navigationError.set("That question is no longer available.");
			void this._activity.refresh();
		}
		return false;
	}

	/** Stop private reads and ignore any outstanding navigation on page teardown. */
	private _Dispose(): void
	{
		this.cancelNavigation();
		this._activity.deactivate();
		this._elicitation.clear();
	}
}

/** Use the latest approval history position to recheck authority, never its unrelated approval ID. */
export function _ApprovalInvalidationSequence(entries: readonly ConversationEntry[]): string | null
{
	let sequence: string | null = null;
	for (const entry of entries)
		if (entry.kind === ConversationEntryKinds.Log && entry.logKind === ConversationLogKinds.Approval)
			sequence = entry.position;
	return sequence;
}
