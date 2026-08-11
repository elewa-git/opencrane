import { Injectable, computed, inject, resource, signal } from "@angular/core";

import { _ConversationAssetContentAddress, _ConversationAssetFileMediaType, _DecideConversationAssetFiles } from "./conversation-asset-file.js";
import { CONVERSATION_ASSETS_GATEWAY } from "./conversation-assets-gateway.types.js";
import { ConversationAssetTransferPhases, type ConversationAsset, type ConversationAssetSelectionFailure, type PendingConversationAssetUpload } from "./conversation-assets.types.js";

/** Browser-private exact upload intent. */
interface ConversationAssetUploadIntent
{
	readonly idempotencyKey: string;
	readonly file: File;
	readonly mediaType: string;
	readonly contentAddress: string | null;
	readonly assetId: string | null;
	readonly phase: ConversationAssetTransferPhases;
	readonly failureCode: PendingConversationAssetUpload["failureCode"];
}

/** Component-scoped state owner for one conversation's safe files and independent uploads. */
@Injectable()
export class ConversationAssetsStore
{
	private readonly _gateway = inject(CONVERSATION_ASSETS_GATEWAY);
	private readonly _conversationId = signal<string | undefined>(undefined);
	private readonly _intents = signal<readonly ConversationAssetUploadIntent[]>([]);
	private readonly _removingAssetIds = signal<ReadonlySet<string>>(new Set());

	/** Pure server projection keyed by the selected conversation. */
	public readonly assets = resource({ params: this._conversationId, loader: ({ params }) => this._gateway.list(params) });

	/** Complete selection-level failure; no file started when this is set. */
	public readonly selectionFailure = signal<ConversationAssetSelectionFailure | null>(null);

	/** Display-safe local transfer state without retaining File objects in presentation. */
	public readonly pendingUploads = computed<readonly PendingConversationAssetUpload[]>(() => this._intents().map(_PendingUpload));

	/** Select one authoritative conversation for reads and upload commands. */
	public open(conversationId: string): void
	{
		if (conversationId.trim().length === 0) throw new Error("Conversation id is required.");
		if (this._conversationId() !== conversationId) { this._intents.set([]); this.selectionFailure.set(null); this._conversationId.set(conversationId); }
	}

	/** Validate the whole message selection, then transfer independent files concurrently. */
	public async select(files: readonly File[]): Promise<void>
	{
		const decision = _DecideConversationAssetFiles(files);
		if (!decision.accepted)
		{
			this.selectionFailure.set(decision.failureCode);
			return;
		}
		this.selectionFailure.set(null);
		const additions = files.map(function _Intent(file): ConversationAssetUploadIntent { return { idempotencyKey: crypto.randomUUID(), file, mediaType: _ConversationAssetFileMediaType(file), contentAddress: null, assetId: null, phase: ConversationAssetTransferPhases.Selected, failureCode: null }; });
		this._intents.update(current => [...current, ...additions]);
		await Promise.all(additions.map(intent => this._transfer(intent.idempotencyKey)));
	}

	/** Retry the exact failed file, digest, asset coordinate, and idempotency key. */
	public async retry(idempotencyKey: string): Promise<void>
	{
		const intent = this._intent(idempotencyKey);
		if (intent?.phase !== ConversationAssetTransferPhases.Failed) return;
		await this._transfer(idempotencyKey);
	}

	/** Remove a local choice only before a server reservation exists. */
	public removeLocal(idempotencyKey: string): void
	{
		const intent = this._intent(idempotencyKey);
		if (intent?.assetId !== null) return;
		this._intents.update(current => current.filter(candidate => candidate.idempotencyKey !== idempotencyKey));
	}

	/** Remove one exact server reservation only when the server granted that capability. */
	public async remove(assetId: string): Promise<void>
	{
		const conversationId = this._conversationId();
		if (conversationId === undefined || !this.assets.hasValue() || this._removingAssetIds().has(assetId)) return;
		const asset = this.assets.value().find(candidate => candidate.id === assetId);
		if (asset?.canRemove !== true) return;
		this._removingAssetIds.update(current => new Set([...current, assetId]));
		try
		{
			const removed = await this._gateway.remove(conversationId, assetId);
			if (this._conversationId() !== conversationId) return;
			this._intents.update(current => current.filter(candidate => candidate.assetId !== assetId));
			this._adopt(removed);
		}
		finally
		{
			this._removingAssetIds.update(current => new Set([...current].filter(candidate => candidate !== assetId)));
		}
	}

	/** Explicitly reload lifecycle changes such as scan completion or failure. */
	public refresh(): void { this.assets.reload(); }

	/** Run one intent from its last exact durable boundary. */
	private async _transfer(idempotencyKey: string): Promise<void>
	{
		const conversationId = this._conversationId();
		let intent = this._intent(idempotencyKey);
		if (conversationId === undefined || intent === undefined) return;
		try
		{
			if (intent.contentAddress === null)
			{
				this._patch(idempotencyKey, { phase: ConversationAssetTransferPhases.Hashing, failureCode: null });
				const contentAddress = await _ConversationAssetContentAddress(intent.file);
				if (this._intent(idempotencyKey) === undefined) return;
				this._patch(idempotencyKey, { contentAddress });
			}
			intent = this._intent(idempotencyKey);
			if (intent === undefined) return;
			if (intent.assetId === null)
			{
				this._patch(idempotencyKey, { phase: ConversationAssetTransferPhases.Reserving, failureCode: null });
				const reserved = await this._gateway.reserve(conversationId, { idempotencyKey, displayName: intent.file.name, mediaType: intent.mediaType, byteLength: intent.file.size, contentAddress: intent.contentAddress ?? "" });
				this._patch(idempotencyKey, { assetId: reserved.id });
				this._adopt(reserved);
			}
			intent = this._intent(idempotencyKey);
			if (intent === undefined || intent.assetId === null) return;
			this._patch(idempotencyKey, { phase: ConversationAssetTransferPhases.Uploading, failureCode: null });
			const uploaded = await this._gateway.upload(conversationId, intent.assetId, intent.file);
			this._adopt(uploaded);
			this._intents.update(current => current.filter(candidate => candidate.idempotencyKey !== idempotencyKey));
		}
		catch
		{
			const failed = this._intent(idempotencyKey);
			if (failed === undefined) return;
			const failureCode = _TransferFailureCode(failed);
			this._patch(idempotencyKey, { phase: ConversationAssetTransferPhases.Failed, failureCode });
		}
	}

	/** Adopt one server-returned asset without predicting its lifecycle. */
	private _adopt(asset: ConversationAsset): void
	{
		if (!this.assets.hasValue()) { this.assets.reload(); return; }
		const current = this.assets.value();
		const index = current.findIndex(candidate => candidate.id === asset.id);
		if (index < 0) this.assets.set([...current, asset]);
		else this.assets.set(current.map(candidate => candidate.id === asset.id ? asset : candidate));
	}

	/** Read one exact intent. */
	private _intent(idempotencyKey: string): ConversationAssetUploadIntent | undefined { return this._intents().find(candidate => candidate.idempotencyKey === idempotencyKey); }

	/** Replace only explicitly named intent fields. */
	private _patch(idempotencyKey: string, patch: Partial<ConversationAssetUploadIntent>): void
	{
		this._intents.update(current => current.map(intent => intent.idempotencyKey === idempotencyKey ? { ...intent, ...patch } : intent));
	}
}

/** Locate the exact failed boundary without exposing transport details. */
function _TransferFailureCode(intent: ConversationAssetUploadIntent): PendingConversationAssetUpload["failureCode"]
{
	if (intent.contentAddress === null) return "hash_failed";
	if (intent.assetId === null) return "reservation_failed";
	return "upload_failed";
}

/** Strip browser File bytes from the feature-facing local projection. */
function _PendingUpload(intent: ConversationAssetUploadIntent): PendingConversationAssetUpload
{
	return { idempotencyKey: intent.idempotencyKey, displayName: intent.file.name, mediaType: intent.mediaType, byteLength: intent.file.size, phase: intent.phase, canRemove: intent.assetId === null, uploadProgressPercent: null, failureCode: intent.failureCode };
}
