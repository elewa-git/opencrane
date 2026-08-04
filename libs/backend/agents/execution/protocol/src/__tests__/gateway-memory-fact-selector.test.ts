import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { GatewayMemoryFactSelector } from "../gateway-memory-fact-selector.js";

/** Compute the canonical content digest the selector is expected to emit. */
function _digest(content: string): string
{
	return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

describe("GatewayMemoryFactSelector", function _describeGatewayMemoryFactSelector()
{
	it("returns digested references sorted by fact id and never fact text", async function _digestsAndSorts()
	{
		const query = vi.fn().mockResolvedValue({ facts: [{ factId: "fact-b", content: "second fact" }, { factId: "fact-a", content: "first fact" }] });
		const selector = new GatewayMemoryFactSelector({ query } as never);

		await expect(selector.select({ siloId: "silo-1", cogneeDatasetId: "cognee-personal-1", subjectId: "user-1", queryText: "what did we decide", maxFacts: 8 })).resolves.toEqual([
			{ factId: "fact-a", contentDigest: _digest("first fact") },
			{ factId: "fact-b", contentDigest: _digest("second fact") },
		]);
		expect(query).toHaveBeenCalledWith({ siloId: "silo-1", cogneeDatasetId: "cognee-personal-1", subjectId: "user-1", query: "what did we decide", maxResults: 8 });
	});

	it("propagates a gateway failure instead of returning a silently empty selection", async function _propagatesFailure()
	{
		const selector = new GatewayMemoryFactSelector({ query: vi.fn().mockRejectedValue(new Error("gateway unreachable")) } as never);

		await expect(selector.select({ siloId: "silo-1", cogneeDatasetId: "cognee-personal-1", subjectId: "user-1", queryText: "question", maxFacts: 8 })).rejects.toThrow(/gateway unreachable/);
	});
});
