import { describe, expect, it } from "vitest";

import { MemoryGatewayErrorCodes } from "@opencrane/contracts";

import type { CogneeProviderHttpResponse } from "../../http/cognee-provider-http.types";
import { _ProjectCogneeSearchResponse } from "../cognee-search-response";

/** Dataset UUID used by every response-envelope case. */
const _DATASET_ID = "3f6f6bd2-8a3e-4c8e-9a3f-6b1d2e4f5a6b";

/** Encode one synthetic provider value as a bounded response. */
function _Response(value: unknown, status = 200): CogneeProviderHttpResponse
{
	return { status, contentType: "application/json", body: new TextEncoder().encode(JSON.stringify(value)) };
}

describe("Cognee search response", function _Suite()
{
	it("unwraps only the requested dataset and strips extra chunk fields", function _Projects()
	{
		const provider = [{ dataset_id: _DATASET_ID, search_result: [{ id: "c15db69b-bf7f-4b8e-83ca-4e18d72f5b07", document_id: "fbb3cf99-1b3a-486e-9308-7e31cf19e876", text: "known fact", score: 0.9 }] }];
		const result = JSON.parse(new TextDecoder().decode(_ProjectCogneeSearchResponse(_Response(provider), _DATASET_ID))) as unknown;
		expect(result).toEqual([{ id: "c15db69b-bf7f-4b8e-83ca-4e18d72f5b07", document_id: "fbb3cf99-1b3a-486e-9308-7e31cf19e876", text: "known fact" }]);
	});

	it("refuses a foreign, missing, or additional dataset envelope", function _RejectsEnvelopeMismatch()
	{
		const foreign = "0f0e4b1c-9a52-4d0f-8c53-2f3ad34e1b10";
		for (const value of [[], [{ dataset_id: foreign, search_result: [] }], [{ dataset_id: _DATASET_ID, search_result: [] }, { dataset_id: foreign, search_result: [] }]])
		{
			expect(function _Project() { return _ProjectCogneeSearchResponse(_Response(value), _DATASET_ID); }).toThrow(expect.objectContaining({ error: MemoryGatewayErrorCodes.ProviderProtocol }));
		}
	});

	it("does not treat a provider failure as an empty result", function _RejectsStatus()
	{
		expect(function _Project() { return _ProjectCogneeSearchResponse(_Response([], 503), _DATASET_ID); }).toThrow(expect.objectContaining({ error: MemoryGatewayErrorCodes.ProviderUnavailable }));
	});

	it("requires the pinned JSON media type", function _RejectsMediaType()
	{
		const response = { ..._Response([{ dataset_id: _DATASET_ID, search_result: [] }]), contentType: "text/plain" };
		expect(function _Project() { return _ProjectCogneeSearchResponse(response, _DATASET_ID); }).toThrow(expect.objectContaining({ error: MemoryGatewayErrorCodes.ProviderProtocol }));
	});
});
