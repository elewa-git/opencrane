import { Injectable, effect, inject } from "@angular/core";
import { ConversationComputerStates, ConversationEntryKinds, type ConversationEntry } from "@opencrane/contracts";
import { ConversationAssetContentStore, ConversationAssetsStore, type ConversationAsset } from "@opencrane/state/conversation/assets";
import { ConversationElicitationStore } from "@opencrane/state/conversation/elicitation";
import { ConversationComputerReviewStore, ConversationGroupChildStore, ConversationModes, ConversationWorkspaceStore } from "@opencrane/state/conversation/workspace";

import { ConversationAssetContentCoordinator } from "./conversation-asset-content.coordinator";

/** Coordinates selection lifetimes across stores without owning rendering or domain commands. */
@Injectable()
export class ConversationWorkspaceSelectionCoordinator
{
	/** Authoritative selected conversation and its stream. */
	private readonly store = inject(ConversationWorkspaceStore);
	/** Owns requests and reviewed shares for the current group selection. */
	private readonly groupStore = inject(ConversationGroupChildStore);
	/** Owns private file transfers for the current selection. */
	private readonly assetsStore = inject(ConversationAssetsStore);
	/** Owns scoped reads of the current asset list without retaining returned bytes. */
	private readonly assetContentStore = inject(ConversationAssetContentStore);
	/** Cancels prepared browser actions when the selected authority scope changes. */
	private readonly assetContentCoordinator = inject(ConversationAssetContentCoordinator);
	/** Owns review state for the currently admitted computer generation. */
	private readonly reviewStore = inject(ConversationComputerReviewStore);
	/** Owns the current participant approval and its local draft. */
	private readonly elicitationStore = inject(ConversationElicitationStore);
	/** Initial reads are scoped to this workspace instance. */
	private readonly _loadEffect = effect(this._Load.bind(this));
	/** Synchronises selected scope and computer generation with their store owners. */
	private readonly _selectionEffect = effect(this._OpenComposedState.bind(this));
	/** Previous coordinate lets selection changes clear private file state first. */
	private _composedConversationId: string | null = null;
	/** Last approval-log position already used to refresh current authority. */
	private _approvalInvalidationSequence: string | null = null;
	/** Start the initial parallel directory/list read. */
	private _Load(): void { void this.store.load(); }

	/** Open the asset state whenever the selected conversation changes. */
	private _OpenComposedState(): void
	{
		const selected = this.store.selected();
		this.groupStore.select(selected);
		if (selected === null)
		{
			this._composedConversationId = null;
			this._approvalInvalidationSequence = null;
			this.assetsStore.clear();
			this.assetContentCoordinator.clear();
			this.assetContentStore.clear();
			this.elicitationStore.clear();
			this.reviewStore.select(null);
			return;
		}
		if (this._composedConversationId !== selected.id)
		{
			this.assetsStore.clear();
			this.assetContentCoordinator.clear();
			this.assetContentStore.clear();
			this.elicitationStore.clear();
			this._composedConversationId = selected.id;
			this._approvalInvalidationSequence = _ApprovalInvalidationSequence(this.store.live().entries);
			void this.elicitationStore.refresh(selected.id);
		}
		const approvalInvalidationSequence = _ApprovalInvalidationSequence(this.store.live().entries);
		if (approvalInvalidationSequence !== this._approvalInvalidationSequence)
		{
			this._approvalInvalidationSequence = approvalInvalidationSequence;
			void this.elicitationStore.refresh(selected.id);
		}
		this.assetsStore.open(selected.id);
		this.assetContentStore.open(selected.id, this._CurrentAssets.bind(this));
		const computer = this.store.live().computer;
		const reviewConversationId = selected.mode === ConversationModes.AgentSession && computer?.state === ConversationComputerStates.Warm ? selected.id : null;
		const generationKey = computer === null ? null : `${computer.id}:${computer.leaseGeneration}`;
		this.reviewStore.select(reviewConversationId, generationKey);
	}

	/** Return the latest authorized asset list, or null until its current read completes. */
	private _CurrentAssets(): readonly ConversationAsset[] | null
	{
		return this.assetsStore.assets.hasValue() ? this.assetsStore.assets.value() : null;
	}

}

/**
 * Return the latest accepted approval-log position as an opaque refresh coordinate.
 *
 * The log's approval identifier belongs to approval history and is deliberately ignored: only the
 * elicitation API can name a request that the signed-in participant may read or answer.
 *
 * Called by: `ConversationWorkspaceSelectionCoordinator._OpenComposedState`.
 *
 * @param entries - Ordered, validated entries from the selected conversation stream.
 * @returns The latest approval-log position, or null before any approval log is visible.
 */
export function _ApprovalInvalidationSequence(entries: readonly ConversationEntry[]): string | null
{
	let sequence: string | null = null;
	for (const entry of entries)
		if (entry.kind === ConversationEntryKinds.Log && entry.logKind === "approval")
			sequence = entry.position;
	return sequence;
}
