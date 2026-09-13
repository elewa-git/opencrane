import { z } from "zod";

import { MemoryGatewayErrorCodes } from "@opencrane/contracts";

import type { CogneeProviderHttpResponse } from "../http/cognee-provider-http.types";
import { MemoryGatewayProviderReadError } from "./memory-gateway-provider-error";

/** Cognee 1.5.4 chunk fields retained across the private gateway boundary. */
const _ChunkSchema = z.object({ id: z.string().uuid(), document_id: z.string().uuid(), text: z.string() }).strip();

/** Exact access-control response envelope required for one dataset-scoped search. */
const _EnvelopeSchema = z.array(z.object({ dataset_id: z.string().uuid(), search_result: z.array(_ChunkSchema).max(50) }).strict()).length(1);

/** Decode provider JSON without returning parser details or response content. */
function _Json(body: Uint8Array): unknown
{
	try
	{
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
	}
	catch
	{
		throw new MemoryGatewayProviderReadError(MemoryGatewayErrorCodes.ProviderProtocol);
	}
}

/**
 * Verify and project one Cognee access-control search response.
 *
 * The provider must return exactly one envelope for the dataset already admitted by OpenCrane.
 * The projection removes every provider field except the chunk, document, and text fields expected
 * by the existing server-side memory port. A missing, additional, or different dataset is a
 * protocol failure and never becomes an empty recall.
 *
 * Called by: gateway/memory-gateway-server.ts after an authenticated provider exchange.
 *
 * @param response - Bounded response returned by the Cognee session owner.
 * @param requestedDatasetId - Frozen lowercase dataset UUID sent in the provider request.
 * @returns Canonical JSON bytes containing only validated chunk records.
 * @throws {MemoryGatewayProviderReadError} When the status or envelope cannot prove the requested dataset.
 */
export function _ProjectCogneeSearchResponse(response: CogneeProviderHttpResponse, requestedDatasetId: string): Uint8Array
{
	if (response.status !== 200)
		throw new MemoryGatewayProviderReadError(MemoryGatewayErrorCodes.ProviderUnavailable);
	if (response.contentType === null || !/^application\/json(?:\s*;|$)/iu.test(response.contentType))
		throw new MemoryGatewayProviderReadError(MemoryGatewayErrorCodes.ProviderProtocol);
	const parsed = _EnvelopeSchema.safeParse(_Json(response.body));
	if (!parsed.success || parsed.data[0]?.dataset_id.toLowerCase() !== requestedDatasetId)
		throw new MemoryGatewayProviderReadError(MemoryGatewayErrorCodes.ProviderProtocol);
	return new TextEncoder().encode(JSON.stringify(parsed.data[0].search_result));
}
