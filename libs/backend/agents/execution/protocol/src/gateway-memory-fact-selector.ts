import { createHash } from "node:crypto";

import type { PersonalMemoryFactSelector, SelectPersonalMemoryFactsInput, SelectedMemoryFactReference } from "@opencrane/backend/agents/execution/inputs";
import type { MemoryGatewayClient } from "@opencrane/backend/_server/memory-gateway-client";

/**
 * Admission-time fact selector over the authenticated memory-gateway client.
 *
 * It recalls facts for the verified subject against the identity-resolved dataset, digests each
 * fact's content locally, and returns only `factId` + `contentDigest` references sorted by fact id.
 * Fact text never leaves this adapter, so nothing recalled here can land in Postgres; the digest is
 * what later compile-time statement loading verifies against.
 */
export class GatewayMemoryFactSelector implements PersonalMemoryFactSelector
{
	/** Authenticated read-only memory-gateway boundary. */
	private readonly client: MemoryGatewayClient;

	/** Creates the selector over one shared memory-gateway client instance. */
	constructor(client: MemoryGatewayClient)
	{
		this.client = client;
	}

	/** Selects at most `maxFacts` digested fact references; transport failures propagate to fail admission closed. */
	async select(input: SelectPersonalMemoryFactsInput): Promise<readonly SelectedMemoryFactReference[]>
	{
		// 1. Recall through the gateway only; the dataset comes from verified identity, never the caller.
		const result = await this.client.query({ siloId: input.siloId, cogneeDatasetId: input.cogneeDatasetId, subjectId: input.subjectId, query: input.queryText, maxResults: input.maxFacts });

		// 2. Digest each fact's content so the snapshot pins bytes, not mutable remote state.
		const references = result.facts.map(function _reference(fact): SelectedMemoryFactReference
		{
			return { factId: fact.factId, contentDigest: `sha256:${createHash("sha256").update(fact.content, "utf8").digest("hex")}` };
		});

		// 3. Sort by fact id so the frozen reference order is canonical regardless of recall ranking.
		return references.sort(function _byFactId(left, right): number
		{
			if (left.factId < right.factId) return -1;
			if (left.factId > right.factId) return 1;
			return 0;
		});
	}
}
