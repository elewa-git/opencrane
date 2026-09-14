import { MemoryGatewayErrorCodes, MemoryMutationDeliveryStates, ___MemoryGatewayDatasetEnsureResponseSchema, ___MemoryGatewayDatasetListResponseSchema } from "@opencrane/contracts";
import type { MemoryGatewayDatasetEnsureRequest, MemoryGatewayDatasetEnsureResponse, MemoryGatewayDatasetListRequest, MemoryGatewayDatasetListResponse } from "@opencrane/contracts";

import type { CogneeProviderSession } from "../auth/cognee-provider-session.types";
import type { CogneeProviderHttpResponse } from "../http/cognee-provider-http.types";
import type { CogneeDatasetWire } from "./cognee-provider-wire.types";
import { _PrepareMutation, _ReadExchange, _ReadSuccess } from "./cognee-provider-operation-io";
import { _CanonicalProviderUuid, _MaximumProviderDocuments, _MutationErrorForStatus, _ParseProviderJson, _ParseProviderValue, _ParseSharedValue, _PostDispatchMutationFailure, _PreDispatchMutationFailure, _ProviderJson } from "./cognee-provider-operation-support";
import { _CogneeDatasetWireSchema } from "./cognee-provider-wire.validator";
import { MemoryGatewayProviderMutationError, MemoryGatewayProviderReadError } from "./memory-gateway-provider-error";

/** HTTP headers used for pinned provider JSON requests. */
const _JSON_HEADERS = { "content-type": "application/json" } as const;

/** Project one provider dataset only after its identity and requested name match. */
function _ProjectDataset(value: CogneeDatasetWire, datasetName: string): MemoryGatewayDatasetEnsureResponse
{
	if (value.name !== datasetName)
		throw new MemoryGatewayProviderReadError(MemoryGatewayErrorCodes.Conflict);
	return _ParseSharedValue(___MemoryGatewayDatasetEnsureResponseSchema, { dataset: { datasetId: _CanonicalProviderUuid(value.id), datasetName: value.name } });
}

/** Read an exact owned-name match so retries never blindly repeat dataset creation. */
async function _RecoverDataset(session: CogneeProviderSession, request: MemoryGatewayDatasetEnsureRequest, signal?: AbortSignal): Promise<MemoryGatewayDatasetEnsureResponse | null>
{
	const listed = await _ListDatasets(session, { datasetName: request.datasetName }, signal);
	if (listed.datasets.length === 0)
		return null;
	return _ParseSharedValue(___MemoryGatewayDatasetEnsureResponseSchema, { dataset: listed.datasets[0] });
}

/** Ensure one dataset after the caller has saved its opaque name. */
export async function _EnsureDataset(session: CogneeProviderSession, request: MemoryGatewayDatasetEnsureRequest, signal?: AbortSignal): Promise<MemoryGatewayDatasetEnsureResponse>
{
	let existing: MemoryGatewayDatasetEnsureResponse | null;
	try
	{
		existing = await _RecoverDataset(session, request, signal);
	}
	catch (error)
	{
		if (error instanceof MemoryGatewayProviderMutationError)
			throw error;
		throw _PreDispatchMutationFailure(error);
	}
	if (existing !== null)
		return existing;
	await _PrepareMutation(session, signal);
	let response: CogneeProviderHttpResponse | undefined;
	let dispatchedFailure: ReturnType<typeof _MutationErrorForStatus> | undefined;
	try
	{
		response = await session.exchange({ method: "POST", path: "/api/v1/datasets", headers: _JSON_HEADERS, body: _ProviderJson({ name: request.datasetName }), signal });
	}
	catch (error)
	{
		dispatchedFailure = _PostDispatchMutationFailure(error);
	}
	if (dispatchedFailure === undefined && response!.status !== 200)
	{
		const failure = _MutationErrorForStatus(response!.status);
		if (failure.deliveryState === MemoryMutationDeliveryStates.Ambiguous)
			dispatchedFailure = failure;
		else
			throw failure;
	}
	if (dispatchedFailure === undefined)
	{
		try
		{
			const dataset = _ParseProviderValue(_CogneeDatasetWireSchema, _ParseProviderJson(response!));
			return _ProjectDataset(dataset, request.datasetName);
		}
		catch (error)
		{
			dispatchedFailure = _PostDispatchMutationFailure(error);
		}
	}
	try
	{
		const recovered = await _RecoverDataset(session, request, signal);
		if (recovered !== null)
			return recovered;
		throw dispatchedFailure;
	}
	catch (error)
	{
		if (error instanceof Error && dispatchedFailure !== undefined)
			throw dispatchedFailure;
		throw _PostDispatchMutationFailure(error);
	}
}

/** List zero or one provider dataset whose name exactly matches the saved value. */
export async function _ListDatasets(session: CogneeProviderSession, request: MemoryGatewayDatasetListRequest, signal?: AbortSignal): Promise<MemoryGatewayDatasetListResponse>
{
	const response = await _ReadExchange(session, { method: "GET", path: "/api/v1/datasets", signal });
	_ReadSuccess(response);
	const parsed = _ParseProviderValue(_CogneeDatasetWireSchema.array().max(_MaximumProviderDocuments), _ParseProviderJson(response));
	const matches = parsed.filter(dataset => dataset.name === request.datasetName);
	if (matches.length > 1)
		throw new MemoryGatewayProviderReadError(MemoryGatewayErrorCodes.Conflict);
	const datasets = matches.map(dataset => ({ datasetId: _CanonicalProviderUuid(dataset.id), datasetName: dataset.name }));
	return _ParseSharedValue(___MemoryGatewayDatasetListResponseSchema, { datasets });
}
