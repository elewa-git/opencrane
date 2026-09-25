/** Result of binding a local folder to a project (desktop only). */
export interface BoundFolder
{
	/** Absolute path of the bound folder. */
	path: string;
	/** Display label (basename) for the folder. */
	label: string;
}

/** Active runtime observation of one authentication window. */
export interface AuthenticationWindowObservation
{
	/** Stop observing the window and release runtime resources. */
	stop(): void;
}

/** Runtime action selected for one prepared file open. */
export enum PreparedFileOpenModes
{
	/** Reserve a blank browser target before the file read begins. */
	Preview = "preview",
	/** Trigger a browser download after the file read completes. */
	Download = "download"
}

/** Result of completing one prepared file open. */
export enum PreparedFileOpenCompletionOutcomes
{
	/** The runtime accepted the preview navigation or download click. */
	Completed = "completed",
	/** The reservation expired or the runtime could not perform the action. */
	Unavailable = "unavailable"
}

/** Short-lived runtime reservation for opening one file. */
export interface PreparedFileOpenReservation
{
	/**
	 * Open browser-owned bytes with the projected display name.
	 * The first call consumes the reservation even when the runtime returns Unavailable;
	 * every later completion attempt returns Unavailable without performing another action.
	 * @returns Whether the runtime completed the reserved action.
	 */
	complete(blob: Blob, filename: string): PreparedFileOpenCompletionOutcomes;

	/** Cancel the reservation idempotently and release every runtime resource it owns. */
	cancel(): void;
}

/**
 * Capabilities that differ by runtime (browser vs desktop).
 *
 * Features depend on this abstraction rather than any concrete runtime, so the
 * web app and a future desktop app (Electron/Tauri) can supply different
 * implementations without the feature code changing.
 */
export interface PlatformBridge
{
	/** Whether the app is running in a desktop shell with native capabilities. */
	readonly isDesktop: boolean;

	/**
	 * Opens a native folder picker and binds the chosen folder to a project.
	 * Desktop-only; the web implementation rejects with an unsupported error.
	 */
	bindFolder(projectId: string): Promise<BoundFolder>;

	/**
	 * Open a runtime-owned authentication window and report when the user closes it.
	 * @param path - Same-origin authentication path selected by the calling feature.
	 * @param onClosed - Callback invoked once after the opened window closes.
	 * @returns A stoppable observation, or null when the runtime refused to open a window.
	 */
	openAuthenticationWindow(path: string, onClosed: () => void): AuthenticationWindowObservation | null;

	/**
	 * Reserve one browser file action while the initiating user activation is current.
	 * @returns A bounded reservation, or null when the runtime refused the action.
	 */
	prepareFileOpen(mode: PreparedFileOpenModes): PreparedFileOpenReservation | null;
}
