import { ___DoWithTrace } from "@opencrane/backend/observability";
import { ___MemoryGatewayDatasetCognifyRequestSchema, ___MemoryGatewayDatasetCognifyResponseSchema, ___MemoryGatewayDatasetEnsureRequestSchema, ___MemoryGatewayDatasetEnsureResponseSchema, ___MemoryGatewayDatasetListRequestSchema, ___MemoryGatewayDatasetListResponseSchema, ___MemoryGatewayDocumentAddRequestSchema, ___MemoryGatewayDocumentAddResponseSchema, ___MemoryGatewayDocumentDeleteRequestSchema, ___MemoryGatewayDocumentDeleteResponseSchema, ___MemoryGatewayDocumentListRequestSchema, ___MemoryGatewayDocumentListResponseSchema, ___MemoryGatewayDocumentRawDigestRequestSchema, ___MemoryGatewayDocumentRawDigestResponseSchema, ___MemoryGatewaySearchRequestSchema, ___MemoryGatewaySearchResponseSchema, MEMORY_GATEWAY_ROUTE_PATHS, MemoryGatewayErrorCodes, MemoryMutationDeliveryStates } from "@opencrane/contracts";
import type { MemoryGatewayDatasetCognifyRequest, MemoryGatewayDatasetCognifyResponse, MemoryGatewayDatasetEnsureRequest, MemoryGatewayDatasetEnsureResponse, MemoryGatewayDatasetListRequest, MemoryGatewayDatasetListResponse, MemoryGatewayDocumentAddRequest, MemoryGatewayDocumentAddResponse, MemoryGatewayDocumentDeleteRequest, MemoryGatewayDocumentDeleteResponse, MemoryGatewayDocumentListRequest, MemoryGatewayDocumentListResponse, MemoryGatewayDocumentRawDigestRequest, MemoryGatewayDocumentRawDigestResponse, MemoryGatewaySearchRequest, MemoryGatewaySearchResponse } from "@opencrane/contracts";
import type { ZodType } from "zod";

import { __CreateCogneeSession } from "./cognee-http";
import { __ParseScopedFacts, __ProjectSearchFacts } from "./cognee-payloads";
import { MemoryGatewayProtocolError } from "./memory-gateway-errors";
import { __AssertMemoryProvenanceComplete } from "./memory-provenance";
import { MemoryGatewayRequestKinds } from "./http-cognee-memory-gateway-client.types";
import type { CogneeMemoryGatewayHttpOptions, CogneeSession } from "./http-cognee-memory-gateway-client.types";
import type { MemoryGatewayClient, MemoryGatewayOperationContext, MemoryQueryCommand, MemoryQueryResult, ScopedMemoryInjectionCommand, ScopedMemoryRecallCommand, ScopedMemoryRecallResult } from "./memory-gateway-client.types";
import { MemoryGatewayUnavailableError } from "./unavailable-memory-gateway-client";

/** Validates an authenticated product context before any token read or request dispatch. */
function _Context(context: MemoryGatewayOperationContext, kind: MemoryGatewayRequestKinds): MemoryGatewayOperationContext
{
	if (typeof context.siloId !== "string" || context.siloId.trim().length === 0 || typeof context.subjectId !== "string" || context.subjectId.trim().length === 0)
	{
		const delivery = kind === MemoryGatewayRequestKinds.Mutation ? MemoryMutationDeliveryStates.ProvenNotSent : undefined;
		throw new MemoryGatewayProtocolError(MemoryGatewayErrorCodes.InvalidRequest, delivery);
	}
	return context;
}

/** Validates one shared request before any token read or HTTP dispatch. */
function _Request<Request>(schema: ZodType<Request>, value: Request, kind: MemoryGatewayRequestKinds): Request
{
	const parsed = schema.safeParse(value);
	if (!parsed.success)
	{
		const delivery = kind === MemoryGatewayRequestKinds.Mutation ? MemoryMutationDeliveryStates.ProvenNotSent : undefined;
		throw new MemoryGatewayProtocolError(MemoryGatewayErrorCodes.InvalidRequest, delivery);
	}
	return parsed.data;
}

/** Validates one shared response after the private gateway accepted a request. */
function _Response<Response>(schema: ZodType<Response>, value: unknown, kind: MemoryGatewayRequestKinds): Response
{
	const parsed = schema.safeParse(value);
	if (!parsed.success)
	{
		const delivery = kind === MemoryGatewayRequestKinds.Mutation ? MemoryMutationDeliveryStates.Ambiguous : undefined;
		throw new MemoryGatewayProtocolError(MemoryGatewayErrorCodes.ProviderProtocol, delivery);
	}
	return parsed.data;
}

/** Rejects response evidence that does not match the caller-selected coordinates. */
function _RequireCoordinates(match: boolean, kind: MemoryGatewayRequestKinds): void
{
	if (match)
		return;
	const delivery = kind === MemoryGatewayRequestKinds.Mutation ? MemoryMutationDeliveryStates.Ambiguous : undefined;
	throw new MemoryGatewayProtocolError(MemoryGatewayErrorCodes.ProviderProtocol, delivery);
}

/** Compares validated UUID coordinates across the provider's lowercase canonicalization. */
function _SameUuid(first: string, second: string): boolean
{
	return first.toLowerCase() === second.toLowerCase();
}

/** Sends one stable JSON operation after validating product context and its shared request. */
async function _Post<Request, Response>(session: CogneeSession, siloId: string, spanName: string, path: string, kind: MemoryGatewayRequestKinds, requestSchema: ZodType<Request>, responseSchema: ZodType<Response>, request: Request): Promise<Response>
{
	const body = _Request(requestSchema, request, kind);
	return ___DoWithTrace(spanName, { siloId }, async function _SendStableMemoryGatewayOperation(): Promise<Response>
	{
		const response = await session.send({ method: "POST", path, kind, body });
		return _Response(responseSchema, response.body, kind);
	});
}

/** Searches one frozen dataset through the shared route and validates its echoed identity. */
async function _Search(session: CogneeSession, siloId: string, request: MemoryGatewaySearchRequest): Promise<MemoryGatewaySearchResponse>
{
	if (typeof siloId !== "string" || siloId.trim().length === 0)
		throw new MemoryGatewayProtocolError(MemoryGatewayErrorCodes.InvalidRequest);
	const response = await _Post(session, siloId, "memory_gateway.search", MEMORY_GATEWAY_ROUTE_PATHS.Search, MemoryGatewayRequestKinds.Read, ___MemoryGatewaySearchRequestSchema, ___MemoryGatewaySearchResponseSchema, request);
	_RequireCoordinates(_SameUuid(response.datasetId, request.datasetId), MemoryGatewayRequestKinds.Read);
	return response;
}

/**
 * Creates the authenticated server client for stable memory-gateway reads and single-step mutations.
 *
 * Each step performs one shared request and validates one exact response. Dataset, document,
 * digest, and indexing coordinates must match the saved request before a receipt returns. The
 * client never sequences a Remember, Correct, or Forget operation and never retries a mutation.
 * Query and scoped recall retain their existing public projections while using the shared search
 * route. Scoped injection remains fail closed because no shared route owns that operation.
 *
 * Called by: `apps/opencrane/src/bootstrap/process/memory-gateway-client.factory.ts`.
 *
 * @param options - Private gateway origin, timeout, projected-token path, and focused test seams.
 * @returns One process-wide client whose methods reread the projected token per exchange.
 * @throws Error When the timeout or release-local Service origin is invalid.
 */
export function __CreateHttpCogneeMemoryGatewayClient(options: CogneeMemoryGatewayHttpOptions): MemoryGatewayClient
{
	const session = __CreateCogneeSession(options);
	return {
		async query(command: MemoryQueryCommand): Promise<MemoryQueryResult>
		{
			_Context({ siloId: command.siloId, subjectId: command.subjectId }, MemoryGatewayRequestKinds.Read);
			const response = await _Search(session, command.siloId, { datasetId: command.cogneeDatasetId, query: command.query, topK: command.maxResults });
			return { facts: __ProjectSearchFacts(response.facts.slice(0, command.maxResults)) };
		},

		async ensureDataset(context: MemoryGatewayOperationContext, request: MemoryGatewayDatasetEnsureRequest): Promise<MemoryGatewayDatasetEnsureResponse>
		{
			const acceptedContext = _Context(context, MemoryGatewayRequestKinds.Mutation);
			const response = await _Post(session, acceptedContext.siloId, "memory_gateway.dataset.ensure", MEMORY_GATEWAY_ROUTE_PATHS.DatasetEnsure, MemoryGatewayRequestKinds.Mutation, ___MemoryGatewayDatasetEnsureRequestSchema, ___MemoryGatewayDatasetEnsureResponseSchema, request);
			_RequireCoordinates(response.dataset.datasetName === request.datasetName, MemoryGatewayRequestKinds.Mutation);
			return response;
		},

		async listDatasets(context: MemoryGatewayOperationContext, request: MemoryGatewayDatasetListRequest): Promise<MemoryGatewayDatasetListResponse>
		{
			const acceptedContext = _Context(context, MemoryGatewayRequestKinds.Read);
			const response = await _Post(session, acceptedContext.siloId, "memory_gateway.dataset.list", MEMORY_GATEWAY_ROUTE_PATHS.DatasetList, MemoryGatewayRequestKinds.Read, ___MemoryGatewayDatasetListRequestSchema, ___MemoryGatewayDatasetListResponseSchema, request);
			_RequireCoordinates(response.datasets.every(dataset => dataset.datasetName === request.datasetName), MemoryGatewayRequestKinds.Read);
			return response;
		},

		async addDocument(context: MemoryGatewayOperationContext, request: MemoryGatewayDocumentAddRequest): Promise<MemoryGatewayDocumentAddResponse>
		{
			const acceptedContext = _Context(context, MemoryGatewayRequestKinds.Mutation);
			const response = await _Post(session, acceptedContext.siloId, "memory_gateway.document.add", MEMORY_GATEWAY_ROUTE_PATHS.DocumentAdd, MemoryGatewayRequestKinds.Mutation, ___MemoryGatewayDocumentAddRequestSchema, ___MemoryGatewayDocumentAddResponseSchema, request);
			_RequireCoordinates(_SameUuid(response.datasetId, request.datasetId) && response.contentDigest === request.contentDigest, MemoryGatewayRequestKinds.Mutation);
			return response;
		},

		async listDocuments(context: MemoryGatewayOperationContext, request: MemoryGatewayDocumentListRequest): Promise<MemoryGatewayDocumentListResponse>
		{
			const acceptedContext = _Context(context, MemoryGatewayRequestKinds.Read);
			const response = await _Post(session, acceptedContext.siloId, "memory_gateway.document.list", MEMORY_GATEWAY_ROUTE_PATHS.DocumentList, MemoryGatewayRequestKinds.Read, ___MemoryGatewayDocumentListRequestSchema, ___MemoryGatewayDocumentListResponseSchema, request);
			_RequireCoordinates(_SameUuid(response.datasetId, request.datasetId), MemoryGatewayRequestKinds.Read);
			return response;
		},

		async readDocumentDigest(context: MemoryGatewayOperationContext, request: MemoryGatewayDocumentRawDigestRequest): Promise<MemoryGatewayDocumentRawDigestResponse>
		{
			const acceptedContext = _Context(context, MemoryGatewayRequestKinds.Read);
			const response = await _Post(session, acceptedContext.siloId, "memory_gateway.document.raw_digest", MEMORY_GATEWAY_ROUTE_PATHS.DocumentRawDigest, MemoryGatewayRequestKinds.Read, ___MemoryGatewayDocumentRawDigestRequestSchema, ___MemoryGatewayDocumentRawDigestResponseSchema, request);
			_RequireCoordinates(_SameUuid(response.datasetId, request.datasetId) && _SameUuid(response.documentId, request.documentId), MemoryGatewayRequestKinds.Read);
			return response;
		},

		async cognifyDataset(context: MemoryGatewayOperationContext, request: MemoryGatewayDatasetCognifyRequest): Promise<MemoryGatewayDatasetCognifyResponse>
		{
			const acceptedContext = _Context(context, MemoryGatewayRequestKinds.Mutation);
			const response = await _Post(session, acceptedContext.siloId, "memory_gateway.dataset.cognify", MEMORY_GATEWAY_ROUTE_PATHS.DatasetCognify, MemoryGatewayRequestKinds.Mutation, ___MemoryGatewayDatasetCognifyRequestSchema, ___MemoryGatewayDatasetCognifyResponseSchema, request);
			_RequireCoordinates(_SameUuid(response.datasetId, request.datasetId) && _SameUuid(response.operationId, request.operationId) && response.inputEvidenceDigest === request.expectedInputEvidenceDigest, MemoryGatewayRequestKinds.Mutation);
			return response;
		},

		async deleteDocument(context: MemoryGatewayOperationContext, request: MemoryGatewayDocumentDeleteRequest): Promise<MemoryGatewayDocumentDeleteResponse>
		{
			const acceptedContext = _Context(context, MemoryGatewayRequestKinds.Mutation);
			const command = _Request(___MemoryGatewayDocumentDeleteRequestSchema, request, MemoryGatewayRequestKinds.Mutation);
			const path = MEMORY_GATEWAY_ROUTE_PATHS.DocumentDelete
				.replace("{datasetId}", encodeURIComponent(command.datasetId))
				.replace("{documentId}", encodeURIComponent(command.documentId));
			return ___DoWithTrace("memory_gateway.document.delete", { siloId: acceptedContext.siloId }, async function _DeleteStableMemoryGatewayDocument(): Promise<MemoryGatewayDocumentDeleteResponse>
			{
				const httpResponse = await session.send({ method: "DELETE", path, kind: MemoryGatewayRequestKinds.Mutation });
				const response = _Response(___MemoryGatewayDocumentDeleteResponseSchema, httpResponse.body, MemoryGatewayRequestKinds.Mutation);
				_RequireCoordinates(_SameUuid(response.datasetId, command.datasetId) && _SameUuid(response.documentId, command.documentId), MemoryGatewayRequestKinds.Mutation);
				return response;
			});
		},

		async recallScoped(command: ScopedMemoryRecallCommand): Promise<ScopedMemoryRecallResult>
		{
			const response = await _Search(session, command.siloId, { datasetId: command.cogneeDatasetId, query: command.query, topK: command.maxResults });
			return { facts: __ParseScopedFacts(__ProjectSearchFacts(response.facts), command.maxResults) };
		},

		async injectScoped(command: ScopedMemoryInjectionCommand): Promise<void>
		{
			__AssertMemoryProvenanceComplete(command.provenance);
			throw new MemoryGatewayUnavailableError();
		},
	};
}
