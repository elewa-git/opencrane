import { DestroyRef, Injectable, inject } from "@angular/core";

import { ConversationAssetActionKinds, type ConversationAssetActionIntent } from "@opencrane/features/conversation-assets";
import { PLATFORM_BRIDGE, PreparedFileOpenCompletionOutcomes, PreparedFileOpenModes, type PreparedFileOpenReservation } from "@opencrane/platform";
import { ConversationAssetContentCommandStates, ConversationAssetContentStore, ConversationAssetDisposition } from "@opencrane/state/conversation/assets";

/** Coordinates one typed file intent across the scoped content store and runtime bridge. */
@Injectable()
export class ConversationAssetContentCoordinator
{
	/** Owns access-checked byte reads and their current per-asset feedback. */
	private readonly _content = inject(ConversationAssetContentStore);
	/** Owns popup, download-anchor and object-URL side effects. */
	private readonly _platform = inject(PLATFORM_BRIDGE);
	/** Component lifetime used to cancel uncompleted runtime reservations. */
	private readonly _destroyRef = inject(DestroyRef);
	/** Prepared actions still waiting for an authorized byte read. */
	private readonly _reservations = new Map<string, PreparedFileOpenReservation>();

	/** Cancel every prepared action when the component-scoped owner is destroyed. */
	public constructor()
	{
		this._destroyRef.onDestroy(this.clear.bind(this));
	}

	/** Return one asset's local command state for presentation mapping. */
	public state(assetId: string): ConversationAssetContentCommandStates { return this._content.state(assetId); }

	/** Cancel uncompleted browser actions before a selection or access scope is discarded. */
	public clear(): void
	{
		for (const reservation of this._reservations.values()) reservation.cancel();
		this._reservations.clear();
	}

	/** Reserve a browser action synchronously, then read and complete one current Ready asset. */
	public async open(intent: ConversationAssetActionIntent): Promise<void>
	{
		if (this._content.state(intent.assetId) === ConversationAssetContentCommandStates.Loading)
			return;
		const disposition = this._content.disposition(intent.assetId);
		const mode = _PreparedMode(intent.kind, disposition);
		if (mode === null)
			return;

		const reservation = this._Prepare(mode);
		if (reservation === null)
		{
			this._content.markFailed(intent.assetId);
			return;
		}
		this._reservations.set(intent.assetId, reservation);

		const content = await this._content.read(intent.assetId);
		if (this._reservations.get(intent.assetId) !== reservation)
		{
			reservation.cancel();
			return;
		}
		if (content === null || !_DispositionMatchesMode(content.disposition, mode))
		{
			reservation.cancel();
			this._reservations.delete(intent.assetId);
			if (content !== null)
				this._content.markFailed(intent.assetId);
			return;
		}

		try
		{
			if (reservation.complete(content.blob, content.displayName) === PreparedFileOpenCompletionOutcomes.Unavailable)
				this._content.markFailed(intent.assetId);
		}
		catch
		{
			reservation.cancel();
			this._content.markFailed(intent.assetId);
		}
		finally { this._reservations.delete(intent.assetId); }
	}

	/** Translate a runtime refusal into a null reservation for visible command failure. */
	private _Prepare(mode: PreparedFileOpenModes): PreparedFileOpenReservation | null
	{
		try { return this._platform.prepareFileOpen(mode); }
		catch { return null; }
	}
}

/** Select the prepared runtime action granted by the current asset projection and user intent. */
function _PreparedMode(kind: ConversationAssetActionKinds, disposition: ConversationAssetDisposition | null): PreparedFileOpenModes | null
{
	switch (kind)
	{
		case ConversationAssetActionKinds.Preview:
			return disposition === ConversationAssetDisposition.Preview ? PreparedFileOpenModes.Preview : null;
		case ConversationAssetActionKinds.Download:
			return disposition === null ? null : PreparedFileOpenModes.Download;
		case ConversationAssetActionKinds.Open:
			if (disposition === ConversationAssetDisposition.Preview)
				return PreparedFileOpenModes.Preview;
			if (disposition === ConversationAssetDisposition.Download)
				return PreparedFileOpenModes.Download;
			return null;
		case ConversationAssetActionKinds.Retry:
		case ConversationAssetActionKinds.Remove:
		case ConversationAssetActionKinds.FocusMessage:
			return null;
	}
}

/** Prevent a changed disposition from completing the browser action reserved before the read. */
function _DispositionMatchesMode(disposition: ConversationAssetDisposition, mode: PreparedFileOpenModes): boolean
{
	return mode === PreparedFileOpenModes.Download || disposition === ConversationAssetDisposition.Preview;
}
