import { z } from "zod";

import { MemoryMutationDeliveryStates } from "../memory.types";
import { MEMORY_GATEWAY_LIMITS, MemoryGatewayErrorCodes } from "./memory-gateway.types";
import type { MemoryGatewayDataset, MemoryGatewayDatasetCognifyRequest, MemoryGatewayDatasetCognifyResponse, MemoryGatewayDatasetEnsureRequest, MemoryGatewayDatasetEnsureResponse, MemoryGatewayDatasetListRequest, MemoryGatewayDatasetListResponse, MemoryGatewayDocument, MemoryGatewayDocumentAddRequest, MemoryGatewayDocumentAddResponse, MemoryGatewayDocumentDeleteRequest, MemoryGatewayDocumentListRequest, MemoryGatewayDocumentListResponse, MemoryGatewayDocumentRawDigestRequest, MemoryGatewayDocumentRawDigestResponse, MemoryGatewayMutationError, MemoryGatewayReadError, MemoryGatewaySearchFact, MemoryGatewaySearchRequest, MemoryGatewaySearchResponse } from "./memory-gateway.types";

/** Encoder used to enforce byte limits without depending on Node.js Buffer. */
const _Utf8Encoder = new TextEncoder();

/** Exact lowercase SHA-256 format shared by personal-memory recovery evidence. */
const _ContentDigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

/** Opaque dataset name format that cannot carry user-readable identity. */
const _DatasetNameSchema = z.string()
	.min(MEMORY_GATEWAY_LIMITS.DatasetNameMinimumCharacters)
	.max(MEMORY_GATEWAY_LIMITS.DatasetNameMaximumCharacters)
	.regex(/^[A-Za-z0-9_-]+$/);

/** Document name format that excludes paths and control characters. */
const _DocumentNameSchema = z.string()
	.min(1)
	.max(MEMORY_GATEWAY_LIMITS.DocumentNameMaximumCharacters)
	.regex(/^[^\u0000-\u001f\u007f/\\]+$/);

/** Bounded media type with one type/subtype separator and no whitespace. */
const _MimeTypeSchema = z.string()
	.min(3)
	.max(MEMORY_GATEWAY_LIMITS.MimeTypeMaximumCharacters)
	.regex(/^[^\s/]+\/[^\s/]+$/);

/** Return whether a string occupies a permitted number of UTF-8 bytes. */
function _HasUtf8Bytes(value: string, minimum: number, maximum: number): boolean
{
	const length = _Utf8Encoder.encode(value).byteLength;
	return length >= minimum && length <= maximum;
}

/** Return whether every selected string is unique. */
function _HasUniqueStrings(values: readonly string[]): boolean
{
	return new Set(values).size === values.length;
}

/** Bounded fact text that preserves the caller's exact bytes, including whitespace. */
const _FactContentSchema = z.string().refine(function _HasBoundedFactBytes(value): boolean
{
	return _HasUtf8Bytes(value, 1, MEMORY_GATEWAY_LIMITS.TextMaximumBytes);
});

/** Non-blank bounded recall query. */
const _QuerySchema = z.string().refine(function _HasBoundedQueryBytes(value): boolean
{
	return value.trim().length > 0 && _HasUtf8Bytes(value, 1, MEMORY_GATEWAY_LIMITS.QueryMaximumBytes);
});

/** Strict wire schema for one projected provider dataset. */
export const ___MemoryGatewayDatasetSchema: z.ZodType<MemoryGatewayDataset> = z.object({
	datasetId: z.string().uuid(),
	datasetName: _DatasetNameSchema,
}).strict();

/** Strict request schema for ensuring one saved opaque dataset name. */
export const ___MemoryGatewayDatasetEnsureRequestSchema: z.ZodType<MemoryGatewayDatasetEnsureRequest> = z.object({
	datasetName: _DatasetNameSchema,
}).strict();

/** Strict response schema for a dataset ensure receipt. */
export const ___MemoryGatewayDatasetEnsureResponseSchema: z.ZodType<MemoryGatewayDatasetEnsureResponse> = z.object({
	dataset: ___MemoryGatewayDatasetSchema,
}).strict();

/** Strict request schema for listing one saved opaque dataset name. */
export const ___MemoryGatewayDatasetListRequestSchema: z.ZodType<MemoryGatewayDatasetListRequest> = z.object({
	datasetName: _DatasetNameSchema,
}).strict();

/** Strict response schema for an exact-name dataset lookup. */
export const ___MemoryGatewayDatasetListResponseSchema: z.ZodType<MemoryGatewayDatasetListResponse> = z.object({
	datasets: z.array(___MemoryGatewayDatasetSchema)
		.max(MEMORY_GATEWAY_LIMITS.DatasetResultsMaximum)
		.refine(function _HasUniqueDatasetIds(datasets): boolean
		{
			return _HasUniqueStrings(datasets.map(dataset => dataset.datasetId));
		}),
}).strict();

/** Strict wire schema for safe document metadata. */
export const ___MemoryGatewayDocumentSchema: z.ZodType<MemoryGatewayDocument> = z.object({
	documentId: z.string().uuid(),
	name: _DocumentNameSchema,
	mimeType: _MimeTypeSchema,
}).strict();

/** Strict request schema for adding one bounded text document. */
export const ___MemoryGatewayDocumentAddRequestSchema: z.ZodType<MemoryGatewayDocumentAddRequest> = z.object({
	datasetId: z.string().uuid(),
	content: _FactContentSchema,
	contentDigest: _ContentDigestSchema,
}).strict();

/** Strict response schema for a digest-recovered added document. */
export const ___MemoryGatewayDocumentAddResponseSchema: z.ZodType<MemoryGatewayDocumentAddResponse> = z.object({
	datasetId: z.string().uuid(),
	documentId: z.string().uuid(),
	contentDigest: _ContentDigestSchema,
}).strict().refine(function _UsesSeparateAddedDocumentIdentity(response): boolean
{
	return response.datasetId !== response.documentId;
});

/** Strict request schema for listing one dataset's documents. */
export const ___MemoryGatewayDocumentListRequestSchema: z.ZodType<MemoryGatewayDocumentListRequest> = z.object({
	datasetId: z.string().uuid(),
}).strict();

/** Strict response schema for bounded, unique document metadata. */
export const ___MemoryGatewayDocumentListResponseSchema: z.ZodType<MemoryGatewayDocumentListResponse> = z.object({
	datasetId: z.string().uuid(),
	documents: z.array(___MemoryGatewayDocumentSchema)
		.max(MEMORY_GATEWAY_LIMITS.DocumentResultsMaximum)
		.refine(function _HasUniqueDocumentIds(documents): boolean
		{
			return _HasUniqueStrings(documents.map(document => document.documentId));
		}),
}).strict().refine(function _UsesSeparateListedDocumentIdentities(response): boolean
{
	return response.documents.every(document => document.documentId !== response.datasetId);
});

/** Strict request schema for hashing one exact raw document. */
export const ___MemoryGatewayDocumentRawDigestRequestSchema: z.ZodType<MemoryGatewayDocumentRawDigestRequest> = z.object({
	datasetId: z.string().uuid(),
	documentId: z.string().uuid(),
}).strict().refine(function _UsesSeparateRawDocumentIdentity(request): boolean
{
	return request.datasetId !== request.documentId;
});

/** Strict metadata-only response schema for a raw document digest. */
export const ___MemoryGatewayDocumentRawDigestResponseSchema: z.ZodType<MemoryGatewayDocumentRawDigestResponse> = z.object({
	datasetId: z.string().uuid(),
	documentId: z.string().uuid(),
	contentDigest: _ContentDigestSchema,
	byteLength: z.number().int().min(0).max(MEMORY_GATEWAY_LIMITS.TextMaximumBytes),
}).strict().refine(function _UsesSeparateRawDigestIdentity(response): boolean
{
	return response.datasetId !== response.documentId;
});

/** Strict request schema for blocking dataset processing. */
export const ___MemoryGatewayDatasetCognifyRequestSchema: z.ZodType<MemoryGatewayDatasetCognifyRequest> = z.object({
	datasetId: z.string().uuid(),
}).strict();

/** Strict response schema for an immediately completed cognify call. */
export const ___MemoryGatewayDatasetCognifyResponseSchema: z.ZodType<MemoryGatewayDatasetCognifyResponse> = z.object({
	datasetId: z.string().uuid(),
}).strict();

/** Strict request schema for one bounded dataset search. */
export const ___MemoryGatewaySearchRequestSchema: z.ZodType<MemoryGatewaySearchRequest> = z.object({
	datasetId: z.string().uuid(),
	query: _QuerySchema,
	topK: z.number().int().min(1).max(MEMORY_GATEWAY_LIMITS.SearchResultsMaximum),
}).strict();

/** Strict wire schema for one ranked passage and its separate document coordinate. */
export const ___MemoryGatewaySearchFactSchema: z.ZodType<MemoryGatewaySearchFact> = z.object({
	documentId: z.string().uuid(),
	chunkId: z.string().uuid(),
	content: _FactContentSchema,
}).strict().refine(function _UsesSeparateChunkIdentity(fact): boolean
{
	return fact.chunkId !== fact.documentId;
});

/** Strict response schema for ranked facts from one exact dataset. */
export const ___MemoryGatewaySearchResponseSchema: z.ZodType<MemoryGatewaySearchResponse> = z.object({
	datasetId: z.string().uuid(),
	facts: z.array(___MemoryGatewaySearchFactSchema)
		.max(MEMORY_GATEWAY_LIMITS.SearchResultsMaximum)
		.refine(function _HasUniqueChunkIds(facts): boolean
		{
			return _HasUniqueStrings(facts.map(fact => fact.chunkId));
		}),
}).strict().refine(function _UsesSeparateSearchIdentities(response): boolean
{
	return response.facts.every(function _IsSeparateFactIdentity(fact): boolean
	{
		return response.datasetId !== fact.documentId && response.datasetId !== fact.chunkId;
	});
});

/** Strict path-coordinate schema for deleting one exact document. */
export const ___MemoryGatewayDocumentDeleteRequestSchema: z.ZodType<MemoryGatewayDocumentDeleteRequest> = z.object({
	datasetId: z.string().uuid(),
	documentId: z.string().uuid(),
}).strict().refine(function _UsesSeparateDeletedDocumentIdentity(request): boolean
{
	return request.datasetId !== request.documentId;
});

/** Strict read-error schema that rejects mutation delivery evidence. */
export const ___MemoryGatewayReadErrorSchema: z.ZodType<MemoryGatewayReadError> = z.object({
	error: z.nativeEnum(MemoryGatewayErrorCodes),
}).strict();

/** Strict mutation-error schema that requires provider delivery evidence. */
export const ___MemoryGatewayMutationErrorSchema: z.ZodType<MemoryGatewayMutationError> = z.object({
	error: z.nativeEnum(MemoryGatewayErrorCodes),
	deliveryState: z.nativeEnum(MemoryMutationDeliveryStates),
}).strict().refine(function _MatchesGatewayRefusalDelivery(error): boolean
{
	if (error.error === MemoryGatewayErrorCodes.InvalidRequest || error.error === MemoryGatewayErrorCodes.Unauthorized)
		return error.deliveryState === MemoryMutationDeliveryStates.ProvenNotSent;
	return true;
});
