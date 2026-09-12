import { describe, expect, it } from "vitest";

import { MemoryMutationDeliveryStates } from "../../memory.types";
import { MEMORY_GATEWAY_LIMITS, MEMORY_GATEWAY_ROUTE_PATHS, MemoryGatewayErrorCodes } from "../memory-gateway.types";
import { ___MemoryGatewayDatasetCognifyRequestSchema, ___MemoryGatewayDatasetCognifyResponseSchema, ___MemoryGatewayDatasetEnsureRequestSchema, ___MemoryGatewayDatasetEnsureResponseSchema, ___MemoryGatewayDatasetListRequestSchema, ___MemoryGatewayDatasetListResponseSchema, ___MemoryGatewayDocumentAddRequestSchema, ___MemoryGatewayDocumentAddResponseSchema, ___MemoryGatewayDocumentDeleteRequestSchema, ___MemoryGatewayDocumentListRequestSchema, ___MemoryGatewayDocumentListResponseSchema, ___MemoryGatewayDocumentRawDigestRequestSchema, ___MemoryGatewayDocumentRawDigestResponseSchema, ___MemoryGatewayMutationErrorSchema, ___MemoryGatewayReadErrorSchema, ___MemoryGatewaySearchRequestSchema, ___MemoryGatewaySearchResponseSchema } from "../memory-gateway.validator";

/** UUIDs used to prove that document and chunk identities remain separate. */
const _IDS = {
	dataset: "926bde93-cf68-4d4f-8bf5-a6e177730767",
	document: "0f95e716-a573-465c-95e2-4cb763bfb4c2",
	chunk: "0bbf22d8-8b88-40d8-a9ea-d162748fbf52",
	secondDocument: "a9ea54f3-c174-44ed-b656-b1ed13308585",
	secondChunk: "1a44c7c2-2797-4526-b0a3-806f6ce47a5d",
} as const;

/** Opaque dataset name accepted by the gateway contract. */
const _DATASET_NAME = "a".repeat(MEMORY_GATEWAY_LIMITS.DatasetNameMinimumCharacters);

/** SHA-256 value accepted by digest fields. */
const _DIGEST = `sha256:${"a".repeat(64)}`;

/** Return a valid document metadata projection. */
function _Document(documentId: string = _IDS.document): { readonly documentId: string; readonly name: string; readonly mimeType: string }
{
	return { documentId, name: "fact-a.txt", mimeType: "text/plain" };
}

/** Return one valid ranked fact. */
function _Fact(chunkId: string = _IDS.chunk, documentId: string = _IDS.document): { readonly chunkId: string; readonly documentId: string; readonly content: string }
{
	return { chunkId, documentId, content: "Remember the blue crane migration note." };
}

describe("memory gateway route vocabulary", function _DescribeRoutes()
{
	it("uses one stable OpenCrane-owned route family", function _AssertRoutes()
	{
		expect(MEMORY_GATEWAY_ROUTE_PATHS).toEqual({
			DatasetEnsure: "/api/v1/memory/datasets/ensure",
			DatasetList: "/api/v1/memory/datasets/list",
			DocumentAdd: "/api/v1/memory/documents/add",
			DocumentList: "/api/v1/memory/documents/list",
			DocumentRawDigest: "/api/v1/memory/documents/raw-digest",
			DatasetCognify: "/api/v1/memory/datasets/cognify",
			Search: "/api/v1/memory/search",
			DocumentDelete: "/api/v1/memory/datasets/{datasetId}/documents/{documentId}",
		});
	});
});

describe("memory gateway dataset contracts", function _DescribeDatasets()
{
	it("accepts strict ensure and list requests and responses", function _AcceptDatasetContracts()
	{
		expect(___MemoryGatewayDatasetEnsureRequestSchema.parse({ datasetName: _DATASET_NAME })).toEqual({ datasetName: _DATASET_NAME });
		expect(___MemoryGatewayDatasetEnsureResponseSchema.parse({ dataset: { datasetId: _IDS.dataset, datasetName: _DATASET_NAME } })).toEqual({ dataset: { datasetId: _IDS.dataset, datasetName: _DATASET_NAME } });
		expect(___MemoryGatewayDatasetListRequestSchema.parse({ datasetName: _DATASET_NAME })).toEqual({ datasetName: _DATASET_NAME });
		expect(___MemoryGatewayDatasetListResponseSchema.parse({ datasets: [{ datasetId: _IDS.dataset, datasetName: _DATASET_NAME }] }).datasets).toHaveLength(1);
	});

	it("rejects readable names, provider aliases, owner fields, and multiple exact-name results", function _RejectUnsafeDatasetShapes()
	{
		expect(___MemoryGatewayDatasetEnsureRequestSchema.safeParse({ datasetName: "jente-personal-memory" }).success).toBe(false);
		expect(___MemoryGatewayDatasetEnsureResponseSchema.safeParse({ dataset: { id: _IDS.dataset, name: _DATASET_NAME } }).success).toBe(false);
		expect(___MemoryGatewayDatasetEnsureResponseSchema.safeParse({ dataset: { datasetId: _IDS.dataset, datasetName: _DATASET_NAME, ownerId: _IDS.document } }).success).toBe(false);
		expect(___MemoryGatewayDatasetListResponseSchema.safeParse({ datasets: [{ datasetId: _IDS.dataset, datasetName: _DATASET_NAME }, { datasetId: _IDS.document, datasetName: _DATASET_NAME }] }).success).toBe(false);
	});
});

describe("memory gateway document contracts", function _DescribeDocuments()
{
	it("accepts add, list, digest, cognify, and delete coordinates", function _AcceptDocumentContracts()
	{
		expect(___MemoryGatewayDocumentAddRequestSchema.parse({ datasetId: _IDS.dataset, content: "fact", contentDigest: _DIGEST })).toEqual({ datasetId: _IDS.dataset, content: "fact", contentDigest: _DIGEST });
		expect(___MemoryGatewayDocumentAddResponseSchema.parse({ datasetId: _IDS.dataset, documentId: _IDS.document, contentDigest: _DIGEST })).toEqual({ datasetId: _IDS.dataset, documentId: _IDS.document, contentDigest: _DIGEST });
		expect(___MemoryGatewayDocumentListRequestSchema.parse({ datasetId: _IDS.dataset })).toEqual({ datasetId: _IDS.dataset });
		expect(___MemoryGatewayDocumentListResponseSchema.parse({ datasetId: _IDS.dataset, documents: [_Document()] })).toEqual({ datasetId: _IDS.dataset, documents: [_Document()] });
		expect(___MemoryGatewayDocumentRawDigestRequestSchema.parse({ datasetId: _IDS.dataset, documentId: _IDS.document })).toEqual({ datasetId: _IDS.dataset, documentId: _IDS.document });
		expect(___MemoryGatewayDocumentRawDigestResponseSchema.parse({ datasetId: _IDS.dataset, documentId: _IDS.document, contentDigest: _DIGEST, byteLength: 4 })).toEqual({ datasetId: _IDS.dataset, documentId: _IDS.document, contentDigest: _DIGEST, byteLength: 4 });
		expect(___MemoryGatewayDatasetCognifyRequestSchema.parse({ datasetId: _IDS.dataset })).toEqual({ datasetId: _IDS.dataset });
		expect(___MemoryGatewayDatasetCognifyResponseSchema.parse({ datasetId: _IDS.dataset })).toEqual({ datasetId: _IDS.dataset });
		expect(___MemoryGatewayDocumentDeleteRequestSchema.parse({ datasetId: _IDS.dataset, documentId: _IDS.document })).toEqual({ datasetId: _IDS.dataset, documentId: _IDS.document });
	});

	it("enforces UTF-8 byte bounds instead of JavaScript character counts", function _EnforceTextBytes()
	{
		const maximum = "é".repeat(MEMORY_GATEWAY_LIMITS.TextMaximumBytes / 2);
		const oversized = `${maximum}é`;
		expect(___MemoryGatewayDocumentAddRequestSchema.safeParse({ datasetId: _IDS.dataset, content: maximum, contentDigest: _DIGEST }).success).toBe(true);
		expect(___MemoryGatewayDocumentAddRequestSchema.safeParse({ datasetId: _IDS.dataset, content: oversized, contentDigest: _DIGEST }).success).toBe(false);
	});

	it("rejects duplicate documents, oversized lists, paths, storage fields, and raw content", function _RejectUnsafeDocumentShapes()
	{
		const duplicates = { datasetId: _IDS.dataset, documents: [_Document(), _Document()] };
		const oversized = { datasetId: _IDS.dataset, documents: Array.from({ length: MEMORY_GATEWAY_LIMITS.DocumentResultsMaximum + 1 }, function _MakeDocument(_value, index) { return _Document(`${String(index).padStart(8, "0")}-0000-4000-8000-000000000000`); }) };
		expect(___MemoryGatewayDocumentListResponseSchema.safeParse(duplicates).success).toBe(false);
		expect(___MemoryGatewayDocumentListResponseSchema.safeParse(oversized).success).toBe(false);
		expect(___MemoryGatewayDocumentListResponseSchema.safeParse({ datasetId: _IDS.dataset, documents: [{ ..._Document(), name: "../fact.txt" }] }).success).toBe(false);
		expect(___MemoryGatewayDocumentListResponseSchema.safeParse({ datasetId: _IDS.dataset, documents: [{ ..._Document(), rawDataLocation: "file:///secret" }] }).success).toBe(false);
		expect(___MemoryGatewayDocumentRawDigestResponseSchema.safeParse({ datasetId: _IDS.dataset, documentId: _IDS.document, contentDigest: _DIGEST, byteLength: 4, content: "fact" }).success).toBe(false);
	});

	it("rejects provider aliases, malformed digests, and invalid coordinates", function _RejectDocumentAliases()
	{
		expect(___MemoryGatewayDocumentAddRequestSchema.safeParse({ dataset_id: _IDS.dataset, content: "fact", content_digest: _DIGEST }).success).toBe(false);
		expect(___MemoryGatewayDocumentAddResponseSchema.safeParse({ datasetId: _IDS.dataset, documentId: _IDS.document, contentDigest: `SHA256:${"a".repeat(64)}` }).success).toBe(false);
		expect(___MemoryGatewayDocumentDeleteRequestSchema.safeParse({ datasetId: _IDS.dataset, documentId: "chunk" }).success).toBe(false);
		expect(___MemoryGatewayDocumentDeleteRequestSchema.safeParse({ datasetId: _IDS.dataset, documentId: _IDS.dataset }).success).toBe(false);
		expect(___MemoryGatewayDocumentRawDigestResponseSchema.safeParse({ datasetId: _IDS.dataset, documentId: _IDS.dataset, contentDigest: _DIGEST, byteLength: 4 }).success).toBe(false);
	});
});

describe("memory gateway search contracts", function _DescribeSearch()
{
	it("accepts bounded queries and preserves repeated document IDs with unique chunks", function _AcceptSearchContracts()
	{
		const facts = [_Fact(), _Fact(_IDS.secondChunk, _IDS.document)];
		expect(___MemoryGatewaySearchRequestSchema.parse({ datasetId: _IDS.dataset, query: "blue crane", topK: 2 })).toEqual({ datasetId: _IDS.dataset, query: "blue crane", topK: 2 });
		expect(___MemoryGatewaySearchResponseSchema.parse({ datasetId: _IDS.dataset, facts })).toEqual({ datasetId: _IDS.dataset, facts });
	});

	it("rejects blank or oversized queries and result overflow", function _RejectSearchBounds()
	{
		const oversizedQuery = "é".repeat((MEMORY_GATEWAY_LIMITS.QueryMaximumBytes / 2) + 1);
		const oversizedFacts = Array.from({ length: MEMORY_GATEWAY_LIMITS.SearchResultsMaximum + 1 }, function _MakeFact(_value, index) { return _Fact(`${String(index).padStart(8, "0")}-0000-4000-8000-000000000000`, _IDS.secondDocument); });
		expect(___MemoryGatewaySearchRequestSchema.safeParse({ datasetId: _IDS.dataset, query: "  ", topK: 1 }).success).toBe(false);
		expect(___MemoryGatewaySearchRequestSchema.safeParse({ datasetId: _IDS.dataset, query: oversizedQuery, topK: 1 }).success).toBe(false);
		expect(___MemoryGatewaySearchRequestSchema.safeParse({ datasetId: _IDS.dataset, query: "fact", topK: MEMORY_GATEWAY_LIMITS.SearchResultsMaximum + 1 }).success).toBe(false);
		expect(___MemoryGatewaySearchResponseSchema.safeParse({ datasetId: _IDS.dataset, facts: oversizedFacts }).success).toBe(false);
	});

	it("rejects duplicate chunks, document IDs used as chunks, and Cognee response aliases", function _RejectUnsafeSearchCoordinates()
	{
		expect(___MemoryGatewaySearchResponseSchema.safeParse({ datasetId: _IDS.dataset, facts: [_Fact(), _Fact(_IDS.chunk, _IDS.secondDocument)] }).success).toBe(false);
		expect(___MemoryGatewaySearchResponseSchema.safeParse({ datasetId: _IDS.dataset, facts: [_Fact(_IDS.document, _IDS.document)] }).success).toBe(false);
		expect(___MemoryGatewaySearchResponseSchema.safeParse({ datasetId: _IDS.dataset, facts: [_Fact(_IDS.chunk, _IDS.dataset)] }).success).toBe(false);
		expect(___MemoryGatewaySearchResponseSchema.safeParse({ dataset_id: _IDS.dataset, search_result: [{ id: _IDS.chunk, document_id: _IDS.document, text: "fact" }] }).success).toBe(false);
	});
});

describe("memory gateway error contracts", function _DescribeErrors()
{
	it("keeps reads free of delivery evidence and requires it for mutations", function _SeparateErrorEvidence()
	{
		expect(___MemoryGatewayReadErrorSchema.parse({ error: MemoryGatewayErrorCodes.NotFound })).toEqual({ error: MemoryGatewayErrorCodes.NotFound });
		expect(___MemoryGatewayReadErrorSchema.safeParse({ error: MemoryGatewayErrorCodes.NotFound, deliveryState: MemoryMutationDeliveryStates.ProvenNotSent }).success).toBe(false);
		expect(___MemoryGatewayMutationErrorSchema.parse({ error: MemoryGatewayErrorCodes.ProviderUnavailable, deliveryState: MemoryMutationDeliveryStates.Ambiguous })).toEqual({ error: MemoryGatewayErrorCodes.ProviderUnavailable, deliveryState: MemoryMutationDeliveryStates.Ambiguous });
		expect(___MemoryGatewayMutationErrorSchema.safeParse({ error: MemoryGatewayErrorCodes.ProviderUnavailable }).success).toBe(false);
	});

	it("requires proof of no send for gateway refusals while preserving provider ambiguity", function _ValidateRefusalDelivery()
	{
		for (const error of [MemoryGatewayErrorCodes.InvalidRequest, MemoryGatewayErrorCodes.Unauthorized])
		{
			expect(___MemoryGatewayMutationErrorSchema.safeParse({ error, deliveryState: MemoryMutationDeliveryStates.ProvenNotSent }).success).toBe(true);
			expect(___MemoryGatewayMutationErrorSchema.safeParse({ error, deliveryState: MemoryMutationDeliveryStates.Ambiguous }).success).toBe(false);
		}
		for (const deliveryState of Object.values(MemoryMutationDeliveryStates))
		{
			expect(___MemoryGatewayMutationErrorSchema.safeParse({ error: MemoryGatewayErrorCodes.NotFound, deliveryState }).success).toBe(true);
		}
	});

	it("rejects provider messages and unknown failure categories", function _RejectProviderErrorData()
	{
		expect(___MemoryGatewayReadErrorSchema.safeParse({ error: "upstream_timeout", detail: "provider body" }).success).toBe(false);
		expect(___MemoryGatewayMutationErrorSchema.safeParse({ error: MemoryGatewayErrorCodes.Conflict, deliveryState: "maybe", content: "fact" }).success).toBe(false);
	});
});
