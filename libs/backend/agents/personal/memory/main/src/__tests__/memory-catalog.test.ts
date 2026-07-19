import { describe, expect, it, vi } from "vitest";

import { __RecordMemoryFact } from "../memory-catalog.js";

describe("memory catalog", function ()
{
	it("records provenance metadata without accepting fact content", async function ()
	{
		const recordFactAtomically = vi.fn().mockResolvedValue({ status: "recorded" });
		const result = await __RecordMemoryFact({ recordFactAtomically }, { datasetId: "dataset-1", cogneeExternalId: "cognee-fact-1", contentDigest: `sha256:${"a".repeat(64)}`, consentState: "explicit", sensitivity: "ordinary", provenance: { questionId: "q1" }, source: { artifactRevisionId: null, messageId: "message-1", explicitUserStatement: false }, supersedesFactId: null, recordedBy: "user-1", idempotencyKey: "fact-1" });
		expect(result).toEqual({ outcome: "recorded", idempotent: false });
		expect(recordFactAtomically).toHaveBeenCalledOnce();
	});

	it("rejects ambiguous provenance", async function ()
	{
		const recordFactAtomically = vi.fn();
		const result = await __RecordMemoryFact({ recordFactAtomically }, { datasetId: "dataset-1", cogneeExternalId: "cognee-fact-1", contentDigest: `sha256:${"a".repeat(64)}`, consentState: "explicit", sensitivity: "ordinary", provenance: {}, source: { artifactRevisionId: "artifact-revision-1", messageId: "message-1", explicitUserStatement: false }, supersedesFactId: null, recordedBy: "user-1", idempotencyKey: "fact-1" });
		expect(result).toEqual({ outcome: "denied", reason: "invalid_command" });
		expect(recordFactAtomically).not.toHaveBeenCalled();
	});
});
