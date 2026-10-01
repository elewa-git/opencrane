import type { MemoryGatewayDatasetCognifyRequest, MemoryGatewayDatasetCognifyResponse, MemoryGatewayDatasetEnsureRequest, MemoryGatewayDatasetEnsureResponse, MemoryGatewayDatasetListRequest, MemoryGatewayDatasetListResponse, MemoryGatewayDocumentAddRequest, MemoryGatewayDocumentAddResponse, MemoryGatewayDocumentDeleteRequest, MemoryGatewayDocumentDeleteResponse, MemoryGatewayDocumentListRequest, MemoryGatewayDocumentListResponse, MemoryGatewayDocumentRawDigestRequest, MemoryGatewayDocumentRawDigestResponse, MemoryGatewaySearchRequest, MemoryGatewaySearchResponse } from "@opencrane/contracts";

/**
 * Translates the stable memory-gateway contract to the pinned provider protocol.
 *
 * Callers validate shared requests before invoking this port. Every method accepts the request's
 * cancellation signal and either returns a projected shared DTO or throws one of the fixed provider
 * errors. Mutation failures always state whether provider delivery is known.
 */
export interface MemoryGatewayProviderOperations
{
	/** Ensure the provider dataset with this saved opaque name and return its exact identity. */
	ensureDataset(request: MemoryGatewayDatasetEnsureRequest, signal?: AbortSignal): Promise<MemoryGatewayDatasetEnsureResponse>;
	/** List zero or one provider dataset matching the saved opaque name. */
	listDatasets(request: MemoryGatewayDatasetListRequest, signal?: AbortSignal): Promise<MemoryGatewayDatasetListResponse>;
	/** Add one text document and adopt it only after full raw-digest recovery. */
	addDocument(request: MemoryGatewayDocumentAddRequest, signal?: AbortSignal): Promise<MemoryGatewayDocumentAddResponse>;
	/** List projected metadata for documents in one exact dataset. */
	listDocuments(request: MemoryGatewayDocumentListRequest, signal?: AbortSignal): Promise<MemoryGatewayDocumentListResponse>;
	/** Hash the complete bounded raw bytes for one exact dataset/document pair. */
	readDocumentDigest(request: MemoryGatewayDocumentRawDigestRequest, signal?: AbortSignal): Promise<MemoryGatewayDocumentRawDigestResponse>;
	/** Run the provider's blocking cognify pipeline for one exact dataset. */
	cognifyDataset(request: MemoryGatewayDatasetCognifyRequest, signal?: AbortSignal): Promise<MemoryGatewayDatasetCognifyResponse>;
	/** Return ranked CHUNKS results from one exact dataset envelope. */
	search(request: MemoryGatewaySearchRequest, signal?: AbortSignal): Promise<MemoryGatewaySearchResponse>;
	/** Delete one document and return only after list and raw reads both prove absence. */
	deleteDocument(request: MemoryGatewayDocumentDeleteRequest, signal?: AbortSignal): Promise<MemoryGatewayDocumentDeleteResponse>;
}
