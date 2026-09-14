import type { IncomingMessage } from "node:http";

import type { ZodType } from "zod";

/** Largest body the private gateway accepts before applying an operation's narrower schema. */
const _MAX_REQUEST_BYTES = 1024 * 1024;

/** Refuses malformed request bytes before any provider operation is called. */
export class _MemoryGatewayRequestError extends Error
{
	/** Create a fixed error that cannot retain request text or parser details. */
	constructor() { super("Invalid memory gateway request"); }
}

/** Refuses a provider adapter response that cannot prove the shared receipt contract. */
export class _MemoryGatewayResponseError extends Error
{
	/** Create a fixed error without retaining provider content. */
	constructor() { super("Invalid memory gateway response"); }
}

/** Extract one bearer token; duplicate authorization headers are not accepted. */
export function _MemoryGatewayBearer(request: IncomingMessage): string | null
{
	const header = request.headers.authorization;
	const headers = request.rawHeaders.filter(function _Authorization(value, index) { return index % 2 === 0 && value.toLowerCase() === "authorization"; });
	if (headers.length !== 1 || typeof header !== "string" || !header.startsWith("Bearer "))
		return null;
	const token = header.slice("Bearer ".length).trim();
	return token.length > 0 ? token : null;
}

/** Read bounded UTF-8 JSON, or require an empty body for path-only deletion. */
export async function _ReadMemoryGatewayBody(request: IncomingMessage, pathOnly: boolean): Promise<unknown>
{
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	for await (const chunk of request)
	{
		const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
		byteLength += bytes.byteLength;
		if (byteLength > _MAX_REQUEST_BYTES || (pathOnly && byteLength > 0))
			throw new _MemoryGatewayRequestError();
		chunks.push(bytes);
	}
	if (pathOnly)
		return undefined;
	try
	{
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, byteLength))) as unknown;
	}
	catch
	{
		throw new _MemoryGatewayRequestError();
	}
}

/** Keep request shape validation beside the shared models and strip parser details from failures. */
export function _ParseMemoryGatewayRequest<T>(schema: ZodType<T>, value: unknown): T
{
	const parsed = schema.safeParse(value);
	if (!parsed.success)
		throw new _MemoryGatewayRequestError();
	return parsed.data;
}

/** Require every operation response to satisfy its shared wire contract before returning it. */
export function _ParseMemoryGatewayResponse<T>(schema: ZodType<T>, value: unknown): T
{
	const parsed = schema.safeParse(value);
	if (!parsed.success)
		throw new _MemoryGatewayResponseError();
	return parsed.data;
}
