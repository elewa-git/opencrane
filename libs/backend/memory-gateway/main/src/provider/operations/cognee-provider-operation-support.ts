import { MemoryGatewayErrorCodes, MemoryMutationDeliveryStates } from "@opencrane/contracts";
import { z, type ZodType } from "zod";

import { CogneeProviderSessionError } from "../auth/cognee-provider-session-error";
import { CogneeProviderSessionFailureCodes } from "../auth/cognee-provider-session.types";
import type { CogneeProviderHttpResponse } from "../http/cognee-provider-http.types";
import { MemoryGatewayProviderMutationError, MemoryGatewayProviderReadError } from "./memory-gateway-provider-error";

/** Return the lowercase form used when UUID values cross the Python provider boundary. */
export function _CanonicalProviderUuid(value: string): string
{
	return value.toLowerCase();
}

/** Decode provider JSON without retaining its parse failure or content. */
export function _ParseProviderJson(response: CogneeProviderHttpResponse): unknown
{
	try
	{
		const value = new TextDecoder("utf-8", { fatal: true }).decode(response.body);
		return JSON.parse(value) as unknown;
	}
	catch
	{
		throw new MemoryGatewayProviderReadError(MemoryGatewayErrorCodes.ProviderProtocol);
	}
}

/** Parse an untrusted provider value through its adjacent schema. */
export function _ParseProviderValue<T>(schema: ZodType<T>, value: unknown): T
{
	const result = schema.safeParse(value);
	if (!result.success)
		throw new MemoryGatewayProviderReadError(MemoryGatewayErrorCodes.ProviderProtocol);
	return result.data;
}

/** Parse a projected value through the shared gateway contract. */
export function _ParseSharedValue<T>(schema: ZodType<T>, value: unknown): T
{
	const result = schema.safeParse(value);
	if (!result.success)
		throw new MemoryGatewayProviderReadError(MemoryGatewayErrorCodes.ProviderProtocol);
	return result.data;
}

/** Map a provider status without reading its body. */
export function _ReadErrorForStatus(status: number): MemoryGatewayProviderReadError
{
	if (status === 403 || status === 404)
		return new MemoryGatewayProviderReadError(MemoryGatewayErrorCodes.NotFound);
	if (status === 400 || status === 409 || status === 422)
		return new MemoryGatewayProviderReadError(MemoryGatewayErrorCodes.Conflict);
	if (status === 402 || status >= 500)
		return new MemoryGatewayProviderReadError(MemoryGatewayErrorCodes.ProviderUnavailable);
	return new MemoryGatewayProviderReadError(MemoryGatewayErrorCodes.ProviderProtocol);
}

/** Convert a provider or session failure into a content-free read failure. */
export function _ReadFailure(error: unknown): MemoryGatewayProviderReadError
{
	if (error instanceof MemoryGatewayProviderReadError)
		return error;
	if (error instanceof CogneeProviderSessionError)
	{
		const protocolFailure = error.code === CogneeProviderSessionFailureCodes.MalformedResponse
			|| error.code === CogneeProviderSessionFailureCodes.ResponseTooLarge
			|| error.code === CogneeProviderSessionFailureCodes.UnsafeRequest;
		const code = protocolFailure ? MemoryGatewayErrorCodes.ProviderProtocol : MemoryGatewayErrorCodes.ProviderUnavailable;
		return new MemoryGatewayProviderReadError(code);
	}
	return new MemoryGatewayProviderReadError(MemoryGatewayErrorCodes.ProviderUnavailable);
}

/** Map a provider rejection to a content-free mutation failure. */
export function _MutationErrorForStatus(status: number): MemoryGatewayProviderMutationError
{
	const read = _ReadErrorForStatus(status);
	const rejectedBeforeWork = status >= 400 && status < 500 && status !== 402;
	const deliveryState = rejectedBeforeWork ? MemoryMutationDeliveryStates.ProvenNotSent : MemoryMutationDeliveryStates.Ambiguous;
	return new MemoryGatewayProviderMutationError(read.error, deliveryState);
}

/** Convert a failure before mutation dispatch into an unchanged-retry result. */
export function _PreDispatchMutationFailure(error: unknown): MemoryGatewayProviderMutationError
{
	const read = _ReadFailure(error);
	return new MemoryGatewayProviderMutationError(read.error, MemoryMutationDeliveryStates.ProvenNotSent);
}

/** Convert a failure after dispatch starts into a reconciliation result. */
export function _PostDispatchMutationFailure(error: unknown): MemoryGatewayProviderMutationError
{
	if (error instanceof MemoryGatewayProviderMutationError)
		return error;
	const read = _ReadFailure(error);
	return new MemoryGatewayProviderMutationError(read.error, MemoryMutationDeliveryStates.Ambiguous);
}

/** Encode the small pinned provider request object. */
export function _ProviderJson(value: unknown): string
{
	return JSON.stringify(value);
}

/** UUID-keyed map returned by blocking Cognify. */
export const _ProviderRunMapSchema = z.record(z.string().uuid(), z.unknown());
