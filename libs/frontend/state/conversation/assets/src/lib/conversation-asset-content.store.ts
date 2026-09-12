import { Injectable, inject, signal } from "@angular/core";

import { ConversationAssetLifecycle, ___ConversationAssetMediaDisposition } from "@opencrane/models/conversation-assets";

import { CONVERSATION_ASSETS_GATEWAY } from "./conversation-assets-gateway.types";
import { ConversationAssetContentCommandStates, type ConversationAsset, type ConversationAssetContent, type ConversationAssetContentAdmission } from "./conversation-assets.types";

/** Owns short-lived asset reads and their per-asset browser feedback for one selected conversation. */
@Injectable()
export class ConversationAssetContentStore
{
	/** Participant API that rechecks access and Ready state for every content read. */
	private readonly _gateway = inject(CONVERSATION_ASSETS_GATEWAY);
	/** Selected conversation, or null after the selection or access is cleared. */
	private _conversationId: string | null = null;
	/** Current authoritative asset reader supplied by the selection coordinator. */
	private _readAssets: (() => readonly ConversationAsset[] | null) | null = null;
	/** Changes whenever selected-conversation state is discarded. */
	private _scopeGeneration = 0;
	/** Local command state keyed by asset id; Blob bytes never enter this map. */
	private readonly _states = signal<ReadonlyMap<string, ConversationAssetContentCommandStates>>(new Map());

	/** Return the local content-command state for one currently rendered asset. */
	public state(assetId: string): ConversationAssetContentCommandStates
	{
		return this._states().get(assetId) ?? ConversationAssetContentCommandStates.Idle;
	}

	/** Return the current Ready asset disposition used to select Preview or Download before a read. */
	public disposition(assetId: string): ConversationAsset["disposition"]
	{
		return this._ReadyAsset(assetId)?.disposition ?? null;
	}

	/** Select one conversation and the function that exposes its latest authorized asset list. */
	public open(conversationId: string, readAssets: () => readonly ConversationAsset[] | null): void
	{
		if (conversationId.trim().length === 0)
			throw new Error("Conversation id is required.");
		if (this._conversationId !== conversationId)
		{
			this._scopeGeneration += 1;
			this._states.set(new Map());
			this._conversationId = conversationId;
		}
		this._readAssets = readAssets;
	}

	/** Clear selected-conversation state so late byte reads cannot affect a later selection. */
	public clear(): void
	{
		this._scopeGeneration += 1;
		this._conversationId = null;
		this._readAssets = null;
		this._states.set(new Map());
	}

	/**
	 * Read one Ready asset after claiming its current scope and metadata.
	 *
	 * A second read for the same asset is refused before the transport call. Different assets may
	 * read concurrently. The returned Blob is never stored; callers must either hand it directly to
	 * the platform bridge or discard it.
	 */
	public async read(assetId: string): Promise<ConversationAssetContent | null>
	{
		const admission = this._Admit(assetId);
		if (admission === null)
			return null;
		this._SetState(assetId, ConversationAssetContentCommandStates.Loading);

		let blob: Blob;
		try
		{
			blob = await this._gateway.read(admission.conversationId, admission.assetId);
		}
		catch
		{
			this._FailIfCurrent(admission);
			return null;
		}

		const current = this._CurrentAdmissionAsset(admission);
		if (current === null)
		{
			this._ClearIfCurrent(admission);
			return null;
		}
		if (blob.size !== current.byteLength || blob.type !== current.mediaType)
		{
			this._SetState(assetId, ConversationAssetContentCommandStates.Failed);
			return null;
		}

		this._SetState(assetId, ConversationAssetContentCommandStates.Idle);
		return { blob, displayName: current.displayName, mediaType: current.mediaType, byteLength: current.byteLength, disposition: current.disposition };
	}

	/** Record a platform failure only while the same Ready asset remains current. */
	public markFailed(assetId: string): void
	{
		if (this._ReadyAsset(assetId) !== null)
			this._SetState(assetId, ConversationAssetContentCommandStates.Failed);
	}

	/** Claim one exact Ready asset without allowing a same-asset duplicate read. */
	private _Admit(assetId: string): ConversationAssetContentAdmission | null
	{
		const conversationId = this._conversationId;
		const asset = this._ReadyAsset(assetId);
		if (conversationId === null || asset === null || asset.byteLength === null || asset.disposition === null || this.state(assetId) === ConversationAssetContentCommandStates.Loading)
			return null;
		return { conversationId, scopeGeneration: this._scopeGeneration, assetId, displayName: asset.displayName, mediaType: asset.mediaType, byteLength: asset.byteLength, disposition: asset.disposition };
	}

	/** Read one Ready asset from the latest authorized list. */
	private _ReadyAsset(assetId: string): ConversationAsset | null
	{
		const asset = this._readAssets?.()?.find(candidate => candidate.id === assetId) ?? null;
		if (asset?.conversationId !== this._conversationId || asset.state !== ConversationAssetLifecycle.Ready)
			return null;
		return ___ConversationAssetMediaDisposition(asset.mediaType) === asset.disposition ? asset : null;
	}

	/** Require the selected scope and every byte-relevant field to match the admission. */
	private _CurrentAdmissionAsset(admission: ConversationAssetContentAdmission): ConversationAssetContentAdmission | null
	{
		if (this._conversationId !== admission.conversationId || this._scopeGeneration !== admission.scopeGeneration)
			return null;
		const asset = this._ReadyAsset(admission.assetId);
		if (asset === null || asset.byteLength === null || asset.disposition === null)
			return null;
		if (asset.displayName !== admission.displayName || asset.mediaType !== admission.mediaType || asset.byteLength !== admission.byteLength || asset.disposition !== admission.disposition)
			return null;
		return admission;
	}

	/** Show safe retry feedback only for the unchanged admitted asset. */
	private _FailIfCurrent(admission: ConversationAssetContentAdmission): void
	{
		if (this._CurrentAdmissionAsset(admission) !== null)
			this._SetState(admission.assetId, ConversationAssetContentCommandStates.Failed);
		else
			this._ClearIfCurrent(admission);
	}

	/** Release a loading marker after an authoritative asset or scope change. */
	private _ClearIfCurrent(admission: ConversationAssetContentAdmission): void
	{
		if (this._conversationId === admission.conversationId && this._scopeGeneration === admission.scopeGeneration)
			this._SetState(admission.assetId, ConversationAssetContentCommandStates.Idle);
	}

	/** Replace one asset's local state without changing independent reads. */
	private _SetState(assetId: string, state: ConversationAssetContentCommandStates): void
	{
		this._states.update(function _Replace(current)
		{
			const next = new Map(current);
			if (state === ConversationAssetContentCommandStates.Idle)
				next.delete(assetId);
			else
				next.set(assetId, state);
			return next;
		});
	}
}
