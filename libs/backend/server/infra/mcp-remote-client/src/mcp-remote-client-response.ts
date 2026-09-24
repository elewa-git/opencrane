import type { IncomingMessage } from "node:http";

import { McpResponseDecoder } from "@opencrane/contracts";

import { McpRemoteProtocolError, McpRemoteTransportError } from "./mcp-remote-client.errors";
import { McpRemoteDeliveryStates, type McpRemoteProtocolFailureCodes } from "./mcp-remote-client.types";

/** Read bounded bytes and close an SSE connection after its matching response arrives. */
export function _ReadMcpRemoteResponse(response: IncomingMessage, requestId: string, maximumResponseBytes: number, malformedResponseCode: McpRemoteProtocolFailureCodes): Promise<Uint8Array>
{
	return new Promise(function _ReadResponse(resolve, reject)
	{
		const chunks: Buffer[] = [];
		let byteLength = 0;
		let settled = false;
		let decoder: McpResponseDecoder;

		/** Settle once before destroying the socket; destruction may emit another event. */
		function _Fail(error: unknown): void
		{
			if (settled)
				return;
			settled = true;
			reject(error);
			response.destroy();
		}

		/** Preserve bytes through the matched response, then release the connection. */
		function _Complete(): void
		{
			if (settled)
				return;
			settled = true;
			resolve(Buffer.concat(chunks, byteLength));
			response.destroy();
		}

		const declaredLength = Number(response.headers["content-length"] ?? "0");
		if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > maximumResponseBytes)
		{
			_Fail(new McpRemoteTransportError("oversize", McpRemoteDeliveryStates.MaybeDispatched));
			return;
		}
		try { decoder = new McpResponseDecoder(response.headers["content-type"], requestId, maximumResponseBytes); }
		catch { _Fail(new McpRemoteProtocolError(malformedResponseCode)); return; }

		response.on("data", function _Receive(chunk: Buffer)
		{
			if (settled)
				return;
			byteLength += chunk.byteLength;
			if (byteLength > maximumResponseBytes)
			{
				_Fail(new McpRemoteTransportError("oversize", McpRemoteDeliveryStates.MaybeDispatched));
				return;
			}
			chunks.push(chunk);
			try
			{
				if (decoder.push(chunk) !== undefined)
					_Complete();
			}
			catch { _Fail(new McpRemoteProtocolError(malformedResponseCode)); }
		});
		response.once("error", function _ResponseError() { _Fail(new McpRemoteTransportError("network", McpRemoteDeliveryStates.MaybeDispatched)); });
		response.once("end", function _End()
		{
			if (settled)
				return;
			try { decoder.finish(); _Complete(); }
			catch { _Fail(new McpRemoteProtocolError(malformedResponseCode)); }
		});
		response.once("close", function _Closed()
		{
			if (!settled)
				_Fail(new McpRemoteTransportError("network", McpRemoteDeliveryStates.MaybeDispatched));
		});
	});
}
