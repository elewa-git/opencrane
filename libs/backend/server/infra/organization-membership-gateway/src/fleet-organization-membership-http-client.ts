import { readFile } from "node:fs/promises";

import { ___DoWithTrace } from "@opencrane/backend/observability";

import type { FleetOrganizationMembershipFetch, FleetOrganizationMembershipHttpClientConfig, FleetOrganizationMembershipHttpRequest, FleetOrganizationMembershipHttpResponse } from "./fleet-organization-membership-http-client.types";

/** Largest Fleet response admitted across the server transport boundary. */
const _MAXIMUM_RESPONSE_BYTES = 1_048_576;

/** Refuses an origin that could redirect or disclose a projected credential. */
function _FleetOrigin(value: string): URL
{
	const origin = new URL(value);
	if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash)
	{
		throw new Error("Fleet membership gateway must be one credential-free HTTPS origin");
	}
	return origin;
}

/** Reads one bounded JSON body without exposing remote text through an exception. */
async function _ResponseJson(response: Response): Promise<unknown>
{
	const contentLength = Number(response.headers.get("content-length") ?? "0");
	if (Number.isFinite(contentLength) && contentLength > _MAXIMUM_RESPONSE_BYTES) throw new Error("Fleet membership response exceeded the size limit");
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.byteLength > _MAXIMUM_RESPONSE_BYTES) throw new Error("Fleet membership response exceeded the size limit");
	try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; }
	catch { throw new Error("Fleet membership response was not valid JSON"); }
}

/**
 * Sends bounded Fleet membership exchanges with a rotating projected ServiceAccount token.
 *
 * The receiver must TokenReview the configured audience and bind the reviewed ServiceAccount to
 * `credentialSiloId` before trusting the forwarded OIDC subject. Redirects are refused so the
 * credential cannot cross origins, and every call re-reads the projected file for kubelet rotation.
 *
 * Called by: apps/opencrane/src/app/organization-members-composition.ts.
 */
export class FleetOrganizationMembershipHttpClient
{
	/** Frozen receiver origin without path, query, or credentials. */
	private readonly origin: URL;
	/** Frozen deployment settings and test seams. */
	private readonly config: FleetOrganizationMembershipHttpClientConfig;
	/** Fetch implementation fixed at construction. */
	private readonly fetch: FleetOrganizationMembershipFetch;
	/** Token reader fixed at construction. */
	private readonly readProjectedToken: () => Promise<string>;

	/** @param config - HTTPS receiver, silo binding, rotating token path, timeout, and test seams. */
	constructor(config: FleetOrganizationMembershipHttpClientConfig)
	{
		if (!Number.isSafeInteger(config.timeoutMilliseconds) || config.timeoutMilliseconds < 1_000 || config.timeoutMilliseconds > 60_000) throw new Error("Fleet membership gateway requires a 1-60s request timeout");
		if (!config.projectedTokenPath.startsWith("/")) throw new Error("Fleet membership projected-token path must be absolute");
		if (!config.credentialSiloId.trim()) throw new Error("Fleet membership gateway silo id is required");
		this.origin = _FleetOrigin(config.baseUrl);
		this.config = config;
		this.fetch = config.fetch ?? fetch;
		this.readProjectedToken = config.readProjectedToken ?? async function _ReadToken() { return readFile(config.projectedTokenPath, "utf8"); };
	}

	/**
	 * Sends one request with a freshly read projected token and refuses redirects or oversized bodies.
	 * @param request - Server-derived Fleet path, caller evidence, and optional command body.
	 * @returns Fleet status plus parsed but still untrusted JSON.
	 * @throws When the silo binding, credential, network exchange, redirect policy, or response limit fails.
	 */
	async request(request: FleetOrganizationMembershipHttpRequest): Promise<FleetOrganizationMembershipHttpResponse>
	{
		if (request.identity.siloId !== this.config.credentialSiloId) throw new Error("Fleet membership workload identity does not belong to this silo");
		return ___DoWithTrace("fleet.organization_members.http", { siloId: request.identity.siloId, method: request.method }, async () =>
		{
			const token = (await this.readProjectedToken()).trim();
			if (!token) throw new Error("Fleet membership projected token is empty");
			const headers: Record<string, string> = {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				"X-OpenCrane-Silo-Id": request.identity.siloId,
				"X-OpenCrane-Subject-Id": request.identity.subjectId,
				"X-OpenCrane-Display-Name": request.identity.displayName,
			};
			if (request.identity.verifiedEmail !== null) headers["X-OpenCrane-Verified-Email"] = request.identity.verifiedEmail;
			if (request.idempotencyKey !== undefined) headers["Idempotency-Key"] = request.idempotencyKey;
			const response = await this.fetch(new URL(request.path, this.origin), {
				method: request.method,
				headers,
				redirect: "error",
				...(request.body === undefined || request.method === "GET" ? {} : { body: JSON.stringify(request.body) }),
				signal: AbortSignal.timeout(this.config.timeoutMilliseconds),
			});
			return { status: response.status, body: await _ResponseJson(response) };
		});
	}
}
