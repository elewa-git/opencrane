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
 * Create the authenticated, read-only memory-gateway client backed by Cognee.
 *
 * Every recall is checked: an unrecognised response is a protocol failure, never a silently empty
 * result, and a scoped record that cannot prove complete provenance is dropped rather than returned
 * with partial attribution. `recordPersonalFact`, `correct`, `forget`, and `injectScoped` all throw
 * `MemoryGatewayUnavailableError` — they stay fail-closed until the gateway owns a durable write
 * lifecycle that can be tied back to a remote record. `injectScoped` still checks the provenance
 * first, so an unattributable write is refused for the right reason.
 *
 * Which dataset is searched always comes from the caller's frozen `cogneeDatasetId`. It is never
 * derived from a subject id, a scope name, or anything this client builds itself.
 *
 * Called by: apps/opencrane/src/infra/memory/memory-gateway-client.factory.ts.
 *
 * @param options - Gateway origin, timeout, projected-token path, and the fetch/token-reader
 *   overrides used by tests.
 * @returns A client whose results only ever contain gateway-returned data.
 * @throws Error When `requestTimeoutMilliseconds` is outside 1-300 seconds, or the gateway origin is
 *   not a single in-cluster HTTP Service origin.
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
