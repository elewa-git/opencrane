import { type KurrentDBClient } from "@kurrent/kurrentdb-client";
import { describe, expect, it, vi } from "vitest";

import { HistoryExpectedRevisions } from "../history-store.types";
import { _KurrentHistoryStore } from "../kurrent-history-store";

describe("_KurrentHistoryStore", function ()
{
	it("keeps a no-stream append conditional and returns Kurrent's committed revision", async function ()
	{
		const appendToStream = vi.fn().mockResolvedValue({ nextExpectedRevision: 4n });
		const client = { appendToStream } as unknown as KurrentDBClient;
		const store = new _KurrentHistoryStore(client);

		const receipt = await store.append({ streamName: "conversation-1", expectedRevision: HistoryExpectedRevisions.NoStream, events: [{ id: "b9d6434b-a3a9-4478-a78f-cf08a479c7f1", type: "conversation.created.v1", data: { conversationId: "1" }, metadata: {} }] });

		expect(appendToStream).toHaveBeenCalledWith("conversation-1", expect.any(Array), { streamState: "no_stream" });
		expect(receipt).toEqual({ streamName: "conversation-1", revision: 4n });
	});

	it("submits every expected head with cross-stream records in one Kurrent append", async function ()
	{
		const appendRecords = vi.fn().mockResolvedValue({ responses: [{ streamName: "conversation-1", revision: 7n }, { streamName: "run-1", revision: 2n }] });
		const client = { appendRecords } as unknown as KurrentDBClient;
		const store = new _KurrentHistoryStore(client);

		const receipts = await store.appendAtomic({ expectedHeads: [{ streamName: "conversation-1", revision: 6n }, { streamName: "run-1", revision: HistoryExpectedRevisions.NoStream }], appends: [{ streamName: "conversation-1", expectedRevision: 6n, events: [{ id: "21331a84-1844-4ba3-8e94-3a4f55204ccb", type: "conversation.message.v1", data: { entryId: "1" }, metadata: {} }] }, { streamName: "run-1", expectedRevision: HistoryExpectedRevisions.NoStream, events: [{ id: "71b5fef0-f43b-4fb8-9a76-724460ca84d4", type: "run.started.v1", data: { runId: "1" }, metadata: {} }] }] });

		expect(appendRecords).toHaveBeenCalledOnce();
		expect(receipts).toEqual([{ streamName: "conversation-1", revision: 7n }, { streamName: "run-1", revision: 2n }]);
	});

	it("rejects a cross-stream append whose declared revision has no matching head", async function ()
	{
		const appendRecords = vi.fn();
		const client = { appendRecords } as unknown as KurrentDBClient;
		const store = new _KurrentHistoryStore(client);

		await expect(store.appendAtomic({ expectedHeads: [], appends: [{ streamName: "conversation-1", expectedRevision: HistoryExpectedRevisions.NoStream, events: [{ id: "8e0e2498-819f-4339-8d78-4f4c7377e20b", type: "conversation.created.v1", data: { conversationId: "1" }, metadata: {} }] }] })).rejects.toThrow("omits 'conversation-1' expected revision");

		expect(appendRecords).not.toHaveBeenCalled();
	});
});
