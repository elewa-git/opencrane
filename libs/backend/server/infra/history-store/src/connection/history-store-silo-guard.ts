import { randomUUID } from "node:crypto";

import { HistoryExpectedRevisions, type HistoryStore } from "../history-store.types";

/** Well-known stream that names the one silo a KurrentDB instance may serve. */
export const _SILO_SENTINEL_STREAM = "opencrane-silo";

/** Event type of the single sentinel event; the stream never receives a second one. */
const _SENTINEL_EVENT_TYPE = "opencrane.silo.v1";

/**
 * Refuses to start against a KurrentDB instance that another silo already claimed.
 *
 * Conversation and computer stream names carry no silo id (`conversation-{id}`,
 * `conversation-computer-{id}`), so silo isolation rests on every silo owning its own KurrentDB
 * endpoint. This guard turns that deployment assumption into a runtime check: the first server to
 * start writes one sentinel event carrying its silo id, fenced with `NoStream` so two racing replicas
 * cannot both create it, and every later start compares its configured silo id with the recorded one.
 * A mismatch means two silos point at one database, and the process must not start.
 *
 * Called by: `_Main` in `apps/opencrane/src/index.ts`, after the history store is composed and before
 * any worker reads or appends a stream.
 *
 * @throws When the sentinel names a different silo, when it is malformed, or when the append fails for
 *   a reason other than another replica having written the same sentinel first.
 */
export async function _AssertHistoryStoreSilo(historyStore: Pick<HistoryStore, "append" | "readStream">, siloId: string): Promise<void>
{
	if (!siloId)
		throw new Error("History store silo guard requires a configured silo id");
	const recorded = await _RecordedSiloId(historyStore);
	if (recorded !== null)
	{
		_AssertSameSilo(recorded, siloId);
		return;
	}
	try
	{
		await historyStore.append({ streamName: _SILO_SENTINEL_STREAM, expectedRevision: HistoryExpectedRevisions.NoStream, events: [{ id: randomUUID(), type: _SENTINEL_EVENT_TYPE, data: { siloId }, metadata: { siloId } }] });
	}
	catch (error)
	{
		// Another replica may have created the sentinel between our read and append; only that outcome is acceptable.
		const raced = await _RecordedSiloId(historyStore);
		if (raced === null)
			throw error;
		_AssertSameSilo(raced, siloId);
	}
}

/** Reads the silo id from the first sentinel event, or returns null when the stream does not exist yet. */
async function _RecordedSiloId(historyStore: Pick<HistoryStore, "readStream">): Promise<string | null>
{
	for await (const event of historyStore.readStream({ streamName: _SILO_SENTINEL_STREAM }))
	{
		const recorded = event.data["siloId"];
		if (event.type !== _SENTINEL_EVENT_TYPE || typeof recorded !== "string" || !recorded)
			throw new Error(`History store stream ${_SILO_SENTINEL_STREAM} holds a malformed silo sentinel`);
		return recorded;
	}
	return null;
}

/** Fails startup when the database already belongs to another silo. */
function _AssertSameSilo(recorded: string, siloId: string): void
{
	if (recorded !== siloId)
		throw new Error(`History store already belongs to silo ${recorded}; this server is configured for silo ${siloId}`);
}
