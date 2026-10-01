import { PreparedFileOpenCompletionOutcomes, PreparedFileOpenModes, type PreparedFileOpenReservation } from "./platform-bridge.types";

/** Maximum time a file read may hold an unused browser reservation. */
const _RESERVATION_TIMEOUT_MS: number = 30_000;
/** Time retained for the browser to consume a completed object URL. */
const _OBJECT_URL_LIFETIME_MS: number = 60_000;

/** Browser-owned implementation of one prepared file action. */
export class _WebPreparedFileOpen implements PreparedFileOpenReservation
{
	/** Requested browser action. */
	private readonly _mode: PreparedFileOpenModes;
	/** Preview target reserved during the initiating user action. */
	private readonly _previewWindow: Window | null;
	/** Timer bounding a reservation that has not completed. */
	private _reservationTimer: ReturnType<typeof setTimeout> | null;
	/** Timer bounding an object URL after the browser action. */
	private _revokeTimer: ReturnType<typeof setTimeout> | null = null;
	/** Object URL created solely for this reservation. */
	private _objectUrl: string | null = null;
	/** Whether this reservation still accepts completion. */
	private _active: boolean = true;
	/** Whether the browser action completed before cleanup. */
	private _completed: boolean = false;

	/** Start a bounded reservation around an optional preview target. */
	public constructor(mode: PreparedFileOpenModes, previewWindow: Window | null)
	{
		this._mode = mode;
		this._previewWindow = previewWindow;
		this._reservationTimer = setTimeout(this._Expire.bind(this), _RESERVATION_TIMEOUT_MS);
	}

	/** Complete this reservation with browser-owned bytes. */
	public complete(blob: Blob, filename: string): PreparedFileOpenCompletionOutcomes
	{
		if (!this._active)
			return PreparedFileOpenCompletionOutcomes.Unavailable;
		this._active = false;
		this._ClearReservationTimer();

		if (this._mode === PreparedFileOpenModes.Preview && this._previewWindow?.closed !== false)
			return PreparedFileOpenCompletionOutcomes.Unavailable;

		try
		{
			this._objectUrl = URL.createObjectURL(blob);
			if (this._mode === PreparedFileOpenModes.Preview)
				this._Preview(this._objectUrl);
			else
				this._Download(this._objectUrl, filename);
			this._completed = true;
			this._revokeTimer = setTimeout(this._Revoke.bind(this), _OBJECT_URL_LIFETIME_MS);
			return PreparedFileOpenCompletionOutcomes.Completed;
		}
		catch
		{
			this._Revoke();
			this._CloseUnusedPreview();
			return PreparedFileOpenCompletionOutcomes.Unavailable;
		}
	}

	/** Cancel this reservation and release its browser resources. */
	public cancel(): void
	{
		this._active = false;
		this._ClearReservationTimer();
		this._ClearRevokeTimer();
		this._Revoke();
		this._CloseUnusedPreview();
	}

	/** Navigate the already-reserved target to the internally-created object URL. */
	private _Preview(objectUrl: string): void
	{
		if (this._previewWindow === null)
			throw new Error("Preview target is unavailable.");
		this._previewWindow.location.replace(objectUrl);
	}

	/** Trigger a browser download with the projected filename. */
	private _Download(objectUrl: string, filename: string): void
	{
		const anchor = document.createElement("a");
		anchor.download = filename;
		anchor.href = objectUrl;
		anchor.style.display = "none";
		document.body.append(anchor);
		try
		{
			anchor.click();
		}
		finally
		{
			anchor.remove();
		}
	}

	/** Expire an incomplete reservation without allocating an object URL. */
	private _Expire(): void
	{
		if (!this._active)
			return;
		this._active = false;
		this._reservationTimer = null;
		this._CloseUnusedPreview();
	}

	/** Close a preview only while it has not been navigated successfully. */
	private _CloseUnusedPreview(): void
	{
		if (this._completed || this._previewWindow === null || this._previewWindow.closed)
			return;
		try
		{
			this._previewWindow.close();
		}
		catch
		{
			// The reservation is already terminal even if the runtime refuses cleanup.
		}
	}

	/** Revoke this reservation's object URL at most once. */
	private _Revoke(): void
	{
		if (this._objectUrl === null)
			return;
		const objectUrl = this._objectUrl;
		this._objectUrl = null;
		this._ClearRevokeTimer();
		try
		{
			URL.revokeObjectURL(objectUrl);
		}
		catch
		{
			// The URL remains terminal so cleanup is never retried against reused state.
		}
	}

	/** Release the incomplete-reservation timer. */
	private _ClearReservationTimer(): void
	{
		if (this._reservationTimer !== null)
			clearTimeout(this._reservationTimer);
		this._reservationTimer = null;
	}

	/** Release the completed-action cleanup timer. */
	private _ClearRevokeTimer(): void
	{
		if (this._revokeTimer !== null)
			clearTimeout(this._revokeTimer);
		this._revokeTimer = null;
	}
}
