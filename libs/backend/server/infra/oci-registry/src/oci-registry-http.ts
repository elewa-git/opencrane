import { OciRegistryImportError } from "./oci-registry.errors";
import { OciRegistryImportErrorCodes } from "./oci-registry.types";
import type { OciRegistryClientOptions, OciRegistryContext } from "./oci-registry.types";

/** OCI Distribution repository-name grammar. */
const _REPOSITORY_PATTERN = /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)*$/u;
/** HTTP statuses outside the server-error range for which the same request may succeed later. */
const _RETRYABLE_REGISTRY_STATUSES = new Set([408, 425, 429]);

/**
 * Converts caller configuration into the fixed context used by every request.
 *
 * Called by: `__CreateOciRegistryClient` once when application composition starts.
 *
 * @param options - Registry address, repository, deadline, and optional credential.
 * @returns A checked context whose repository cannot change between imports.
 * @throws OciRegistryImportError When any fixed option is unsafe.
 */
export function _CreateOciRegistryContext(options: OciRegistryClientOptions): OciRegistryContext
{
	let baseUrl: URL;
	try { baseUrl = new URL(options.baseUrl); }
	catch { throw new OciRegistryImportError(OciRegistryImportErrorCodes.InvalidConfiguration, "Registry base URL is invalid"); }

	if (baseUrl.protocol !== "https:" || baseUrl.username.length > 0 || baseUrl.password.length > 0 || baseUrl.pathname !== "/" || baseUrl.search.length > 0 || baseUrl.hash.length > 0)
		throw new OciRegistryImportError(OciRegistryImportErrorCodes.InvalidConfiguration, "Registry base URL must be an HTTPS origin without credentials, path, query, or fragment");
	if (!_REPOSITORY_PATTERN.test(options.repository) || options.repository.length > 255)
		throw new OciRegistryImportError(OciRegistryImportErrorCodes.InvalidConfiguration, "Registry repository name is invalid");
	if (!Number.isSafeInteger(options.requestTimeoutMilliseconds) || options.requestTimeoutMilliseconds < 1_000 || options.requestTimeoutMilliseconds > 120_000)
		throw new OciRegistryImportError(OciRegistryImportErrorCodes.InvalidConfiguration, "Registry request timeout must be between 1000 and 120000 milliseconds");
	const repositoryPath = options.repository.split("/").map(encodeURIComponent).join("/");
	return { baseUrl, repositoryPath, referenceRepository: `${baseUrl.host}/${options.repository}`, requestTimeoutMilliseconds: options.requestTimeoutMilliseconds, readAuthorizationHeader: options.readAuthorizationHeader, request: options.request ?? fetch };
}

/** Builds one URL below the configured registry origin. */
export function _OciRegistryUrl(context: OciRegistryContext, path: string): URL
{
	return new URL(path, context.baseUrl);
}

/** Adds the current configured credential without exposing it to error messages. */
async function _requestHeaders(context: OciRegistryContext, operation: string, values?: Readonly<Record<string, string>>): Promise<Headers>
{
	const headers = new Headers(values);
	let authorizationHeader: string | undefined;
	try { authorizationHeader = (await context.readAuthorizationHeader?.())?.trim(); }
	catch { throw new OciRegistryImportError(OciRegistryImportErrorCodes.TransportFailed, `${operation} could not read the registry credential`); }
	if (authorizationHeader !== undefined)
	{
		if (authorizationHeader.length === 0 || /[\r\n]/u.test(authorizationHeader))
			throw new OciRegistryImportError(OciRegistryImportErrorCodes.InvalidConfiguration, "Registry authorization header is invalid");
		headers.set("Authorization", authorizationHeader);
	}
	return headers;
}

/**
 * Sends one registry request with its own deadline and credential-safe error.
 *
 * Called by: the blob and manifest upload operations in this package.
 *
 * @param context - Fixed registry connection settings.
 * @param operation - Plain operation name used in safe error messages.
 * @param url - Registry URL that must remain on the configured origin.
 * @param init - Fetch method, public headers, and optional image bytes.
 * @returns The registry response without interpreting its operation-specific status.
 * @throws OciRegistryImportError When the request changes origin, times out, or otherwise fails.
 */
export async function _OciRegistryRequest(context: OciRegistryContext, operation: string, url: URL, init: RequestInit): Promise<Response>
{
	// 1. Attach the configured credential here so no caller can send it to a different origin.
	if (url.origin !== context.baseUrl.origin)
		throw new OciRegistryImportError(OciRegistryImportErrorCodes.InvalidRegistryResponse, `${operation} returned an upload location outside the configured registry`);
	const headers = await _requestHeaders(context, operation, init.headers as Readonly<Record<string, string>> | undefined);

	// 2. Give each registry exchange its own deadline so one hung request cannot hold the workflow.
	const controller = new AbortController();
	const timer = setTimeout(function _abortRegistryRequest(): void { controller.abort(); }, context.requestTimeoutMilliseconds);

	// 3. Wrap fetch failures without including the URL, headers, or content in the error.
	try { return await context.request(url, { ...init, headers, signal: controller.signal, redirect: "manual" }); }
	catch { throw new OciRegistryImportError(OciRegistryImportErrorCodes.TransportFailed, `${operation} did not complete`); }
	finally { clearTimeout(timer); }
}

/** Rejects a response status outside one OCI Distribution operation's contract. */
export function _ExpectOciRegistryStatus(response: Response, expected: number, operation: string): void
{
	if (response.status !== expected)
	{
		if (_RETRYABLE_REGISTRY_STATUSES.has(response.status) || (response.status >= 500 && response.status <= 599))
			throw new OciRegistryImportError(OciRegistryImportErrorCodes.TransportFailed, `${operation} is temporarily unavailable`, response.status);
		throw new OciRegistryImportError(OciRegistryImportErrorCodes.InvalidRegistryResponse, `${operation} returned HTTP ${response.status}`, response.status);
	}
}

/** Returns a required OCI Distribution response header or rejects the incomplete reply. */
export function _RequireOciRegistryHeader(response: Response, name: string, operation: string): string
{
	const value = response.headers.get(name);
	if (value === null || value.trim().length === 0)
		throw new OciRegistryImportError(OciRegistryImportErrorCodes.InvalidRegistryResponse, `${operation} did not return the required ${name} header`, response.status);
	return value;
}

/** Checks a registry-provided digest when the response carries one. */
export function _CheckOciRegistryDigest(response: Response, expected: string, operation: string): void
{
	const returned = response.headers.get("Docker-Content-Digest");
	if (returned !== null && returned !== expected)
		throw new OciRegistryImportError(OciRegistryImportErrorCodes.DigestMismatch, `${operation} returned a different content digest`, response.status);
}

/** Resolves an upload session location without allowing a registry-controlled host change. */
export function _OciRegistryUploadLocation(context: OciRegistryContext, response: Response): URL
{
	const location = _RequireOciRegistryHeader(response, "Location", "Blob upload start");
	let url: URL;
	try { url = new URL(location, context.baseUrl); }
	catch { throw new OciRegistryImportError(OciRegistryImportErrorCodes.InvalidRegistryResponse, "Blob upload start returned an invalid Location header", response.status); }
	if (url.protocol !== "https:" || url.origin !== context.baseUrl.origin || url.username.length > 0 || url.password.length > 0 || url.hash.length > 0 || url.searchParams.has("digest"))
		throw new OciRegistryImportError(OciRegistryImportErrorCodes.InvalidRegistryResponse, "Blob upload start returned a location outside the configured registry", response.status);
	return url;
}
