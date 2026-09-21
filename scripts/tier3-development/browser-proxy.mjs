import http from "node:http";
import https from "node:https";

const _SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const _UPGRADED_SOCKETS = new WeakMap();
const _UPSTREAM_TIMEOUT_MILLISECONDS = 15_000;

/**
 * Creates the loopback proxy with the live ingress certificate and required upstream Host.
 * It admits only coordinator-selected browser authorities before attaching the Agent credential,
 * rejects foreign origins for state changes, and discards forwarding claims before proxying.
 * @returns An unbound HTTP server; the coordinator chooses its loopback port.
 * @throws When the configured upstream is not HTTPS or has no certificate.
 */
export function createTier3BrowserProxy(options)
{
	const upstream = new URL(options.upstreamOrigin);
	if (upstream.protocol !== "https:") throw new Error("Tier 3 browser proxy requires HTTPS ingress.");
	if (!options.upstreamCertificate) throw new Error("Tier 3 browser proxy requires the ingress certificate.");
	if (!options.allowedBrowserOrigins?.length) throw new Error("Tier 3 browser proxy requires coordinator-selected browser origins.");
	const sockets = new Set();
	const server = http.createServer(function _Forward(request, response)
	{
		if (!isAllowedTier3BrowserRequest(request, options.allowedBrowserOrigins))
		{
			const rejection = {
				code: "TIER3_ORIGIN_MISMATCH",
				error: "Tier 3 requires a coordinator-selected browser authority and origin.",
			};
			response.writeHead(403, { "content-type": "application/json" });
			response.end(JSON.stringify(rejection));
			return;
		}

		const upstreamRequest = https.request(buildTier3UpstreamRequestOptions(request, upstream, options), function _Respond(upstreamResponse) { response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.statusMessage, upstreamResponse.headers); upstreamResponse.pipe(response); });
		configureTier3UpstreamTimeout(upstreamRequest, options.upstreamTimeoutMilliseconds ?? _UPSTREAM_TIMEOUT_MILLISECONDS);
		upstreamRequest.once("error", function _Unavailable(error) { if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain; charset=utf-8" }); response.end(`Tier 3 ingress is unavailable: ${error.message}\n`); });
		request.once("aborted", function _Abort() { upstreamRequest.destroy(); });
		request.pipe(upstreamRequest);
	});
	server.on("upgrade", function _Upgrade(request, socket, head)
	{
		if (!isAllowedTier3BrowserRequest(request, options.allowedBrowserOrigins))
		{
			socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
			return;
		}

		_Track(sockets, socket);
		const upstreamRequest = https.request(buildTier3UpstreamRequestOptions(request, upstream, options));
		configureTier3UpstreamTimeout(upstreamRequest, options.upstreamTimeoutMilliseconds ?? _UPSTREAM_TIMEOUT_MILLISECONDS);
		upstreamRequest.once("upgrade", function _Connected(upstreamResponse, upstreamSocket, upstreamHead) { _Track(sockets, upstreamSocket); socket.write(_UpgradeResponseHead(upstreamResponse)); if (upstreamHead.length) socket.write(upstreamHead); if (head.length) upstreamSocket.write(head); upstreamSocket.pipe(socket).pipe(upstreamSocket); });
		upstreamRequest.once("response", function _Rejected() { socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n"); });
		upstreamRequest.once("error", function _Failed() { socket.destroy(); });
		socket.once("close", function _Abort() { upstreamRequest.destroy(); });
		upstreamRequest.end();
	});
	_UPGRADED_SOCKETS.set(server, sockets);
	return server;
}

/**
 * Returns the browser origins the coordinator can prove from its own port and Codespaces identity.
 * Codespaces forwarding names come from GitHub's runtime environment, not request headers.
 * @returns The exact local origin and, in Codespaces, its exact private forwarded origin.
 * @throws When Codespaces claims lack a valid forwarding identity or domain.
 */
export function tier3BrowserOrigins(port, environment)
{
	const origins = [`http://127.0.0.1:${port}`];

	if (environment.CODESPACES !== "true") return origins;
	const name = environment.CODESPACE_NAME;
	const domain = environment.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
	const dnsLabel = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u;

	if (typeof name !== "string" || !dnsLabel.test(name) || typeof domain !== "string" || !domain.split(".").every(function _Label(label) { return dnsLabel.test(label); }))
		throw new Error("Tier 3 Codespaces forwarding requires a valid codespace name and port-forwarding domain.");
	origins.push(`https://${name}-${port}.${domain}`);
	return origins;
}

/**
 * Rejects unknown browser authorities on every request, including safe reads. A mutation needs
 * a matching Origin or Referer; a WebSocket upgrade requires its browser-generated Origin.
 * Browser-supplied forwarding headers cannot expand the set of accepted authorities.
 * @returns Whether the request may reach the certificate-pinned upstream.
 */
export function isAllowedTier3BrowserRequest(request, allowedBrowserOrigins)
{
	const expected = _BrowserOriginForRequest(request, allowedBrowserOrigins);

	if (!expected) return false;
	const origin = request.headers.origin;

	if (origin !== undefined && origin !== expected) return false;
	const upgrade = request.headers.upgrade;

	if (upgrade !== undefined && (typeof upgrade !== "string" || upgrade.toLowerCase() !== "websocket")) return false;
	const requiresOrigin = !_SAFE_METHODS.has(request.method ?? "GET") || upgrade !== undefined;

	if (!requiresOrigin) return true;
	if (upgrade !== undefined) return origin === expected;
	if (origin === expected) return true;
	const referer = request.headers.referer;

	if (typeof referer !== "string") return false;

	try { return new URL(referer).origin === expected; }
	catch { return false; }
}

/**
 * Selects one coordinator-owned origin from the direct authority or the exact Codespaces forwarding
 * authority. GitHub may retain an explicit default HTTPS port or replace Host with the loopback
 * listener, so neither representation can be compared as an unnormalised string.
 */
function _BrowserOriginForRequest(request, allowedBrowserOrigins)
{
	const host = request.headers.host;

	if (typeof host !== "string")
		return;
	const directOrigin = _OriginForAuthority(host, allowedBrowserOrigins) ?? _LoopbackOriginForAuthority(host, allowedBrowserOrigins);

	if (!directOrigin)
		return;
	if (new URL(directOrigin).hostname !== "127.0.0.1")
		return directOrigin;
	const forwardedOrigin = _ForwardedOrigin(request, allowedBrowserOrigins);

	return forwardedOrigin ?? directOrigin;
}

/** Returns the allowed origin whose normalised authority matches the supplied Host value. */
function _OriginForAuthority(authority, allowedBrowserOrigins)
{
	const origin = allowedBrowserOrigins.find(function _Matches(candidate) { return _AuthorityMatches(candidate, authority); });

	return origin;
}

/** Accepts GitHub's internal localhost authority only as an alias for the coordinator's loopback listener. */
function _LoopbackOriginForAuthority(authority, allowedBrowserOrigins)
{
	const loopbackOrigin = allowedBrowserOrigins.find(function _Loopback(origin) { return new URL(origin).hostname === "127.0.0.1"; });

	if (!loopbackOrigin)
		return;
	const expected = new URL(loopbackOrigin);
	const alias = `${expected.protocol}//localhost${expected.port ? `:${expected.port}` : ""}`;
	const matches = _AuthorityMatches(alias, authority);

	return matches ? loopbackOrigin : undefined;
}

/** Uses forwarding claims only when they select one exact origin already frozen by the coordinator. */
function _ForwardedOrigin(request, allowedBrowserOrigins)
{
	const forwardedHost = request.headers["x-forwarded-host"];
	const forwardedProtocol = request.headers["x-forwarded-proto"];

	if (typeof forwardedHost !== "string" || typeof forwardedProtocol !== "string")
		return;
	const origin = _OriginForAuthority(forwardedHost, allowedBrowserOrigins);

	if (!origin || new URL(origin).protocol !== `${forwardedProtocol}:`)
		return;

	return origin;
}

/** Compares an HTTP authority after URL parsing has removed a default port and normalised its host. */
function _AuthorityMatches(origin, authority)
{
	if (typeof authority !== "string" || /[\s/@?#]/u.test(authority))
		return false;
	const expected = new URL(origin);
	let candidate;

	try { candidate = new URL(`${expected.protocol}//${authority}`); }
	catch
	{
		return false;
	}

	return candidate.origin === expected.origin && candidate.pathname === "/" && !candidate.search && !candidate.hash;
}

/**
 * Closes the listener, ordinary connections, and upgraded sockets tracked outside Node's HTTP set.
 * The explicit socket teardown lets an interrupted or failed qualification release its local port.
 * @returns When the listener and every tracked upgraded socket have closed.
 */
export async function closeTier3BrowserProxy(server)
{
	const sockets = [...(_UPGRADED_SOCKETS.get(server) ?? [])];
	const closedSockets = sockets.map(function _Closed(socket) { return socket.destroyed ? Promise.resolve() : new Promise(function _Wait(resolve) { socket.once("close", resolve); }); });
	const closedServer = new Promise(function _Close(resolve, reject) { server.close(function _Done(error) { if (error) reject(error); else resolve(); }); });
	server.closeAllConnections();
	for (const socket of sockets) socket.destroy();
	await Promise.all([closedServer, ...closedSockets]);
}

/**
 * Builds an ingress request from coordinator-owned trust values after discarding browser-supplied
 * forwarding and development-session claims. State-changing requests keep their browser origin but
 * rewrite it to the HTTPS ingress authority that the server is configured to trust.
 * @returns HTTPS request options pinned to the live certificate, Host, and server name.
 */
export function buildTier3UpstreamRequestOptions(request, upstream, options)
{
	const headers = { ...request.headers };
	for (const name of Object.keys(headers)) if (name === "forwarded" || name.startsWith("x-forwarded-")) delete headers[name];
	delete headers["x-opencrane-development-session"];
	if (options.developmentCredential !== null) headers["x-opencrane-development-session"] = options.developmentCredential;
	headers.host = options.upstreamHost;
	headers["x-forwarded-host"] = options.upstreamHost;
	headers["x-forwarded-proto"] = "https";
	if (!_SAFE_METHODS.has(request.method ?? "GET") || request.headers.upgrade?.toLowerCase() === "websocket")
	{
		if (typeof request.headers.origin === "string") headers.origin = `https://${options.upstreamHost}`;
		if (typeof request.headers.referer === "string") headers.referer = `https://${options.upstreamHost}/`;
	}
	return { protocol: upstream.protocol, hostname: upstream.hostname, port: upstream.port, method: request.method, path: request.url, headers, servername: options.upstreamHost, ca: options.upstreamCertificate, rejectUnauthorized: true };
}

function _Track(sockets, socket) { sockets.add(socket); socket.once("close", function _Forget() { sockets.delete(socket); }); }

/**
 * Destroys an upstream request when its ingress deadline expires.
 * This prevents a stalled k3d route from retaining the local proxy indefinitely.
 */
export function configureTier3UpstreamTimeout(request, milliseconds) { request.setTimeout(milliseconds, function _Timeout() { request.destroy(new Error(`Tier 3 ingress timed out after ${milliseconds} ms.`)); }); }

function _UpgradeResponseHead(response) { const lines = [`HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}`]; for (let index = 0; index < response.rawHeaders.length; index += 2) lines.push(`${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}`); return `${lines.join("\r\n")}\r\n\r\n`; }
