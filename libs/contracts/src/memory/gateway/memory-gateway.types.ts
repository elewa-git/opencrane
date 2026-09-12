import type { MemoryMutationDeliveryStates } from "../memory.types";

/** Stable route paths used only between the OpenCrane server and the private memory gateway. */
export const MEMORY_GATEWAY_ROUTE_PATHS = {
	DatasetEnsure: "/api/v1/memory/datasets/ensure",
	DatasetList: "/api/v1/memory/datasets/list",
	DocumentAdd: "/api/v1/memory/documents/add",
	DocumentList: "/api/v1/memory/documents/list",
	DocumentRawDigest: "/api/v1/memory/documents/raw-digest",
	DatasetCognify: "/api/v1/memory/datasets/cognify",
	Search: "/api/v1/memory/search",
	DocumentDelete: "/api/v1/memory/datasets/{datasetId}/documents/{documentId}",
} as const;

/** Shared limits enforced by both ends of the private memory-gateway connection. */
export const MEMORY_GATEWAY_LIMITS = {
	DatasetNameMinimumCharacters: 43,
	DatasetNameMaximumCharacters: 128,
	DocumentNameMaximumCharacters: 255,
	MimeTypeMaximumCharacters: 255,
	TextMaximumBytes: 65_536,
	QueryMaximumBytes: 4_096,
	DatasetResultsMaximum: 1,
	DocumentResultsMaximum: 1_000,
	SearchResultsMaximum: 20,
} as const;

/**
 * Stable failure codes returned by the private memory gateway.
 *
 * These values cross the internal HTTP boundary. Renaming a member or serialized value breaks the
 * OpenCrane server client. They disclose only the failure class and never provider response text.
 */
export enum MemoryGatewayErrorCodes
{
	/** The request did not satisfy the stable gateway contract and no provider action is allowed. */
	InvalidRequest = "invalid_request",
	/** The calling workload did not prove the one server identity accepted by the gateway. */
	Unauthorized = "unauthorized",
	/** The requested dataset or document is absent; this alone says nothing about earlier delivery. */
	NotFound = "not_found",
	/** Provider evidence conflicts with the requested identity, digest, or unique result. */
	Conflict = "conflict",
	/** The provider or its authenticated session is unavailable, so the operation did not complete. */
	ProviderUnavailable = "provider_unavailable",
	/** The provider returned a shape or coordinate that the pinned adapter cannot interpret safely. */
	ProviderProtocol = "provider_protocol",
}

/** One provider dataset identity projected through the stable gateway contract. */
export interface MemoryGatewayDataset
{
	/** Provider UUID used for every later read or mutation. */
	readonly datasetId: string;
	/** Opaque name saved by OpenCrane before dataset provisioning starts. */
	readonly datasetName: string;
}

/** Request to ensure the one dataset identified by an already saved opaque name. */
export interface MemoryGatewayDatasetEnsureRequest
{
	/** Opaque pre-saved dataset name; it contains no user or fact text. */
	readonly datasetName: string;
}

/** Provider identity observed after a dataset ensure call completes. */
export interface MemoryGatewayDatasetEnsureResponse
{
	/** Dataset returned by the provider adapter. This receipt alone does not activate local memory. */
	readonly dataset: MemoryGatewayDataset;
}

/** Request to list datasets matching one already saved opaque name. */
export interface MemoryGatewayDatasetListRequest
{
	/** Exact opaque dataset name used to filter the provider response. */
	readonly datasetName: string;
}

/** Zero or one dataset matching an exact opaque name. */
export interface MemoryGatewayDatasetListResponse
{
	/** Matching datasets; more than one is a conflict and cannot be represented here. */
	readonly datasets: readonly MemoryGatewayDataset[];
}

/** Safe metadata for one document listed inside an admitted dataset. */
export interface MemoryGatewayDocument
{
	/** Provider Data UUID used with its containing dataset for raw reads and deletion. */
	readonly documentId: string;
	/** Provider document name after unsafe path and control characters are rejected. */
	readonly name: string;
	/** Media type reported for this document. */
	readonly mimeType: string;
}

/** Request to add one bounded text document to an exact dataset. */
export interface MemoryGatewayDocumentAddRequest
{
	/** Provider dataset UUID selected by OpenCrane authority. */
	readonly datasetId: string;
	/** Complete UTF-8 fact text sent only to the private gateway. */
	readonly content: string;
	/** SHA-256 digest of the complete UTF-8 content. */
	readonly contentDigest: string;
}

/** Full identity evidence returned after an added document is recovered by digest. */
export interface MemoryGatewayDocumentAddResponse
{
	/** Provider dataset UUID in which the document was verified. */
	readonly datasetId: string;
	/** Provider Data UUID recovered from dataset membership and complete raw bytes. */
	readonly documentId: string;
	/** SHA-256 digest recalculated from the complete provider raw bytes. */
	readonly contentDigest: string;
}

/** Request to list the documents in one exact dataset. */
export interface MemoryGatewayDocumentListRequest
{
	/** Provider dataset UUID selected by OpenCrane authority. */
	readonly datasetId: string;
}

/** Bounded document metadata for one exact dataset. */
export interface MemoryGatewayDocumentListResponse
{
	/** Dataset UUID whose membership was read. */
	readonly datasetId: string;
	/** Documents with unique identities; content and storage locations never appear here. */
	readonly documents: readonly MemoryGatewayDocument[];
}

/** Request to hash the complete raw bytes of one exact dataset document. */
export interface MemoryGatewayDocumentRawDigestRequest
{
	/** Provider dataset UUID selected by OpenCrane authority. */
	readonly datasetId: string;
	/** Provider Data UUID whose raw bytes must belong to the selected dataset. */
	readonly documentId: string;
}

/** Metadata-only evidence calculated from one raw provider document. */
export interface MemoryGatewayDocumentRawDigestResponse
{
	/** Provider dataset UUID against which membership was checked. */
	readonly datasetId: string;
	/** Provider Data UUID whose complete raw bytes were hashed. */
	readonly documentId: string;
	/** SHA-256 digest calculated from the complete raw bytes. */
	readonly contentDigest: string;
	/** Number of raw bytes included in the digest. */
	readonly byteLength: number;
}

/** Request to run blocking graph and vector processing for one dataset. */
export interface MemoryGatewayDatasetCognifyRequest
{
	/** Provider dataset UUID selected by OpenCrane authority. */
	readonly datasetId: string;
}

/** Transport receipt for one immediately completed blocking cognify call. */
export interface MemoryGatewayDatasetCognifyResponse
{
	/** Provider dataset UUID processed by the completed call. This receipt grants no local activation. */
	readonly datasetId: string;
}

/** Request to retrieve stored passages from one exact dataset. */
export interface MemoryGatewaySearchRequest
{
	/** Provider dataset UUID frozen into the admitted memory scope. */
	readonly datasetId: string;
	/** Non-blank recall query sent only for this authorized operation. */
	readonly query: string;
	/** Maximum number of ranked passages the caller will accept. */
	readonly topK: number;
}

/** One ranked passage with separate source-document and chunk identities. */
export interface MemoryGatewaySearchFact
{
	/** Provider Data UUID that may later be paired with the dataset for a mutation. */
	readonly documentId: string;
	/** Passage UUID; it is never accepted as a document mutation target. */
	readonly chunkId: string;
	/** Stored passage text returned transiently to the authorized caller. */
	readonly content: string;
}

/** Ranked passages returned for one exact dataset. */
export interface MemoryGatewaySearchResponse
{
	/** Provider dataset UUID echoed only after the provider envelope matches it. */
	readonly datasetId: string;
	/** Ranked passages with unique chunk identities, in provider order. */
	readonly facts: readonly MemoryGatewaySearchFact[];
}

/** Path coordinates for deleting one exact provider document. */
export interface MemoryGatewayDocumentDeleteRequest
{
	/** Provider dataset UUID selected by OpenCrane authority. */
	readonly datasetId: string;
	/** Provider Data UUID to delete; a chunk UUID is not valid here. */
	readonly documentId: string;
}

/** A read failure that cannot claim any mutation was attempted. */
export interface MemoryGatewayReadError
{
	/** Fixed failure class that carries no provider or fact content. */
	readonly error: MemoryGatewayErrorCodes;
}

/** A failed mutation together with whether its provider delivery is known. */
export interface MemoryGatewayMutationError
{
	/** Fixed failure class that carries no provider or fact content. */
	readonly error: MemoryGatewayErrorCodes;
	/** Evidence the durable workflow uses to choose reconciliation or an unchanged retry. */
	readonly deliveryState: MemoryMutationDeliveryStates;
}
