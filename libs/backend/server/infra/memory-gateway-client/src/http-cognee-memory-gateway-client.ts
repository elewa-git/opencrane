import { ___DoWithTrace } from "@opencrane/backend/observability";
import { __CreateCogneeSession } from "./cognee-http.js";
import { __ParseScopedFacts, __ParseSearchFacts } from "./cognee-payloads.js";
import { __AssertMemoryProvenanceComplete } from "./memory-provenance.js";
import type { CogneeMemoryGatewayHttpOptions } from "./http-cognee-memory-gateway-client.types.js";
import type { MemoryCorrectionCommand, MemoryForgetCommand, MemoryGatewayClient, MemoryQueryCommand, MemoryQueryResult, PersonalMemoryRecordCommand, PersonalMemoryRecordResult, ScopedMemoryInjectionCommand, ScopedMemoryRecallCommand, ScopedMemoryRecallResult } from "./memory-gateway-client.types.js";
import { MemoryGatewayUnavailableError } from "./unavailable-memory-gateway-client.js";

/** Cognee search mode returning stored passages rather than a generated completion. */
const _SEARCH_TYPE = "CHUNKS";

/**
 * Create the authenticated, read-only Cognee memory gateway client.
 *
 * Every recall is validated: an unrecognised response is a protocol violation, never a silently
 * empty result, and a scoped record that cannot prove complete provenance is dropped rather than
 * returned with partial attribution. Record, correction, forgetting, and scoped injection remain
 * fail-closed until the gateway owns a durable, remotely correlatable write lifecycle.
 *
 * Dataset selection always comes from the caller's frozen `cogneeDatasetId` — never from a subject
 * id, scope coordinate, or caller-derived dataset name.
 *
 * @param options - Memory-gateway origin, timeout, projected-token path, and test seams.
 * @returns A client whose results are only ever gateway-originated.
 */
export function __CreateHttpCogneeMemoryGatewayClient(options: CogneeMemoryGatewayHttpOptions): MemoryGatewayClient
{
	if (!Number.isSafeInteger(options.requestTimeoutMilliseconds) || options.requestTimeoutMilliseconds < 1_000 || options.requestTimeoutMilliseconds > 300_000)
	{
		throw new Error("Cognee memory gateway client requires a 1-300s request timeout");
	}
	const session = __CreateCogneeSession(options);

	/** Search one dataset and return the raw Cognee response for the caller to project. */
	async function _Search(datasetId: string, query: string, maxResults: number): Promise<unknown>
	{
		return session.search({ query, search_type: _SEARCH_TYPE, dataset_ids: [datasetId], top_k: maxResults });
	}

	return {
		async query(command: MemoryQueryCommand): Promise<MemoryQueryResult>
		{
			return ___DoWithTrace("memory_gateway.personal.query", { siloId: command.siloId, cogneeDatasetId: command.cogneeDatasetId }, async function _query(): Promise<MemoryQueryResult>
			{
				const payload = await _Search(command.cogneeDatasetId, command.query, command.maxResults);
				return { facts: __ParseSearchFacts(payload, command.maxResults) };
			});
		},

		async recordPersonalFact(_command: PersonalMemoryRecordCommand): Promise<PersonalMemoryRecordResult>
		{
			throw new MemoryGatewayUnavailableError();
		},

		async correct(_command: MemoryCorrectionCommand): Promise<void>
		{
			throw new MemoryGatewayUnavailableError();
		},

		async forget(_command: MemoryForgetCommand): Promise<void>
		{
			throw new MemoryGatewayUnavailableError();
		},

		async recallScoped(command: ScopedMemoryRecallCommand): Promise<ScopedMemoryRecallResult>
		{
			return ___DoWithTrace("memory_gateway.scoped.recall", { siloId: command.siloId, cogneeDatasetId: command.cogneeDatasetId }, async function _recallScoped(): Promise<ScopedMemoryRecallResult>
			{
				const payload = await _Search(command.cogneeDatasetId, command.query, command.maxResults);
				return { facts: __ParseScopedFacts(payload, command.maxResults) };
			});
		},

		async injectScoped(command: ScopedMemoryInjectionCommand): Promise<void>
		{
			__AssertMemoryProvenanceComplete(command.provenance);
			throw new MemoryGatewayUnavailableError();
		},
	};
}
