import { Injectable, effect, inject } from "@angular/core";
import { ConversationComputerStates } from "@opencrane/contracts";
import { ConversationAssetContentStore, ConversationAssetsStore, type ConversationAsset } from "@opencrane/state/conversation/assets";
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
	/** Initial reads are scoped to this workspace instance. */
	private readonly _loadEffect = effect(this._Load.bind(this));
	/** Synchronises selected scope and computer generation with their store owners. */
	private readonly _selectionEffect = effect(this._OpenComposedState.bind(this));
	/** Previous coordinate lets selection changes clear private file state first. */
	private _composedConversationId: string | null = null;
	/** Start the initial parallel directory/list read. */
	private _Load(): void { void this.store.load(); }

	/** Open the asset state whenever the selected conversation changes. */
	private _OpenComposedState(): void
	{
		const selected = this.store.selected();
		this.groupStore.select(selected, this.store.directory()?.participants ?? []);
		if (selected === null)
		{
			this._composedConversationId = null;
			this.assetsStore.clear();
			this.assetContentCoordinator.clear();
			this.assetContentStore.clear();
			this.reviewStore.select(null);
			return;
		}
		if (this._composedConversationId !== selected.id)
		{
			this.assetsStore.clear();
			this.assetContentCoordinator.clear();
			this.assetContentStore.clear();
			this._composedConversationId = selected.id;
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
