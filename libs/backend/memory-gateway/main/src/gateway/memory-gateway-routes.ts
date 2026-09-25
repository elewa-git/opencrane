import type { ZodType } from "zod";

import { MEMORY_GATEWAY_ROUTE_PATHS, ___MemoryGatewayDatasetCognifyRequestSchema, ___MemoryGatewayDatasetCognifyResponseSchema, ___MemoryGatewayDatasetEnsureRequestSchema, ___MemoryGatewayDatasetEnsureResponseSchema, ___MemoryGatewayDatasetListRequestSchema, ___MemoryGatewayDatasetListResponseSchema, ___MemoryGatewayDocumentAddRequestSchema, ___MemoryGatewayDocumentAddResponseSchema, ___MemoryGatewayDocumentDeleteRequestSchema, ___MemoryGatewayDocumentDeleteResponseSchema, ___MemoryGatewayDocumentListRequestSchema, ___MemoryGatewayDocumentListResponseSchema, ___MemoryGatewayDocumentRawDigestRequestSchema, ___MemoryGatewayDocumentRawDigestResponseSchema, ___MemoryGatewaySearchRequestSchema, ___MemoryGatewaySearchResponseSchema } from "@opencrane/contracts";

import type { MemoryGatewayProviderOperations } from "../provider/operations/memory-gateway-provider-operations.types";
import { _ParseMemoryGatewayRequest, _ParseMemoryGatewayResponse } from "./memory-gateway-request";
import type { MemoryGatewayRoute } from "./memory-gateway-route.types";

/** Bind request and response validation to one provider operation without choosing workflow steps. */
function _Post<Request, Response>(path: string, mutation: boolean, requestSchema: ZodType<Request>, responseSchema: ZodType<Response>, invoke: (request: Request, signal: AbortSignal) => Promise<Response>): MemoryGatewayRoute
{
	return {
		path, mutation, pathOnly: false,
		async execute(body, signal): Promise<Response>
		{
			const request = _ParseMemoryGatewayRequest(requestSchema, body);
			return _ParseMemoryGatewayResponse(responseSchema, await invoke(request, signal));
		},
	};
}

/** Create the finite POST route table once per server; provider credentials stay in its session. */
export function _MemoryGatewayPostRoutes(operations: MemoryGatewayProviderOperations): ReadonlyMap<string, MemoryGatewayRoute>
{
	const routes = [
		_Post(MEMORY_GATEWAY_ROUTE_PATHS.DatasetEnsure, true, ___MemoryGatewayDatasetEnsureRequestSchema, ___MemoryGatewayDatasetEnsureResponseSchema, operations.ensureDataset.bind(operations)),
		_Post(MEMORY_GATEWAY_ROUTE_PATHS.DatasetList, false, ___MemoryGatewayDatasetListRequestSchema, ___MemoryGatewayDatasetListResponseSchema, operations.listDatasets.bind(operations)),
		_Post(MEMORY_GATEWAY_ROUTE_PATHS.DocumentAdd, true, ___MemoryGatewayDocumentAddRequestSchema, ___MemoryGatewayDocumentAddResponseSchema, operations.addDocument.bind(operations)),
		_Post(MEMORY_GATEWAY_ROUTE_PATHS.DocumentList, false, ___MemoryGatewayDocumentListRequestSchema, ___MemoryGatewayDocumentListResponseSchema, operations.listDocuments.bind(operations)),
		_Post(MEMORY_GATEWAY_ROUTE_PATHS.DocumentRawDigest, false, ___MemoryGatewayDocumentRawDigestRequestSchema, ___MemoryGatewayDocumentRawDigestResponseSchema, operations.readDocumentDigest.bind(operations)),
		_Post(MEMORY_GATEWAY_ROUTE_PATHS.DatasetCognify, true, ___MemoryGatewayDatasetCognifyRequestSchema, ___MemoryGatewayDatasetCognifyResponseSchema, operations.cognifyDataset.bind(operations)),
		_Post(MEMORY_GATEWAY_ROUTE_PATHS.Search, false, ___MemoryGatewaySearchRequestSchema, ___MemoryGatewaySearchResponseSchema, operations.search.bind(operations)),
	];
	return new Map(routes.map(route => [route.path, route]));
}

/** Match a method and shared path; deletion coordinates are validated only after authentication. */
export function _FindMemoryGatewayRoute(operations: MemoryGatewayProviderOperations, posts: ReadonlyMap<string, MemoryGatewayRoute>, method: string, path: string): MemoryGatewayRoute | null
{
	if (method === "POST")
		return posts.get(path) ?? null;
	if (method !== "DELETE")
		return null;
	const coordinates = path.match(/^\/api\/v1\/memory\/datasets\/([^/]+)\/documents\/([^/]+)$/u);
	if (coordinates === null)
		return null;
	return {
		path: MEMORY_GATEWAY_ROUTE_PATHS.DocumentDelete, mutation: true, pathOnly: true,
		async execute(_body, signal)
		{
			const request = _ParseMemoryGatewayRequest(___MemoryGatewayDocumentDeleteRequestSchema, { datasetId: coordinates[1], documentId: coordinates[2] });
			return _ParseMemoryGatewayResponse(___MemoryGatewayDocumentDeleteResponseSchema, await operations.deleteDocument(request, signal));
		},
	};
}
