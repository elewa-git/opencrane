const _SESSION_HEADER = "x-opencrane-development-session";
const _REQUEST_TIMEOUT_MILLISECONDS = 15_000;

/**
 * Builds the request boundary used by the Tier 3 product journey.
 * Mutations carry the loopback origin, every request carries the generated development credential,
 * and the same deadline covers both the response headers and body.
 * @returns A JSON request function that rejects unexpected statuses and expired deadlines.
 */
export function createTier3AgentRequest(origin, credential, fetchImplementation, requestTimeoutMilliseconds = _REQUEST_TIMEOUT_MILLISECONDS)
{
	return async function _Request(method, path, body, acceptedStatuses = new Set([200, 201, 202]), maximumDurationMilliseconds = requestTimeoutMilliseconds)
	{
		const headers = { [_SESSION_HEADER]: credential };
		const controller = new AbortController();
		const timeoutMilliseconds = Math.min(requestTimeoutMilliseconds, maximumDurationMilliseconds);
		const timeout = setTimeout(function _Abort() { controller.abort(); }, timeoutMilliseconds);
		const options = { method, headers, signal: controller.signal };
		if (body !== undefined)
		{
			headers["content-type"] = "application/json";
			headers.origin = origin;
			options.body = JSON.stringify(body);
		}
		try
		{
			const response = await fetchImplementation(new URL(path, origin), options);
			const text = await response.text();
			let parsed = null;
			if (text)
			{
				try { parsed = JSON.parse(text); }
				catch { throw new Error(`Tier 3 request ${method} ${path} returned non-JSON content.`); }
			}
			if (!acceptedStatuses.has(response.status))
				throw new Error(`Tier 3 request ${method} ${path} failed with HTTP ${response.status}${typeof parsed?.code === "string" ? ` (${parsed.code})` : ""}.`);
			return { status: response.status, body: parsed };
		}
		catch (error)
		{
			if (controller.signal.aborted)
				throw new Error(`Tier 3 request ${method} ${path} timed out after ${timeoutMilliseconds} ms.`, { cause: error });
			throw error;
		}
		finally { clearTimeout(timeout); }
	};
}
