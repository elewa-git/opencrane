import { Injectable, computed, inject, resource, signal } from "@angular/core";

import { ConversationAssetLifecycle, ConversationAssetProvenance } from "@opencrane/models/conversation-assets";

import { _ConversationAssetContentAddress, _ConversationAssetFileMediaType, _DecideConversationAssetFiles } from "./conversation-asset-file.js";
import { CONVERSATION_ASSETS_GATEWAY } from "./conversation-assets-gateway.types.js";
import { ConversationAssetTransferPhases, type ConversationAsset, type ConversationAssetSelectionFailure, type PendingConversationAssetUpload } from "./conversation-assets.types.js";

/**
 * One file the participant picked, tracked in the browser until the server owns it.
 *
 * The `File` itself stays in here and never reaches the presentation layer, and the three nullable
 * fields double as the transfer's resume point: no `contentAddress` means it has not been hashed, no
 * `assetId` means the server has not reserved it yet.
 */
interface ConversationAssetUploadIntent
{
	/** Key sent with the reservation. Reused on every retry so one file cannot reserve twice. */
	readonly idempotencyKey: string;
	/** The picked file. Kept here only; `_PendingUpload` strips it before the UI sees anything. */
	readonly file: File;
	/** Media type worked out from the file, sent with the reservation. */
	readonly mediaType: string;
	/** Digest of the file's bytes, or null before hashing succeeded. */
	readonly contentAddress: string | null;
	/** Server-assigned asset id, or null while no reservation exists yet. */
	readonly assetId: string | null;
	/** How far this transfer has got, for the tray to render. */
	readonly phase: ConversationAssetTransferPhases;
	/** Which step failed, or null. Set together with the `Failed` phase. */
	readonly failureCode: PendingConversationAssetUpload["failureCode"];
}

/**
 * Owns the files of one conversation: the list the server holds, the transfers still running in the
 * browser, and which of those files go out with the next message.
 *
 * A file becomes a message attachment in three server-visible steps — hash, reserve, upload — and this
 * store keeps each one resumable so a retry continues from where it stopped rather than reserving a
 * second copy. Everything is scoped to the conversation named by {@link open}; a scope generation
 * counter makes results that arrive after a conversation switch get dropped instead of applied to the
 * newly opened conversation.
 *
 * Lifetime: `@Injectable()` with no `providedIn`, listed in the `providers` of
 * `ConversationWorkspacePageComponent`, so there is one instance per mounted workspace page and none
 * of this survives navigation. Within a page, `ConversationWorkspacePresenter` calls {@link clear}
 * before opening a different conversation, because the browser holds real file bytes here and they
 * must not outlive the conversation they were picked for.
 *
 * Called by: `ConversationWorkspacePresenter` (`clear`, `open`, `observeInvalidations`, `select`,
 * `retry`, `removeLocal`, `remove`, `messageAssetIds`, `clearMessageSelection`).
 */
@Injectable()
export class ConversationAssetsStore
{
	/** The signed-in participant's asset API port: list, reserve, upload, remove. */
	private readonly _gateway = inject(CONVERSATION_ASSETS_GATEWAY);
	/** The conversation these files belong to, or undefined when none is open. Drives the read. */
	private readonly _conversationId = signal<string | undefined>(undefined);
	/** Transfers the browser is still running, in the order the files were picked. */
	private readonly _intents = signal<readonly ConversationAssetUploadIntent[]>([]);
	/** Assets with a removal in flight, so a second click cannot send the same removal twice. */
	private readonly _removingAssetIds = signal<ReadonlySet<string>>(new Set());
	/**
	 * Assets already sent with a message, held until the server's list catches up.
	 *
	 * The server binds an asset to a message by filling in its `messageId`, but the list resource is
	 * not reloaded at that moment, so locally the asset still looks unbound. Without this set the same
	 * file would be attached again to the next message the participant sends.
	 */
	private readonly _submittedMessageAssetIds = signal<ReadonlySet<string>>(new Set());
	/**
	 * Counts conversation switches. A command captures it before it starts and compares afterwards, so
	 * a late response cannot land on the conversation that is open now. See `_isScopeCurrent`.
	 */
	private _scopeGeneration = 0;
	/** How many asset-changed stream events have already triggered a reload for this conversation. */
	private _observedAssetInvalidations = 0;

	/** The server's file list for the open conversation. The loader only reads; commands push results in. */
	public readonly assets = resource({ params: this._conversationId, loader: ({ params }) => this._gateway.list(params) });

	/** Why a whole pick was rejected, for example for exceeding the per-message size limit. When this is set, no file in that pick started transferring. */
	public readonly selectionFailure = signal<ConversationAssetSelectionFailure | null>(null);

	/** The running transfers as the UI sees them, with the file bytes stripped out. */
	public readonly pendingUploads = computed<readonly PendingConversationAssetUpload[]>(() => this._intents().map(_PendingUpload));
	/**
	 * The asset ids to attach to the next message: participant uploads that finished, passed scanning,
	 * and are not bound to a message yet.
	 */
	public readonly messageAssetIds = computed<readonly string[]>(this._MessageAssetIds.bind(this));

	/**
	 * Points the store at one conversation and starts reading its files.
	 *
	 * Switching conversations resets everything conversation-specific — running transfers, the
	 * already-sent set, the pick failure — and bumps the scope generation so results still in flight
	 * for the previous conversation are discarded. Calling it again with the conversation that is
	 * already open does nothing, which is what lets the presenter's effect call it on every change.
	 *
	 * Called by: `ConversationWorkspacePresenter._OpenComposedState`, after the workspace store selects
	 * a conversation.
	 *
	 * @param conversationId - The conversation to read files for.
	 * @throws Error when the id is blank. A blank string is still a defined value, so the list resource
	 *   would go and ask the server for the files of an empty conversation id instead of loading nothing;
	 *   {@link clear} is the way to say "no conversation".
	 */
	public open(conversationId: string): void
	{
		if (conversationId.trim().length === 0) throw new Error("Conversation id is required.");
		if (this._conversationId() !== conversationId) { this._scopeGeneration += 1; this._observedAssetInvalidations = 0; this._intents.set([]); this._submittedMessageAssetIds.set(new Set()); this.selectionFailure.set(null); this._conversationId.set(conversationId); }
	}

	/**
	 * Forgets the conversation and everything the browser was holding for it, including the bytes of
	 * files that were picked but never finished uploading.
	 *
	 * Setting the conversation back to undefined leaves the list resource with no value — an Angular
	 * `resource` whose params are undefined does not load — so no file list from a conversation the
	 * participant may no longer be allowed to see stays on screen. The scope
	 * generation is bumped first, so a hash, reservation, or upload still running finds its scope stale
	 * and stops without writing anything back.
	 *
	 * Called by: `ConversationWorkspacePresenter._OpenComposedState`, both when the selection is dropped
	 * (including after access was withdrawn) and just before opening a different conversation.
	 */
	public clear(): void
	{
		this._scopeGeneration += 1;
		this._observedAssetInvalidations = 0;
		this._conversationId.set(undefined);
		this._intents.set([]);
		this._removingAssetIds.set(new Set());
		this._submittedMessageAssetIds.set(new Set());
		this.selectionFailure.set(null);
	}

	/**
	 * Takes a set of picked files, judges the whole message's worth of attachments at once, and starts
	 * the accepted ones transferring together.
	 *
	 * The rules are per message, not per file, so the decision is made over the files already picked
	 * plus the new ones. That is why a rejection rejects the entire pick and starts nothing: reporting
	 * per file would let a participant push past the per-message limit one file at a time.
	 *
	 * Called by: `ConversationWorkspacePresenter.selectFiles`, from the file input's change event.
	 *
	 * @param files - Files just chosen in the picker.
	 * @returns Resolves when every accepted file has finished or failed. Failures are not thrown: a
	 *   rejected pick lands in {@link selectionFailure}, and a failed transfer lands on its own row in
	 *   {@link pendingUploads} with a `Failed` phase for {@link retry}.
	 */
	public async select(files: readonly File[]): Promise<void>
	{
		const currentIntents = this._intents();
		const decision = _DecideConversationAssetFiles([...currentIntents.map(function _SelectedFile(intent) { return intent.file; }), ...files]);
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

	/**
	 * Resumes one failed transfer from the step it stopped at.
	 *
	 * The intent keeps its digest, its asset id, and its idempotency key, so a retry re-does only the
	 * step that failed: a file that already hashed is not hashed again, and one that already has a
	 * reservation uploads into that reservation instead of reserving a second one. Only a `Failed`
	 * intent is resumed, so a retry cannot race a transfer that is still running.
	 *
	 * Called by: `ConversationWorkspacePresenter.assetAction`, for a `Retry` intent from the attachment
	 * tray.
	 *
	 * @param idempotencyKey - Identifies the failed transfer; the tray passes the key it was rendered
	 *   with.
	 * @returns Resolves when the resumed transfer finishes or fails again. Nothing is thrown.
	 */
	public async retry(idempotencyKey: string): Promise<void>
	{
		const intent = this._intent(idempotencyKey);
		if (intent?.phase !== ConversationAssetTransferPhases.Failed) return;
		await this._transfer(idempotencyKey);
	}

	/**
	 * Drops a picked file from the browser, and only while the server knows nothing about it.
	 *
	 * Once a reservation exists the asset is the server's to remove, so this does nothing for an intent
	 * that has an `assetId` — {@link remove} is the path for those. The presenter calls both in order,
	 * so whichever one applies takes effect.
	 *
	 * Called by: `ConversationWorkspacePresenter.assetAction`, for a `Remove` intent.
	 *
	 * @param idempotencyKey - Identifies the picked file. An unknown key is ignored.
	 */
	public removeLocal(idempotencyKey: string): void
	{
		const intent = this._intent(idempotencyKey);
		if (intent?.assetId !== null) return;
		this._intents.update(current => current.filter(candidate => candidate.idempotencyKey !== idempotencyKey));
	}

	/**
	 * Asks the server to remove an asset it already holds.
	 *
	 * The request is only sent when the server itself said this asset may be removed (`canRemove` on the
	 * listed asset), so the UI never asks for a removal the participant is not entitled to make. The
	 * asset id is held in a removing set for the duration, so a second click while the first request is
	 * open sends nothing. The server's returned asset is adopted, which is what shows the asset as
	 * `Removed` rather than making it vanish locally.
	 *
	 * Called by: `ConversationWorkspacePresenter.assetAction`, for a `Remove` intent.
	 *
	 * @param assetId - The server-held asset to remove. Unknown, already-removing, and not-removable
	 *   ids are all ignored without an error.
	 * @returns Resolves when the request settles. A failed removal propagates from the gateway; the
	 *   removing set is released either way.
	 */
	public async remove(assetId: string): Promise<void>
	{
		// 1. Refuse the command unless a conversation is open, its list is loaded, and no removal for
		//    this asset is already in flight.
		const conversationId = this._conversationId();
		const scopeGeneration = this._scopeGeneration;
		if (conversationId === undefined || !this.assets.hasValue() || this._removingAssetIds().has(assetId)) return;
		// 2. Send nothing unless the server marked this asset removable for this participant.
		const asset = this.assets.value().find(candidate => candidate.id === assetId);
		if (asset?.canRemove !== true) return;
		// 3. Claim the asset so a second click cannot send the same removal.
		this._removingAssetIds.update(current => new Set([...current, assetId]));
		try
		{
			const removed = await this._gateway.remove(conversationId, assetId);
			// 4. Ignore the result if the conversation changed while the request was open.
			if (!this._isScopeCurrent(conversationId, scopeGeneration)) return;
			// 5. Drop any local transfer row for the same asset, then take the server's version of it.
			this._intents.update(current => current.filter(candidate => candidate.assetId !== assetId));
			this._adopt(removed, conversationId, scopeGeneration);
		}
		finally
		{
			// 6. Release the claim even on failure, so the participant can try again.
			this._removingAssetIds.update(current => new Set([...current].filter(candidate => candidate !== assetId)));
		}
	}

	/**
	 * Re-reads the file list from the server.
	 *
	 * Worth calling because an asset's state changes without the browser doing anything: scanning
	 * finishes and the asset becomes `Ready`, or the check fails and it becomes `Failed`.
	 *
	 * Called by: no production caller today; {@link observeInvalidations} is the stream-driven path that
	 * reloads the list.
	 */
	public refresh(): void { this.assets.reload(); }

	/**
	 * Records that these assets went out with a message, so they are not attached again.
	 *
	 * Call it only after the send succeeded. The server binds the assets to the message, but the file
	 * list is not re-read at that moment, so those assets still look unbound here and
	 * {@link messageAssetIds} would offer them for the next message too. Remembering them locally
	 * bridges exactly that gap; the ids stay remembered until the conversation changes, at which point
	 * the reloaded list carries the real `messageId`.
	 *
	 * Called by: `ConversationWorkspacePresenter.send`, with the ids it just sent, and only when
	 * `ConversationWorkspaceStore.send` reported success.
	 *
	 * @param assetIds - The asset ids that were sent. An empty array does nothing.
	 */
	public clearMessageSelection(assetIds: readonly string[]): void
	{
		if (assetIds.length === 0) return;
		this._submittedMessageAssetIds.update(current => new Set([...current, ...assetIds]));
	}

	/**
	 * Re-reads the file list when the conversation's live stream reports that its assets changed.
	 *
	 * The stream hands over every custom event seen so far, not just the new ones, so the count of
	 * `opencrane.conversation_assets_changed` events is compared against the count already acted on.
	 * That way one reload happens per new event, and a re-render that replays the same list reloads
	 * nothing. Events for a conversation that is no longer open are ignored.
	 *
	 * Called by: `ConversationWorkspacePresenter._OpenComposedState`, on every workspace stream update.
	 *
	 * @param conversationId - The conversation the events belong to.
	 * @param customEvents - Names of the custom events the stream has delivered for it.
	 */
	public observeInvalidations(conversationId: string, customEvents: readonly string[]): void
	{
		if (this._conversationId() !== conversationId) return;
		const observed = customEvents.filter(function _AssetInvalidation(name) { return name === "opencrane.conversation_assets_changed"; }).length;
		if (observed <= this._observedAssetInvalidations) return;
		this._observedAssetInvalidations = observed;
		this.assets.reload();
	}

	/**
	 * Carries one file from wherever it is to the server, skipping the steps already done.
	 *
	 * Hash, reserve, and upload are separate server-visible facts, so each one is checked before it is
	 * repeated. That is what makes both a retry and a resumed transfer safe: a second run cannot create
	 * a second reservation for the same file. Between every await the conversation scope is re-checked,
	 * because the participant may have switched conversation while bytes were moving, and a result that
	 * belongs to the previous conversation must not be written into the one now open.
	 */
	private async _transfer(idempotencyKey: string): Promise<void>
	{
		// 1. Capture the conversation and its scope generation, so every later step can tell whether it
		//    is still working for the conversation it started in.
		const conversationId = this._conversationId();
		const scopeGeneration = this._scopeGeneration;
		let intent = this._intent(idempotencyKey);
		if (conversationId === undefined || intent === undefined) return;
		try
		{
			// 2. Hash the bytes, unless a previous run already did. The digest is the file's identity
			//    for the reservation, so it has to exist before the server is told anything.
			if (intent.contentAddress === null)
			{
				this._patch(idempotencyKey, { phase: ConversationAssetTransferPhases.Hashing, failureCode: null });
				const contentAddress = await _ConversationAssetContentAddress(intent.file);
				if (!this._isScopeCurrent(conversationId, scopeGeneration) || this._intent(idempotencyKey) === undefined) return;
				this._patch(idempotencyKey, { contentAddress });
			}
			// 3. Re-read the intent after the await; it may have been removed in the meantime.
			intent = this._intent(idempotencyKey);
			if (intent === undefined) return;
			// 4. Reserve a place for the file, unless it already has one. The idempotency key is the
			//    same on every attempt, so a repeat reaches the same reservation instead of a new one.
			if (intent.assetId === null)
			{
				this._patch(idempotencyKey, { phase: ConversationAssetTransferPhases.Reserving, failureCode: null });
				const reserved = await this._gateway.reserve(conversationId, { idempotencyKey, displayName: intent.file.name, mediaType: intent.mediaType, byteLength: intent.file.size, contentAddress: intent.contentAddress ?? "" });
				if (!this._isScopeCurrent(conversationId, scopeGeneration)) return;
				// A reservation naming another conversation would attach this file to the wrong place,
				// so fail the transfer rather than store it.
				if (reserved.conversationId !== conversationId) throw new Error("Conversation asset reservation scope mismatch.");
				this._patch(idempotencyKey, { assetId: reserved.id });
				this._adopt(reserved, conversationId, scopeGeneration);
			}
			// 5. Send the bytes into that reservation, then take the server's asset as the truth and
			//    stop tracking the transfer locally.
			intent = this._intent(idempotencyKey);
			if (intent === undefined || intent.assetId === null) return;
			this._patch(idempotencyKey, { phase: ConversationAssetTransferPhases.Uploading, failureCode: null });
			const uploaded = await this._gateway.upload(conversationId, intent.assetId, intent.file);
			if (!this._isScopeCurrent(conversationId, scopeGeneration)) return;
			if (uploaded.conversationId !== conversationId) throw new Error("Conversation asset upload scope mismatch.");
			this._adopt(uploaded, conversationId, scopeGeneration);
			this._intents.update(current => current.filter(candidate => candidate.idempotencyKey !== idempotencyKey));
		}
		catch
		{
			// 6. Mark where it stopped, so the tray can offer a retry that resumes from that step. A
			//    failure that belongs to a conversation no longer open is dropped instead.
			if (!this._isScopeCurrent(conversationId, scopeGeneration)) return;
			const failed = this._intent(idempotencyKey);
			if (failed === undefined) return;
			const failureCode = _TransferFailureCode(failed);
			this._patch(idempotencyKey, { phase: ConversationAssetTransferPhases.Failed, failureCode });
		}
	}

	/**
	 * Puts a server-returned asset into the list, replacing the existing row or adding it.
	 *
	 * The asset is stored exactly as the server sent it, so scanning state is never guessed locally. An
	 * asset naming another conversation, or one arriving after a conversation switch, is discarded. When
	 * the list has not loaded yet there is nothing to merge into, so the read is reloaded instead.
	 */
	private _adopt(asset: ConversationAsset, conversationId: string, scopeGeneration: number): void
	{
		if (asset.conversationId !== conversationId || !this._isScopeCurrent(conversationId, scopeGeneration)) return;
		if (!this.assets.hasValue()) { this.assets.reload(); return; }
		const current = this.assets.value();
		const index = current.findIndex(candidate => candidate.id === asset.id);
		if (index < 0) this.assets.set([...current, asset]);
		else this.assets.set(current.map(candidate => candidate.id === asset.id ? asset : candidate));
	}

	/** Finds one running transfer by its key, or undefined once it has finished or been removed. */
	private _intent(idempotencyKey: string): ConversationAssetUploadIntent | undefined { return this._intents().find(candidate => candidate.idempotencyKey === idempotencyKey); }

	/**
	 * Says whether a step that started earlier is still working for the conversation that is open now.
	 *
	 * Both halves are needed. The id catches a switch to a different conversation, and the generation
	 * catches leaving and returning to the same one — where the id would match again but the transfers
	 * and file bytes it started with are gone.
	 */
	private _isScopeCurrent(conversationId: string, scopeGeneration: number): boolean { return this._conversationId() === conversationId && this._scopeGeneration === scopeGeneration; }

	/** Updates the named fields of one transfer and leaves the rest of it, and the other rows, alone. */
	private _patch(idempotencyKey: string, patch: Partial<ConversationAssetUploadIntent>): void
	{
		this._intents.update(current => current.map(intent => intent.idempotencyKey === idempotencyKey ? { ...intent, ...patch } : intent));
	}

	/**
	 * Works out which files the next message should carry.
	 *
	 * Four conditions have to hold, and each one excludes a real case: the file must be a participant
	 * upload, so a file the agent produced is not sent back; it must be `Ready`, so bytes still
	 * scanning or already rejected are never attached; its `messageId` must be null, so a file that
	 * already belongs to an earlier message is not attached twice; and it must not be in the
	 * locally-remembered sent set, which covers the window after a send before the list is re-read.
	 */
	private _MessageAssetIds(): readonly string[]
	{
		if (!this.assets.hasValue()) return [];
		const submitted = this._submittedMessageAssetIds();
		return this.assets.value().filter(asset => asset.provenance === ConversationAssetProvenance.ParticipantUpload && asset.state === ConversationAssetLifecycle.Ready && asset.messageId === null && !submitted.has(asset.id)).map(asset => asset.id);
	}
}

/**
 * Works out which step a transfer died on, from how far its intent got.
 *
 * The failure is read off the intent's own fields rather than the thrown error, so nothing from the
 * transport reaches the UI: no digest means hashing failed, no asset id means the reservation failed,
 * and otherwise the upload did.
 */
function _TransferFailureCode(intent: ConversationAssetUploadIntent): PendingConversationAssetUpload["failureCode"]
{
	if (intent.contentAddress === null) return "hash_failed";
	if (intent.assetId === null) return "reservation_failed";
	return "upload_failed";
}

/**
 * Turns a transfer into the row the UI renders, without the file itself.
 *
 * The `File` is left behind on purpose: presentation only needs the name, type, size, and progress, and
 * leaving the bytes out of the view model keeps them from being retained by anything downstream. The
 * row can only be removed locally while no reservation exists, which is why `canRemove` is derived from
 * a missing `assetId`.
 */
function _PendingUpload(intent: ConversationAssetUploadIntent): PendingConversationAssetUpload
{
	return { idempotencyKey: intent.idempotencyKey, displayName: intent.file.name, mediaType: intent.mediaType, byteLength: intent.file.size, phase: intent.phase, canRemove: intent.assetId === null, uploadProgressPercent: null, failureCode: intent.failureCode };
}
