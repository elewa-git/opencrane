import { createHash } from "node:crypto";

import type { PersonalMemoryFactSelector, SelectPersonalMemoryFactsInput, SelectedMemoryFactReference } from "@opencrane/backend/agents/execution/inputs";
import type { MemoryGatewayClient } from "@opencrane/backend/server/infra/memory-gateway-client";

/**
 * Picks the memory facts to freeze into a snapshot at admission time, using the memory gateway.
 *
 * It recalls facts for the verified subject from the dataset that identity resolved to, hashes each
 * fact's text locally, and returns only `factId` + `contentDigest`, sorted by fact id. Fact text
 * never leaves this class, so nothing recalled here can reach Postgres; the digest is what the later
 * compile step checks the text against, which is how a run gets exactly the memory it was admitted
 * with or none at all.
 *
 * Called by: apps/opencrane/src/index.ts passes one to `__CreatePersonalRunAdmissionPort`.
 *
 * @implements PersonalMemoryFactSelector
 */
export class GatewayMemoryFactSelector implements PersonalMemoryFactSelector
{
	/** Read-only client for the memory gateway. */
	private readonly client: MemoryGatewayClient;

	/** Creates the selector over one shared memory-gateway client instance. */
	constructor(client: MemoryGatewayClient)
	{
		this.client = client;
	}

	/**
	 * Return at most `maxFacts` fact references with digests, sorted by fact id.
	 *
	 * @param input - Silo, dataset, verified subject, query text, and the maximum number of facts.
	 * @returns Fact ids with the digest of each fact's text at this moment. No fact text.
	 * @throws Whatever the gateway client throws. It is deliberately not caught: admission fails rather
	 * than admitting a run with a silently smaller memory set than the user expects.
	 */
	async select(input: SelectPersonalMemoryFactsInput): Promise<readonly SelectedMemoryFactReference[]>
	{
		// 1. Recall through the gateway only; the dataset comes from verified identity, never the caller.
		const result = await this.client.query({ siloId: input.siloId, cogneeDatasetId: input.cogneeDatasetId, subjectId: input.subjectId, query: input.queryText, maxResults: input.maxFacts });

		// 2. Hash each fact's text, so the snapshot pins the exact text rather than whatever the gateway holds later.
		const references = result.facts.map(function _reference(fact): SelectedMemoryFactReference
		{
			return { factId: fact.factId, contentDigest: `sha256:${createHash("sha256").update(fact.content, "utf8").digest("hex")}` };
		});

		// 3. Sort by fact id, so the order is the same no matter how the gateway ranked the results.
		return references.sort(function _byFactId(left, right): number
		{
			if (left.factId < right.factId) return -1;
			if (left.factId > right.factId) return 1;
			return 0;
		});
	}
}
