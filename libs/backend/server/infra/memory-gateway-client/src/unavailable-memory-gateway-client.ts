import { MemoryGatewayErrorCodes, MemoryMutationDeliveryStates } from "@opencrane/contracts";
import type { MemoryGatewayDatasetCognifyRequest, MemoryGatewayDatasetCognifyResponse, MemoryGatewayDatasetEnsureRequest, MemoryGatewayDatasetEnsureResponse, MemoryGatewayDatasetListRequest, MemoryGatewayDatasetListResponse, MemoryGatewayDocumentAddRequest, MemoryGatewayDocumentAddResponse, MemoryGatewayDocumentDeleteRequest, MemoryGatewayDocumentDeleteResponse, MemoryGatewayDocumentListRequest, MemoryGatewayDocumentListResponse, MemoryGatewayDocumentRawDigestRequest, MemoryGatewayDocumentRawDigestResponse } from "@opencrane/contracts";

import { MemoryGatewayMutationFailure, MemoryGatewayReadFailure } from "./memory-gateway-errors";
import { __AssertMemoryProvenanceComplete } from "./memory-provenance";
import type { MemoryGatewayClient, MemoryGatewayOperationContext, MemoryQueryCommand, MemoryQueryResult, ScopedMemoryInjectionCommand, ScopedMemoryRecallCommand, ScopedMemoryRecallResult } from "./memory-gateway-client.types";

/** Typed failure proving that an unconfigured client dispatched no mutation. */
export class MemoryGatewayUnavailableError extends MemoryGatewayMutationFailure
{
	/** Creates the fixed provider-unavailable mutation result. */
	constructor()
	{
		super(MemoryGatewayErrorCodes.ProviderUnavailable, MemoryMutationDeliveryStates.ProvenNotSent);
		this.name = "MemoryGatewayUnavailableError";
	}
}

/** Fail-closed adapter used when no authenticated private gateway transport is configured. */
export class __UnavailableMemoryGatewayClient implements MemoryGatewayClient
{
	/** Rejects personal recall instead of returning a fabricated empty result. */
	async query(_command: MemoryQueryCommand): Promise<MemoryQueryResult>
	{
		throw new MemoryGatewayReadFailure(MemoryGatewayErrorCodes.ProviderUnavailable);
	}

	/** Rejects dataset creation while proving no request was dispatched. */
	async ensureDataset(_context: MemoryGatewayOperationContext, _request: MemoryGatewayDatasetEnsureRequest): Promise<MemoryGatewayDatasetEnsureResponse>
	{
		throw new MemoryGatewayUnavailableError();
	}

	/** Rejects dataset recovery instead of returning a fabricated absence. */
	async listDatasets(_context: MemoryGatewayOperationContext, _request: MemoryGatewayDatasetListRequest): Promise<MemoryGatewayDatasetListResponse>
	{
		throw new MemoryGatewayReadFailure(MemoryGatewayErrorCodes.ProviderUnavailable);
	}

	/** Rejects document creation while proving no request was dispatched. */
	async addDocument(_context: MemoryGatewayOperationContext, _request: MemoryGatewayDocumentAddRequest): Promise<MemoryGatewayDocumentAddResponse>
	{
		throw new MemoryGatewayUnavailableError();
	}

	/** Rejects document recovery instead of returning a fabricated absence. */
	async listDocuments(_context: MemoryGatewayOperationContext, _request: MemoryGatewayDocumentListRequest): Promise<MemoryGatewayDocumentListResponse>
	{
		throw new MemoryGatewayReadFailure(MemoryGatewayErrorCodes.ProviderUnavailable);
	}

	/** Rejects raw digest recovery instead of inventing document evidence. */
	async readDocumentDigest(_context: MemoryGatewayOperationContext, _request: MemoryGatewayDocumentRawDigestRequest): Promise<MemoryGatewayDocumentRawDigestResponse>
	{
		throw new MemoryGatewayReadFailure(MemoryGatewayErrorCodes.ProviderUnavailable);
	}

	/** Rejects indexing while proving no request was dispatched. */
	async cognifyDataset(_context: MemoryGatewayOperationContext, _request: MemoryGatewayDatasetCognifyRequest): Promise<MemoryGatewayDatasetCognifyResponse>
	{
		throw new MemoryGatewayUnavailableError();
	}

	/** Rejects deletion while proving no request was dispatched. */
	async deleteDocument(_context: MemoryGatewayOperationContext, _request: MemoryGatewayDocumentDeleteRequest): Promise<MemoryGatewayDocumentDeleteResponse>
	{
		throw new MemoryGatewayUnavailableError();
	}

	/** Rejects scoped recall instead of returning a fabricated empty result. */
	async recallScoped(_command: ScopedMemoryRecallCommand): Promise<ScopedMemoryRecallResult>
	{
		throw new MemoryGatewayReadFailure(MemoryGatewayErrorCodes.ProviderUnavailable);
	}

	/** Enforces complete provenance, then rejects the still-unimplemented scoped write. */
	async injectScoped(command: ScopedMemoryInjectionCommand): Promise<void>
	{
		__AssertMemoryProvenanceComplete(command.provenance);
		throw new MemoryGatewayUnavailableError();
	}
}
