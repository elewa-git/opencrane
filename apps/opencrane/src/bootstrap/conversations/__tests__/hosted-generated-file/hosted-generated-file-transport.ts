import { isIP, type Socket } from "node:net";
import { request } from "node:https";

import type { HostedGeneratedFileFetch, HostedGeneratedFileHttpResponse } from "./hosted-generated-file.types";

/** Build a public-origin Fetch adapter whose socket alone may use a loopback address. */
export function __CreateHostedGeneratedFileFetch(baseUrl: URL, transportAddress: string | null, fallback: HostedGeneratedFileFetch = globalThis.fetch): HostedGeneratedFileFetch
{
	if (transportAddress === null)
		return fallback;
	if (isIP(transportAddress) === 0)
		throw new Error("Hosted qualification base transport address must be one literal IP address");
	return async function _Fetch(input, init = {})
	{
		const url = new URL(input);
		if (url.origin !== baseUrl.origin)
			return fallback(url, init);
		return _RequestThroughAddress(url, transportAddress, init);
	};
}

/** Connect to one IP while preserving the original Host header and TLS server name. */
function _RequestThroughAddress(url: URL, transportAddress: string, init: RequestInit): Promise<HostedGeneratedFileHttpResponse>
{
	return new Promise(function _Start(resolve, reject)
	{
		const headers = new Headers(init.headers);
		headers.set("host", url.host);
		const signal = init.signal;
		let abort: (() => void) | null = null;
		let socket: Socket | null = null;
		const operation = request({ hostname: transportAddress, port: url.port === "" ? 443 : Number(url.port), path: `${url.pathname}${url.search}`, method: init.method ?? "GET", headers: Object.fromEntries(headers), servername: url.hostname, rejectUnauthorized: true }, function _Response(response)
		{
			const chunks: Buffer[] = [];
			response.on("data", function _Data(chunk: Buffer | string) { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); });
			response.once("error", reject);
			response.once("end", function _End()
			{
				const body = Buffer.concat(chunks);
				const responseHeaders = new Headers();
				for (const [name, value] of Object.entries(response.headers))
				{
					if (Array.isArray(value))
					{
						for (const item of value)
							responseHeaders.append(name, item);
					}
					else if (value !== undefined)
						responseHeaders.set(name, String(value));
				}
				resolve({ status: response.statusCode ?? 0, headers: responseHeaders, async arrayBuffer() { return Uint8Array.from(body).buffer; }, async json() { return JSON.parse(body.toString("utf8")) as unknown; } });
			});
		});
		operation.once("socket", function _Socket(value)
		{
			socket = value;
			if (signal?.aborted === true)
				value.destroy(new Error("Hosted qualification request aborted"));
		});
		operation.once("error", reject);
		operation.once("close", function _ReleaseAbortListener()
		{
			if (signal !== undefined && signal !== null && abort !== null)
				signal.removeEventListener("abort", abort);
		});
		if (signal !== undefined && signal !== null)
		{
			if (signal.aborted)
				operation.destroy(new Error("Hosted qualification request aborted"));
			else
			{
				abort = function _Abort()
				{
					const error = new Error("Hosted qualification request aborted");
					operation.destroy(error);
					socket?.destroy(error);
				};
				signal.addEventListener("abort", abort, { once: true });
			}
		}
		const body = _RequestBody(init.body);
		if (body !== null)
			operation.write(body);
		operation.end();
	});
}

/** Convert the two body forms used by this fixture into exact Node request bytes. */
function _RequestBody(body: BodyInit | null | undefined): Buffer | null
{
	if (body === undefined || body === null)
		return null;
	if (typeof body === "string")
		return Buffer.from(body);
	if (body instanceof ArrayBuffer)
		return Buffer.from(body);
	if (ArrayBuffer.isView(body))
		return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
	throw new Error("Hosted qualification transport received an unsupported request body");
}
