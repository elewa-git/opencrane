import { createHash } from "node:crypto";

import { ___DoWithTrace } from "@opencrane/observability";

import { __CreateCogneeSession, MemoryGatewayRemoteRefusalError } from "./cognee-http.js";
import { __EncodeScopedEnvelope, __ParseAddedFactId, __ParseScopedFacts, __ParseSearchFacts } from "./cognee-payloads.js";
import { __AssertMemoryProvenanceComplete } from "./memory-provenance.js";
import { __AssertPersonalMemoryRecordResult } from "./personal-memory-record.js";
import type { CogneeMemoryGatewayHttpOptions, PersonalMemoryDeliveryKey } from "./http-cognee-memory-gateway-client.types.js";
import type { MemoryCorrectionCommand, MemoryForgetCommand, MemoryGatewayClient, MemoryQueryCommand, MemoryQueryResult, PersonalMemoryRecordCommand, PersonalMemoryRecordResult, ScopedMemoryInjectionCommand, ScopedMemoryRecallCommand, ScopedMemoryRecallResult } from "./memory-gateway-client.types.js";

/** Cognee search mode returning stored passages rather than a generated completion. */
const _SEARCH_TYPE = "CHUNKS";

/** Compute the canonical lowercase content address recorded as durable write evidence. */
function _ContentDigest(content: string): string
{
	return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

/**
 * Create the Cognee-backed memory gateway client.
 *
 * Cognee holds durable fact content; this adapter adds the two guarantees the REST API does not
 * provide. A delivery ledger makes `recordPersonalFact` idempotent per delivery key, and the same
 * ledger resolves which dataset holds a gateway-minted fact so a correction or forget can address
 * it. Every recall is validated: an unrecognised response is a protocol violation, never a silently
 * empty result, and a scoped record that cannot prove complete provenance is dropped rather than
 * returned with partial attribution.
 *
 * Dataset selection always comes from the caller's frozen `cogneeDatasetId` — never from a subject
 * id, scope coordinate, or caller-derived dataset name.
 *
 * @param options - Memory-gateway origin, timeout, delivery ledger, and test seams.
 * @returns A client whose results are only ever gateway-originated.
 */
export function __CreateHttpCogneeMemoryGatewayClient(options: CogneeMemoryGatewayHttpOptions): MemoryGatewayClient
{
	if (!Number.isSafeInteger(options.requestTimeoutMilliseconds) || options.requestTimeoutMilliseconds < 1_000 || options.requestTimeoutMilliseconds > 300_000)
	{
		throw new Error("Cognee memory gateway client requires a 1-300s request timeout");
	}
	const session = __CreateCogneeSession(options);
	const ledger = options.ledger;

	/** Search one frozen dataset and return the raw Cognee response for the caller to project. */
	async function _Search(datasets: readonly string[], query: string, maxResults: number): Promise<unknown>
	{
		return session.request("/api/v1/search", "POST", { query, search_type: _SEARCH_TYPE, datasets, top_k: maxResults });
	}

	/** Add one record to a dataset and return the gateway-minted fact identifier. */
	async function _Add(dataset: string, content: string): Promise<string>
	{
		const added = await session.request("/api/v1/add", "POST", { data: content, datasetName: dataset });
		return __ParseAddedFactId(added);
	}

	/** Build the durable knowledge graph before reporting a write as replay-ready. */
	async function _Cognify(dataset: string): Promise<void>
	{
		await session.request("/api/v1/cognify", "POST", { datasets: [dataset] });
	}

	/** Resolve the dataset holding one gateway-minted fact, failing closed when it is unknown. */
	async function _FactDataset(siloId: string, subjectId: string, factId: string, operation: string): Promise<string>
	{
		const resolved = await ledger.resolveFactDataset({ siloId, subjectId, factId });
		if (resolved === null) throw new MemoryGatewayRemoteRefusalError(operation);
		return resolved.cogneeDatasetId;
	}

	/** Project a completed delivery into the canonical recorded evidence shape. */
	function _RecordedEvidence(record: { readonly contentDigest: string; readonly cogneeExternalId: string }, idempotent: boolean): PersonalMemoryRecordResult
	{
		return __AssertPersonalMemoryRecordResult({ outcome: "recorded", idempotent, cogneeExternalId: record.cogneeExternalId, contentDigest: record.contentDigest });
	}

	/** Apply replay semantics for a delivery key that already holds durable evidence. */
	function _ReplayOutcome(existing: { readonly contentDigest: string; readonly cogneeExternalId: string }, contentDigest: string): PersonalMemoryRecordResult
	{
		// A reused key with different content is a conflict: reusing the stored fact would silently
		// drop the new content, and writing it would break the key's replay guarantee.
		if (existing.contentDigest !== contentDigest) return { outcome: "denied", reason: "idempotency_conflict" };
		return _RecordedEvidence(existing, true);
	}

	return {
		async query(command: MemoryQueryCommand): Promise<MemoryQueryResult>
		{
			return ___DoWithTrace("memory_gateway.personal.query", { siloId: command.siloId, cogneeDatasetId: command.cogneeDatasetId }, async function _query(): Promise<MemoryQueryResult>
			{
				const payload = await _Search([command.cogneeDatasetId], command.query, command.maxResults);
				return { facts: __ParseSearchFacts(payload, command.maxResults) };
			});
		},

		async recordPersonalFact(command: PersonalMemoryRecordCommand): Promise<PersonalMemoryRecordResult>
		{
			return ___DoWithTrace("memory_gateway.personal.record", { siloId: command.siloId, cogneeDatasetId: command.cogneeDatasetId }, async function _record(): Promise<PersonalMemoryRecordResult>
			{
				const key: PersonalMemoryDeliveryKey = { siloId: command.siloId, cogneeDatasetId: command.cogneeDatasetId, subjectId: command.subjectId, idempotencyKey: command.idempotencyKey };
				const contentDigest = _ContentDigest(command.content);

				// 1. A known delivery key answers without any remote write.
				const existing = await ledger.findDelivery(key);
				if (existing !== null) return _ReplayOutcome(existing, contentDigest);

				// 2. Add remotely, then bind the gateway-minted id before optional indexing. The ledger is
				//    the idempotency authority: a failed index must never make an identical retry add again.
				const cogneeExternalId = await _Add(command.cogneeDatasetId, command.content);
				const outcome = await ledger.recordDelivery(key, { contentDigest, cogneeExternalId });
				if (outcome === "conflict_existing")
				{
					// 3. A concurrent writer won the key; its evidence is authoritative.
					const winner = await ledger.findDelivery(key);
					if (winner === null) throw new MemoryGatewayRemoteRefusalError("recordPersonalFact");
					return _ReplayOutcome(winner, contentDigest);
				}

				// 3. Indexing makes the fact recallable sooner but cannot revoke accepted delivery evidence.
				//    Cognee may finish indexing asynchronously; callers must not retry the durable add.
				try
				{
					await _Cognify(command.cogneeDatasetId);
				}
				catch
				{
					// The delivery ledger remains the durable result. Do not expose a retryable failure here.
				}

				return _RecordedEvidence({ contentDigest, cogneeExternalId }, false);
			});
		},

		async correct(command: MemoryCorrectionCommand): Promise<void>
		{
			return ___DoWithTrace("memory_gateway.personal.correct", { siloId: command.siloId }, async function _correct(): Promise<void>
			{
				const dataset = await _FactDataset(command.siloId, command.subjectId, command.factId, "correct");
				// 1. Create and index the replacement before touching the live fact so a transient add
				// failure preserves the old readable content and a retry remains possible.
				const replacementFactId = await _Add(dataset, command.correctedContent);
				await _Cognify(dataset);

				// 2. Delete the superseded fact while the ledger still resolves its id. If this fails a
				// retry keeps that id's dataset mapping and can finish cleanup rather than retaining it.
				await session.request(`/api/v1/datasets/${encodeURIComponent(dataset)}/data/${encodeURIComponent(command.factId)}`, "DELETE", undefined);

				// 3. Publish the replacement only after the old fact is confirmed removed.
				const replacement = await ledger.replaceFactReference({ siloId: command.siloId, subjectId: command.subjectId, factId: command.factId, replacementFactId });
				if (replacement !== "replaced") throw new MemoryGatewayRemoteRefusalError("correct");
			});
		},

		async forget(command: MemoryForgetCommand): Promise<void>
		{
			return ___DoWithTrace("memory_gateway.personal.forget", { siloId: command.siloId }, async function _forget(): Promise<void>
			{
				const dataset = await _FactDataset(command.siloId, command.subjectId, command.factId, "forget");
				await session.request(`/api/v1/datasets/${encodeURIComponent(dataset)}/data/${encodeURIComponent(command.factId)}`, "DELETE", undefined);
			});
		},

		async recallScoped(command: ScopedMemoryRecallCommand): Promise<ScopedMemoryRecallResult>
		{
			return ___DoWithTrace("memory_gateway.scoped.recall", { siloId: command.siloId, datasetCount: command.cogneeDatasetIds.length }, async function _recallScoped(): Promise<ScopedMemoryRecallResult>
			{
				const payload = await _Search(command.cogneeDatasetIds, command.query, command.maxResults);
				return { facts: __ParseScopedFacts(payload, command.maxResults) };
			});
		},

		async injectScoped(command: ScopedMemoryInjectionCommand): Promise<void>
		{
			// Provenance is asserted BEFORE any transport so an unattributable record cannot be
			// written even partially.
			__AssertMemoryProvenanceComplete(command.provenance);

			return ___DoWithTrace("memory_gateway.scoped.inject", { siloId: command.siloId, cogneeDatasetId: command.cogneeDatasetId }, async function _injectScoped(): Promise<void>
			{
				await _Add(command.cogneeDatasetId, __EncodeScopedEnvelope(command.content, command.provenance));
				await _Cognify(command.cogneeDatasetId);
			});
		},
	};
}
