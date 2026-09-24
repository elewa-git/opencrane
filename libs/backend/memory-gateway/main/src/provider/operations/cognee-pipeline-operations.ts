import { MemoryGatewayErrorCodes, ___MemoryGatewayDatasetCognifyResponseSchema } from "@opencrane/contracts";
import type { MemoryGatewayDatasetCognifyRequest, MemoryGatewayDatasetCognifyResponse } from "@opencrane/contracts";

import type { CogneeProviderSession } from "../auth/cognee-provider-session.types";
import type { CogneeProviderHttpResponse } from "../http/cognee-provider-http.types";
import { _CompletedPipeline, _PrepareMutation } from "./cognee-provider-operation-io";
import { _CanonicalProviderUuid, _MutationErrorForStatus, _ParseProviderJson, _ParseProviderValue, _ParseSharedValue, _PostDispatchMutationFailure, _ProviderJson, _ProviderRunMapSchema } from "./cognee-provider-operation-support";
import { MemoryGatewayProviderReadError } from "./memory-gateway-provider-error";

/** Headers used by the repaired blocking Cognify route. */
const _JSON_HEADERS = { "content-type": "application/json" } as const;

/** Run or replay blocking Cognify with the caller's saved recovery coordinates. */
export async function _CognifyDataset(session: CogneeProviderSession, request: MemoryGatewayDatasetCognifyRequest, signal?: AbortSignal): Promise<MemoryGatewayDatasetCognifyResponse>
{
	await _PrepareMutation(session);
	const datasetId = _CanonicalProviderUuid(request.datasetId);
	const operationId = _CanonicalProviderUuid(request.operationId);
	let response: CogneeProviderHttpResponse;
	try
	{
		const body = _ProviderJson({
			dataset_ids: [datasetId],
			run_in_background: false,
			chunk_size: 128,
			operation_id: operationId,
			expected_input_evidence_digest: request.expectedInputEvidenceDigest,
		});
		response = await session.exchange({ method: "POST", path: "/api/v1/cognify", headers: _JSON_HEADERS, body, signal });
	}
	catch (error)
	{
		throw _PostDispatchMutationFailure(error);
	}
	if (response.status !== 200)
		throw _MutationErrorForStatus(response.status);
	try
	{
		const value = _ParseProviderValue(_ProviderRunMapSchema, _ParseProviderJson(response));
		const keys = Object.keys(value);
		const providerDatasetId = keys[0];
		if (keys.length !== 1 || providerDatasetId === undefined || _CanonicalProviderUuid(providerDatasetId) !== datasetId)
			throw new MemoryGatewayProviderReadError(MemoryGatewayErrorCodes.ProviderProtocol);
		const run = _CompletedPipeline(value[providerDatasetId], datasetId, operationId, request.expectedInputEvidenceDigest);
		const receipt = { datasetId, operationId, inputEvidenceDigest: run.input_evidence_digest, pipelineRunId: _CanonicalProviderUuid(run.pipeline_run_id) };
		return _ParseSharedValue(___MemoryGatewayDatasetCognifyResponseSchema, receipt);
	}
	catch (error)
	{
		throw _PostDispatchMutationFailure(error);
	}
}
