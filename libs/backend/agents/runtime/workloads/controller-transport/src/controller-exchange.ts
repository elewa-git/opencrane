import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { ___ParseAndValidateJson } from "@opencrane/util";

import type { ControllerExchange, ControllerExchangeFetch, ControllerExchangeOptions, ControllerExchangeRequest, ControllerTokenReader } from "./controller-exchange.types";

/** Bound one controller-only response before an adapter parses it. */
const _MAX_RESPONSE_BYTES = 16 * 1024;

/** Read a rotating projected token without retaining it in process state. */
function _CreateTokenReader(path: string): ControllerTokenReader
{
	return async function _ReadToken(): Promise<string>
	{
		const token = (await readFile(path, "utf8")).trim();
		if (token.length === 0)
		{
			throw new Error("projected agent-controller token is empty");
		}
		return token;
	};
}

/** Require one bounded Kubernetes DNS label used to construct the trusted server hostname. */
function _KubernetesName(value: string, name: string): string
{
	if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/u.test(value) || value.length > 63)
	{
		throw new Error(`${name} must be one Kubernetes DNS label`);
	}
	return value;
}

/** Require the exact in-cluster server origin before the exchange reads a controller token. */
function _BaseUrl(value: string, serverServiceName: string, serverNamespace: string): URL
{
	const parsed = URL.parse(value);
	const expectedHostname = `${_KubernetesName(serverServiceName, "serverServiceName")}.${_KubernetesName(serverNamespace, "serverNamespace")}.svc.cluster.local`;
	if (!parsed || parsed.protocol !== "http:" || parsed.hostname !== expectedHostname || parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "" || parsed.username !== "" || parsed.password !== "")
	{
		throw new Error("OPENCRANE_INTERNAL_URL must be one in-cluster HTTP origin with no path or credentials");
	}
	return parsed;
}

/** Build headers for an authenticated JSON exchange. */
function _Headers(token: string): Headers
{
	return new Headers({ authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" });
}

/** Create a request signal that ends with either process shutdown or the explicit timeout. */
function _RequestSignal(shutdownSignal: AbortSignal | undefined, timeoutMilliseconds: number): AbortSignal
{
	return shutdownSignal === undefined
		? AbortSignal.timeout(timeoutMilliseconds)
		: AbortSignal.any([shutdownSignal, AbortSignal.timeout(timeoutMilliseconds)]);
}

/** Read and bound one server response before decoding its JSON. */
async function _ReadBoundedText(response: Response, domainLabel: string): Promise<string>
{
	const declaredLength = response.headers.get("content-length");
	if (declaredLength !== null)
	{
		const parsedLength = Number(declaredLength);
		if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > _MAX_RESPONSE_BYTES)
		{
			await response.body?.cancel();
			throw new Error(`OpenCrane ${domainLabel} response exceeded the 16 KiB boundary`);
		}
	}
	if (response.body === null)
	{
		throw new Error(`OpenCrane ${domainLabel} authority returned no response body`);
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	while (true)
	{
		const result = await reader.read();
		if (result.done)
		{
			return Buffer.concat(chunks, byteLength).toString("utf8");
		}
		byteLength += result.value.byteLength;
		if (byteLength > _MAX_RESPONSE_BYTES)
		{
			await reader.cancel();
			throw new Error(`OpenCrane ${domainLabel} response exceeded the 16 KiB boundary`);
		}
		chunks.push(result.value);
	}
}

/**
 * Require one bounded route identity before it is placed in an internal URL.
 *
 * Called by: controller HTTP authorities before they build a private route path.
 *
 * @param value - Caller-supplied identity destined for one URL segment.
 * @param name - Reader-facing identity name used in the refusal message.
 * @returns The accepted identity, unchanged.
 * @throws Error when the identity is empty or longer than 128 characters.
 */
export function __RequireControllerRouteId(value: string, name: string): string
{
	if (value.length === 0 || value.length > 128)
	{
		throw new Error(`controller authority requires one valid ${name}`);
	}
	return value;
}

/**
 * Create one authenticated controller-to-server JSON exchange over the private in-cluster origin.
 *
 * Every request re-reads the rotating projected token, pins the exact in-cluster server origin,
 * bounds the response to 16 KiB, and validates the body through the caller's strict parser. A 409
 * becomes the caller's conflict sentinel so a stale delivery cannot continue; any other non-200
 * status throws.
 *
 * Called by: the skill-authoring, artifact-preprocessing, and AgentRun workflow controller HTTP
 * authorities.
 *
 * @param domainLabel - Reader-facing domain name used in transport error messages.
 * @param options - Same-silo origin, projected-token path, request timeout, and test seams.
 * @returns The exchange each controller authority wraps with its own routes and validators.
 * @throws Error when the configured origin, token path, or timeout cannot meet the private-route boundary.
 * @see ControllerExchangeRequest for per-request conflict and validation handling.
 */
export function __CreateControllerExchange(domainLabel: string, options: ControllerExchangeOptions): ControllerExchange
{
	const baseUrl = _BaseUrl(options.openCraneInternalUrl, options.serverServiceName, options.serverNamespace);
	if (!isAbsolute(options.tokenPath) || !Number.isSafeInteger(options.requestTimeoutMilliseconds) || options.requestTimeoutMilliseconds < 1_000 || options.requestTimeoutMilliseconds > 60_000)
	{
		throw new Error(`${domainLabel} HTTP authority requires an absolute token path and 1-60s timeout`);
	}
	const fetchRequest: ControllerExchangeFetch = options.fetch ?? fetch;
	const readToken = options.readToken ?? _CreateTokenReader(options.tokenPath);

	return {
		async exchange<TSuccess, TConflict = never>(request: ControllerExchangeRequest<TSuccess, TConflict>): Promise<TSuccess | TConflict>
		{
			const response = await fetchRequest(new URL(request.path, baseUrl), { method: request.method, headers: _Headers(await readToken()), body: JSON.stringify(request.body), signal: _RequestSignal(options.shutdownSignal, options.requestTimeoutMilliseconds) });
			if (response.status === 409 && "conflict" in request)
			{
				return request.conflict as TConflict;
			}
			if (response.status === 204 && "noContent" in request)
			{
				return request.noContent as TSuccess;
			}
			if (response.status !== 200)
			{
				throw new Error(`OpenCrane ${request.failure} failed with HTTP ${response.status}`);
			}
			return ___ParseAndValidateJson(await _ReadBoundedText(response, domainLabel), `OpenCrane ${domainLabel} response`, request.parse);
		},
	};
}
