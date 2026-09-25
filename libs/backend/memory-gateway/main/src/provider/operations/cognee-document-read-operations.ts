import { MEMORY_GATEWAY_LIMITS, MemoryGatewayErrorCodes, ___MemoryGatewayDocumentListResponseSchema, ___MemoryGatewayDocumentRawDigestResponseSchema } from "@opencrane/contracts";
import type { MemoryGatewayDocumentListRequest, MemoryGatewayDocumentListResponse, MemoryGatewayDocumentRawDigestRequest, MemoryGatewayDocumentRawDigestResponse } from "@opencrane/contracts";

import type { CogneeProviderSession } from "../auth/cognee-provider-session.types";
import { _ReadExchange, _ReadSuccess } from "./cognee-provider-operation-io";
import { _CanonicalProviderUuid, _ContentDigest, _ParseProviderJson, _ParseProviderValue, _ParseSharedValue } from "./cognee-provider-operation-support";
import { _CogneeCognifyInputEvidenceWireSchema } from "./cognee-provider-wire.validator";
import type { CogneeCognifyEvidenceDocumentWire } from "./cognee-provider-wire.types";
import { MemoryGatewayProviderReadError } from "./memory-gateway-provider-error";

/** Project one provider document without its storage path or provider metadata. */
function _ProjectDocument(document: CogneeCognifyEvidenceDocumentWire, datasetId: string): MemoryGatewayDocumentListResponse["documents"][number]
{
	const documentDatasetId = _CanonicalProviderUuid(document.datasetId);
	const documentId = _CanonicalProviderUuid(document.id);
	if (documentDatasetId !== datasetId || documentId === datasetId)
		throw new MemoryGatewayProviderReadError(MemoryGatewayErrorCodes.ProviderProtocol);
	return { documentId, name: document.name, mimeType: document.mimeType, contentDigest: document.contentDigest, byteLength: document.byteLength };
}

/** Hash complete bounded raw bytes without returning provider content. */
export async function _ReadDocumentDigest(session: CogneeProviderSession, request: MemoryGatewayDocumentRawDigestRequest, signal?: AbortSignal): Promise<MemoryGatewayDocumentRawDigestResponse>
{
	const datasetId = _CanonicalProviderUuid(request.datasetId);
	const documentId = _CanonicalProviderUuid(request.documentId);
	const response = await _ReadExchange(session, { method: "GET", path: `/api/v1/datasets/${datasetId}/data/${documentId}/raw`, signal });
	_ReadSuccess(response);
	if (response.body.byteLength > MEMORY_GATEWAY_LIMITS.TextMaximumBytes)
		throw new MemoryGatewayProviderReadError(MemoryGatewayErrorCodes.ProviderProtocol);
	return _ParseSharedValue(___MemoryGatewayDocumentRawDigestResponseSchema, { datasetId, documentId, contentDigest: _ContentDigest(response.body), byteLength: response.body.byteLength });
}

/** Read the locked, content-free document snapshot used to admit Cognify. */
export async function _ListDocuments(session: CogneeProviderSession, request: MemoryGatewayDocumentListRequest, signal?: AbortSignal): Promise<MemoryGatewayDocumentListResponse>
{
	const datasetId = _CanonicalProviderUuid(request.datasetId);
	const path = `/api/v1/datasets/${datasetId}/data?include_cognify_evidence=true`;
	const response = await _ReadExchange(session, { method: "GET", path, signal });
	_ReadSuccess(response);
	const value = _ParseProviderValue(_CogneeCognifyInputEvidenceWireSchema, _ParseProviderJson(response));
	if (_CanonicalProviderUuid(value.datasetId) !== datasetId || value.data.length > MEMORY_GATEWAY_LIMITS.DocumentResultsMaximum)
		throw new MemoryGatewayProviderReadError(MemoryGatewayErrorCodes.ProviderProtocol);
	const documents = value.data.map(document => _ProjectDocument(document, datasetId));
	return _ParseSharedValue(___MemoryGatewayDocumentListResponseSchema, { datasetId, inputEvidenceDigest: value.inputEvidenceDigest, documents });
}
