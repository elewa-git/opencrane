import type { McpCompanionFetch } from "./mcp-companion.types";

/** Serialize JSON and reject a body before fetch can send more than the configured byte ceiling. */
export function _BoundedJsonBody(value: unknown, maximumBytes: number): string
{
	const body = JSON.stringify(value);
	if (Buffer.byteLength(body, "utf8") > maximumBytes)
		throw new Error("JSON request exceeded its byte limit");
	return body;
}

/** Read one response body without buffering beyond the caller's byte ceiling. */
export async function _ReadBoundedJson(response: Response, maximumBytes: number): Promise<unknown>
{
	const declaredLength = response.headers.get("content-length");
	if (declaredLength !== null && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maximumBytes))
		throw new Error("JSON response exceeded its byte limit");
	if (response.body === null)
		throw new Error("JSON response body was missing");
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	try
	{
		while (true)
		{
			const next = await reader.read();
			if (next.done)
				break;
			byteLength += next.value.byteLength;
			if (byteLength > maximumBytes)
				throw new Error("JSON response exceeded its byte limit");
			chunks.push(next.value);
		}
	}
	catch (err)
	{
		await reader.cancel().catch(function _IgnoreCancelFailure(): void { return; });
		throw err;
	}
	const body = Buffer.concat(chunks, byteLength).toString("utf8");
	try
	{
		return JSON.parse(body) as unknown;
	}
	catch
	{
		throw new Error("JSON response was invalid");
	}
}

/** Send one bounded JSON request with an abort-aware deadline. */
export async function _FetchJson(fetcher: McpCompanionFetch, url: string, init: RequestInit, timeoutMilliseconds: number, signal: AbortSignal): Promise<Response>
{
	return fetcher(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMilliseconds)]) });
}
