import { MemoryGatewayErrorCodes, MemoryMutationDeliveryStates, ___MemoryGatewayDocumentAddResponseSchema, ___MemoryGatewayDocumentDeleteResponseSchema } from "@opencrane/contracts";
import type { MemoryGatewayDocumentAddRequest, MemoryGatewayDocumentAddResponse, MemoryGatewayDocumentDeleteRequest, MemoryGatewayDocumentDeleteResponse } from "@opencrane/contracts";

import type { CogneeProviderSession } from "../auth/cognee-provider-session.types";
import { _BuildCogneeAddMultipart } from "./cognee-multipart";
import { _ListDocuments, _ReadDocumentDigest } from "./cognee-document-read-operations";
import { _PrepareMutation, _ReadExchange, _ReconciliationFailure } from "./cognee-provider-operation-io";
import { _CanonicalProviderUuid, _ContentDigest, _MutationErrorForStatus, _ParseSharedValue, _PostDispatchMutationFailure, _PreDispatchMutationFailure, _ReadErrorForStatus } from "./cognee-provider-operation-support";
import { MemoryGatewayProviderMutationError, MemoryGatewayProviderReadError } from "./memory-gateway-provider-error";

/** Recover exactly one digest-matching member without replaying Add. */
async function _RecoverAddedDocument(session: CogneeProviderSession, request: MemoryGatewayDocumentAddRequest, signal: AbortSignal | undefined): Promise<MemoryGatewayDocumentAddResponse | null>
{
	const listed = await _ListDocuments(session, { datasetId: request.datasetId }, signal);
	const candidates = listed.documents.filter(document => document.contentDigest === request.contentDigest);
	const matches: string[] = [];
	for (const candidate of candidates)
	{
		try
		{
			const digest = await _ReadDocumentDigest(session, { datasetId: request.datasetId, documentId: candidate.documentId }, signal);
			if (digest.contentDigest === request.contentDigest)
				matches.push(candidate.documentId);
		}
		catch (error)
		{
			if (error instanceof MemoryGatewayProviderReadError && error.error === MemoryGatewayErrorCodes.NotFound)
				continue;
			throw error;
		}
	}
	if (matches.length === 0)
		return null;
	if (matches.length !== 1)
		throw new MemoryGatewayProviderMutationError(MemoryGatewayErrorCodes.Conflict, MemoryMutationDeliveryStates.Ambiguous);
	const value = { datasetId: request.datasetId, documentId: matches[0], contentDigest: request.contentDigest };
	try
	{
		return _ParseSharedValue(___MemoryGatewayDocumentAddResponseSchema, value);
	}
	catch (error)
	{
		throw _ReconciliationFailure(error);
	}
}

/** Confirm that neither dataset membership nor the raw route still exposes the document. */
async function _ConfirmDeleted(session: CogneeProviderSession, request: MemoryGatewayDocumentDeleteRequest, signal: AbortSignal | undefined): Promise<MemoryGatewayDocumentDeleteResponse | null>
{
	const datasetId = _CanonicalProviderUuid(request.datasetId);
	const documentId = _CanonicalProviderUuid(request.documentId);
	const listed = await _ListDocuments(session, { datasetId }, signal);
	if (listed.documents.some(document => document.documentId === documentId))
		return null;
	const raw = await _ReadExchange(session, { method: "GET", path: `/api/v1/datasets/${datasetId}/data/${documentId}/raw`, signal });
	if (raw.status !== 404)
		throw new MemoryGatewayProviderReadError(raw.status === 200 ? MemoryGatewayErrorCodes.Conflict : _ReadErrorForStatus(raw.status).error);
	return _ParseSharedValue(___MemoryGatewayDocumentDeleteResponseSchema, { datasetId, documentId });
}

/** Add one bounded text document and recover its provider identity by complete raw digest. */
export async function _AddDocument(session: CogneeProviderSession, request: MemoryGatewayDocumentAddRequest, signal?: AbortSignal): Promise<MemoryGatewayDocumentAddResponse>
{
	const datasetId = _CanonicalProviderUuid(request.datasetId);
	const normalizedRequest = { ...request, datasetId };
	const content = new TextEncoder().encode(request.content);
	if (_ContentDigest(content) !== request.contentDigest)
		throw new MemoryGatewayProviderMutationError(MemoryGatewayErrorCodes.Conflict, MemoryMutationDeliveryStates.ProvenNotSent);
	let existing: MemoryGatewayDocumentAddResponse | null;
	try
	{
		existing = await _RecoverAddedDocument(session, normalizedRequest, signal);
	}
	catch (error)
	{
		if (error instanceof MemoryGatewayProviderMutationError)
			throw error;
		throw new MemoryGatewayProviderMutationError(_ReadErrorCode(error), MemoryMutationDeliveryStates.ProvenNotSent);
	}
	if (existing !== null)
		return existing;
	const multipart = _BuildCogneeAddMultipart(datasetId, request.contentDigest, content);
	await _PrepareMutation(session, signal);
	let dispatchedFailure: MemoryGatewayProviderMutationError | undefined;
	try
	{
		const response = await session.exchange({ method: "POST", path: "/api/v1/add", headers: { "content-type": multipart.contentType }, body: multipart.body, signal });
		if (response.status !== 200)
		{
			const failure = _MutationErrorForStatus(response.status);
			if (failure.deliveryState === MemoryMutationDeliveryStates.ProvenNotSent)
				throw failure;
			dispatchedFailure = failure;
		}
	}
	catch (error)
	{
		const failure = _PostDispatchMutationFailure(error);
		if (failure.deliveryState === MemoryMutationDeliveryStates.ProvenNotSent)
			throw failure;
		dispatchedFailure = failure;
	}

	try
	{
		const recovered = await _RecoverAddedDocument(session, normalizedRequest, signal);
		if (recovered !== null)
			return recovered;
		if (dispatchedFailure !== undefined)
			throw dispatchedFailure;
		throw new MemoryGatewayProviderMutationError(MemoryGatewayErrorCodes.ProviderProtocol, MemoryMutationDeliveryStates.Ambiguous);
	}
	catch (error)
	{
		if (error instanceof MemoryGatewayProviderMutationError)
			throw error;
		if (dispatchedFailure !== undefined)
			throw dispatchedFailure;
		throw _ReconciliationFailure(error);
	}
}

/** Delete one exact document and require both membership and raw reads to prove absence. */
export async function _DeleteDocument(session: CogneeProviderSession, request: MemoryGatewayDocumentDeleteRequest, signal?: AbortSignal): Promise<MemoryGatewayDocumentDeleteResponse>
{
	const normalizedRequest = { datasetId: _CanonicalProviderUuid(request.datasetId), documentId: _CanonicalProviderUuid(request.documentId) };
	let before: MemoryGatewayDocumentDeleteResponse | null;
	try
	{
		before = await _ConfirmDeleted(session, normalizedRequest, signal);
	}
	catch (error)
	{
		if (error instanceof MemoryGatewayProviderMutationError)
			throw error;
		throw _PreDispatchMutationFailure(error);
	}
	if (before !== null)
		return before;
	await _PrepareMutation(session, signal);
	let dispatchedFailure: MemoryGatewayProviderMutationError | undefined;
	try
	{
		const response = await session.exchange({ method: "DELETE", path: `/api/v1/datasets/${normalizedRequest.datasetId}/data/${normalizedRequest.documentId}`, signal });
		if (response.status !== 200 && response.status !== 204)
		{
			const failure = _MutationErrorForStatus(response.status);
			if (failure.deliveryState === MemoryMutationDeliveryStates.ProvenNotSent)
				throw failure;
			dispatchedFailure = failure;
		}
		else if (response.body.byteLength > 0 && new TextDecoder().decode(response.body) !== "null")
		{
			throw new MemoryGatewayProviderMutationError(MemoryGatewayErrorCodes.ProviderProtocol, MemoryMutationDeliveryStates.Ambiguous);
		}
	}
	catch (error)
	{
		const failure = _PostDispatchMutationFailure(error);
		if (failure.deliveryState === MemoryMutationDeliveryStates.ProvenNotSent)
			throw failure;
		dispatchedFailure = failure;
	}

	try
	{
		const after = await _ConfirmDeleted(session, normalizedRequest, signal);
		if (after !== null)
			return after;
		if (dispatchedFailure !== undefined)
			throw dispatchedFailure;
		throw new MemoryGatewayProviderMutationError(MemoryGatewayErrorCodes.ProviderProtocol, MemoryMutationDeliveryStates.Ambiguous);
	}
	catch (error)
	{
		if (error instanceof MemoryGatewayProviderMutationError)
			throw error;
		if (dispatchedFailure !== undefined)
			throw dispatchedFailure;
		throw _ReconciliationFailure(error);
	}
}

/** Extract only the fixed read code from a pre-dispatch provider failure. */
function _ReadErrorCode(error: unknown): MemoryGatewayErrorCodes
{
	return error instanceof MemoryGatewayProviderReadError ? error.error : MemoryGatewayErrorCodes.ProviderUnavailable;
}
