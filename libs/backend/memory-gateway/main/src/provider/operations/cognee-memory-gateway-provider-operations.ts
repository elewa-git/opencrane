import type { CogneeProviderSession } from "../auth/cognee-provider-session.types";
import { _EnsureDataset, _ListDatasets } from "./cognee-dataset-operations";
import { _AddDocument, _DeleteDocument } from "./cognee-document-mutation-operations";
import { _ListDocuments, _ReadDocumentDigest } from "./cognee-document-read-operations";
import { _CognifyDataset, _Search } from "./cognee-pipeline-operations";
import type { MemoryGatewayProviderOperations } from "./memory-gateway-provider-operations.types";

/** Build the provider operation port consumed by memory-gateway request handling. */
export function _CreateCogneeMemoryGatewayProviderOperations(session: CogneeProviderSession): MemoryGatewayProviderOperations
{
	return {
		ensureDataset: (request, signal) => _EnsureDataset(session, request, signal),
		listDatasets: (request, signal) => _ListDatasets(session, request, signal),
		addDocument: (request, signal) => _AddDocument(session, request, signal),
		listDocuments: (request, signal) => _ListDocuments(session, request, signal),
		readDocumentDigest: (request, signal) => _ReadDocumentDigest(session, request, signal),
		cognifyDataset: (request, signal) => _CognifyDataset(session, request, signal),
		search: (request, signal) => _Search(session, request, signal),
		deleteDocument: (request, signal) => _DeleteDocument(session, request, signal),
	};
}
