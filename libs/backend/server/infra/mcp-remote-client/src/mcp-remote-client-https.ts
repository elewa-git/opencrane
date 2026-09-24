import { request as _httpsRequest } from "node:https";

import { McpRemoteConfigurationError, McpRemoteProtocolError, McpRemoteTransportError } from "./mcp-remote-client.errors";
import { _ReadMcpRemoteResponse } from "./mcp-remote-client-response";
import { McpRemoteDeliveryStates, type McpRemoteHttpsRequestCommand, type McpRemoteHttpsResponse } from "./mcp-remote-client.types";

/** Normalize Node response headers without exposing array-valued headers. */
function _ResponseHeaders(headers: import("node:http").IncomingHttpHeaders): Record<string, string | undefined>
{
	const normalized: Record<string, string | undefined> = {};
	for (const [name, value] of Object.entries(headers))
		normalized[name] = Array.isArray(value) ? value.join(",") : value;
	return normalized;
}

/** Send one HTTPS request while binding the socket to its reviewed DNS address. */
export async function _McpRemoteHttpsRequest(command: McpRemoteHttpsRequestCommand): Promise<McpRemoteHttpsResponse>
{
	return new Promise(function _Send(resolve, reject)
	{
		const request = _httpsRequest(command.endpoint, {
			method: "POST",
			headers: command.headers,
			signal: command.signal,
			family: command.resolvedAddress.family,
			lookup: function _UseReviewedAddress(_hostname, _options, callback) { callback(null, command.resolvedAddress.address, command.resolvedAddress.family); },
		}, async function _Receive(response)
		{
			const status = response.statusCode;
			if (status === undefined)
			{
				response.destroy();
				reject(new McpRemoteTransportError("network", McpRemoteDeliveryStates.MaybeDispatched));
				return;
			}
			if (status >= 300 && status < 400)
			{
				response.destroy();
				reject(new McpRemoteTransportError("redirect", McpRemoteDeliveryStates.MaybeDispatched));
				return;
			}
			if (status < 200 || status >= 300)
			{
				response.destroy();
				reject(new McpRemoteTransportError(`http_${status}`, McpRemoteDeliveryStates.MaybeDispatched));
				return;
			}
			try
			{
				const body = await _ReadMcpRemoteResponse(response, command.requestId, command.maximumResponseBytes, command.malformedResponseCode);
				resolve({ status, headers: _ResponseHeaders(response.headers), body });
			}
			catch (error) { reject(error); }
		});
		request.setTimeout(command.timeoutMilliseconds, function _Timeout() { request.destroy(new McpRemoteTransportError("timeout", McpRemoteDeliveryStates.MaybeDispatched)); });
		request.once("error", function _Fail(error)
		{
			if (error instanceof McpRemoteTransportError)
				reject(error);
			else
				reject(new McpRemoteTransportError("network", McpRemoteDeliveryStates.MaybeDispatched));
		});
		request.end(command.body);
	});
}

/** Normalize resolver, socket, deadline, and cancellation failures into bounded errors. */
export function _McpRemoteFailure(error: unknown, delivery: McpRemoteDeliveryStates): never
{
	if (error instanceof McpRemoteConfigurationError || error instanceof McpRemoteTransportError || error instanceof McpRemoteProtocolError)
		throw error;
	if (error instanceof Error && error.name === "AbortError")
		throw new McpRemoteTransportError("aborted", delivery);
	if (error instanceof Error && error.name === "TimeoutError")
		throw new McpRemoteTransportError("timeout", delivery);
	throw new McpRemoteTransportError("network", delivery);
}

/** Apply one wall-clock deadline and caller cancellation to DNS, connection, and response reading. */
export async function _McpRemoteWithDeadline<Result>(milliseconds: number, externalSignal: AbortSignal, operation: (signal: AbortSignal, markDispatched: () => void) => Promise<Result>): Promise<Result>
{
	if (externalSignal.aborted)
		throw new McpRemoteTransportError("aborted", McpRemoteDeliveryStates.ProvenNotDispatched);
	const controller = new AbortController();
	let dispatched = false;
	let timeout: ReturnType<typeof setTimeout> | undefined;
	let removeAbort: (() => void) | undefined;
	const interrupted = new Promise<never>(function _Interrupted(_resolve, reject)
	{
		/** Abort the socket and classify the failure from the last completed step. */
		function _Abort(code: "aborted" | "timeout"): void
		{
			controller.abort();
			const delivery = dispatched ? McpRemoteDeliveryStates.MaybeDispatched : McpRemoteDeliveryStates.ProvenNotDispatched;
			reject(new McpRemoteTransportError(code, delivery));
		}
		const onAbort = function _ExternalAbort() { _Abort("aborted"); };
		externalSignal.addEventListener("abort", onAbort, { once: true });
		removeAbort = function _RemoveAbort() { externalSignal.removeEventListener("abort", onAbort); };
		timeout = setTimeout(function _Timeout() { _Abort("timeout"); }, milliseconds);
		timeout.unref();
	});
	try
	{
		return await Promise.race([operation(controller.signal, function _MarkDispatched() { dispatched = true; }), interrupted]);
	}
	finally
	{
		if (timeout !== undefined)
			clearTimeout(timeout);
		removeAbort?.();
	}
}
