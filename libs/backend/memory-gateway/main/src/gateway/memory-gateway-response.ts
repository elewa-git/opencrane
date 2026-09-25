import type { ServerResponse } from "node:http";

import { MemoryGatewayErrorCodes, MemoryMutationDeliveryStates } from "@opencrane/contracts";

import { MemoryGatewayProviderMutationError, MemoryGatewayProviderReadError } from "../provider/operations/memory-gateway-provider-error";
import { _MemoryGatewayRequestError, _MemoryGatewayResponseError } from "./memory-gateway-request";

/** Largest escaped JSON response accepted by the server's matching gateway client. */
const _MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/** Map each shared failure code to the status expected by the server client. */
const _STATUS_BY_CODE: Readonly<Record<MemoryGatewayErrorCodes, number>> = {
	[MemoryGatewayErrorCodes.InvalidRequest]: 422,
	[MemoryGatewayErrorCodes.Unauthorized]: 401,
	[MemoryGatewayErrorCodes.NotFound]: 404,
	[MemoryGatewayErrorCodes.Conflict]: 409,
	[MemoryGatewayErrorCodes.ProviderProtocol]: 502,
	[MemoryGatewayErrorCodes.ProviderUnavailable]: 503,
};

/** Write bounded JSON without forwarding any provider headers. */
export function _WriteMemoryGatewayJson(response: ServerResponse, status: number, value: unknown): void
{
	const body = Buffer.from(JSON.stringify(value));
	if (body.byteLength > _MAX_RESPONSE_BYTES)
		throw new _MemoryGatewayResponseError();
	if (response.destroyed)
		return;
	response.writeHead(status, { "content-type": "application/json", "content-length": body.byteLength });
	response.end(body);
}

/** Report a refusal known to precede provider dispatch, with delivery evidence only for mutations. */
export function _RefuseMemoryGatewayRequest(response: ServerResponse, error: MemoryGatewayErrorCodes, mutation: boolean): void
{
	const value = mutation ? { error, deliveryState: MemoryMutationDeliveryStates.ProvenNotSent } : { error };
	_WriteMemoryGatewayJson(response, _STATUS_BY_CODE[error], value);
}

/** Classify a failure without keeping provider or request details in the HTTP response. */
export function _MemoryGatewayFailureCode(error: unknown): MemoryGatewayErrorCodes
{
	if (error instanceof _MemoryGatewayRequestError)
		return MemoryGatewayErrorCodes.InvalidRequest;
	if (error instanceof _MemoryGatewayResponseError)
		return MemoryGatewayErrorCodes.ProviderProtocol;
	if (error instanceof MemoryGatewayProviderReadError || error instanceof MemoryGatewayProviderMutationError)
		return error.error;
	return MemoryGatewayErrorCodes.ProviderUnavailable;
}

/** Keep typed provider delivery evidence; an unclassified failure after dispatch remains uncertain. */
export function _WriteMemoryGatewayFailure(response: ServerResponse, error: unknown, mutation: boolean, enteredOperation: boolean): void
{
	const code = _MemoryGatewayFailureCode(error);
	if (!mutation)
		return _WriteMemoryGatewayJson(response, _STATUS_BY_CODE[code], { error: code });
	let deliveryState = enteredOperation ? MemoryMutationDeliveryStates.Ambiguous : MemoryMutationDeliveryStates.ProvenNotSent;
	if (error instanceof _MemoryGatewayRequestError)
		deliveryState = MemoryMutationDeliveryStates.ProvenNotSent;
	if (error instanceof MemoryGatewayProviderMutationError)
		deliveryState = error.deliveryState;
	_WriteMemoryGatewayJson(response, _STATUS_BY_CODE[code], { error: code, deliveryState });
}
