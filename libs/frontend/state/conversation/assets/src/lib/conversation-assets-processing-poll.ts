/** Owns the one bounded timer used while a selected asset remains Processing. */
export class ConversationAssetsProcessingPoll
{
	private _timer: ReturnType<typeof setTimeout> | null = null;
	private _attempts = 0;

	/** Receives current scope state and the explicit list refresh effect. */
	public constructor(private readonly _snapshot: () => { readonly conversationId: string | undefined; readonly scopeGeneration: number; readonly loaded: boolean; readonly processing: boolean }, private readonly _reload: () => void) {}

	/** Starts or stops the next fallback read from the current safe projection. */
	public reconcile(): void
	{
		const snapshot = this._snapshot();
		if (snapshot.conversationId === undefined)
		{
			this.cancel();
			return;
		}
		if (!snapshot.loaded)
			return;
		if (!snapshot.processing)
		{
			this.cancel();
			this._attempts = 0;
			return;
		}
		if (this._attempts >= 12 || this._timer !== null)
			return;
		this._timer = setTimeout(this._poll.bind(this, snapshot.conversationId, snapshot.scopeGeneration), 5_000);
	}

	/** Cancels the timer and its budget when conversation selection or access changes. */
	public reset(): void
	{
		this.cancel();
		this._attempts = 0;
	}

	/** Cancels the timer without changing any conversation or asset state. */
	public cancel(): void
	{
		if (this._timer === null)
			return;
		clearTimeout(this._timer);
		this._timer = null;
	}

	/** Rechecks the captured scope before spending one refresh attempt. */
	private _poll(conversationId: string, scopeGeneration: number): void
	{
		this._timer = null;
		const snapshot = this._snapshot();
		if (snapshot.conversationId !== conversationId || snapshot.scopeGeneration !== scopeGeneration || !snapshot.processing)
			return;
		this._attempts += 1;
		this._reload();
		this.reconcile();
	}
}
