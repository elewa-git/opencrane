import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";

/**
 * Holds the history port and the KurrentDB client cleanup owned by the OpenCrane process.
 *
 * Startup injects `historyStore` into the history authorities; shutdown must call `close` after
 * workers drain so their streams do not lose the transport beneath them.
 */
export interface OpenCraneHistoryStoreComposition
{
	/** Supplies the KurrentDB-backed port to application history authorities. */
	readonly historyStore: HistoryStore;
	/** Releases the KurrentDB client after listeners and workers have drained. */
	readonly close: () => Promise<void>;
}
