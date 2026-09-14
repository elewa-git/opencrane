import http from "node:http";
import https from "node:https";

const _SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const _UPGRADED_SOCKETS = new WeakMap();
const _UPSTREAM_TIMEOUT_MILLISECONDS = 15_000;

/** Create the loopback proxy that preserves the current k3d ingress Host and pinned TLS trust. */
export function createTier3BrowserProxy(options)
{
	const upstream = new URL(options.upstreamOrigin);
	if (upstream.protocol !== "https:") throw new Error("Tier 3 browser proxy requires HTTPS ingress.");
	if (!options.upstreamCertificate) throw new Error("Tier 3 browser proxy requires the ingress certificate.");
	const sockets = new Set();
	const server = http.createServer(function _Forward(request, response)
	{
		if (!_HasExpectedBrowserOrigin(request)) { response.writeHead(403, { "content-type": "application/json" }); response.end(JSON.stringify({ code: "TIER3_ORIGIN_MISMATCH", error: "Tier 3 state changes require the forwarded browser origin." })); return; }
		const upstreamRequest = https.request(buildTier3UpstreamRequestOptions(request, upstream, options), function _Respond(upstreamResponse) { response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.statusMessage, upstreamResponse.headers); upstreamResponse.pipe(response); });
		configureTier3UpstreamTimeout(upstreamRequest, options.upstreamTimeoutMilliseconds ?? _UPSTREAM_TIMEOUT_MILLISECONDS);
		upstreamRequest.once("error", function _Unavailable(error) { if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain; charset=utf-8" }); response.end(`Tier 3 ingress is unavailable: ${error.message}\n`); });
		request.once("aborted", function _Abort() { upstreamRequest.destroy(); });
		request.pipe(upstreamRequest);
	});
	server.on("upgrade", function _Upgrade(request, socket, head)
	{
		if (!_HasExpectedBrowserOrigin(request)) { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return; }
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

/** Close the listener and upgraded sockets retained outside Node's HTTP connection set. */
export async function closeTier3BrowserProxy(server)
{
	const sockets = [...(_UPGRADED_SOCKETS.get(server) ?? [])];
	const closedSockets = sockets.map(function _Closed(socket) { return socket.destroyed ? Promise.resolve() : new Promise(function _Wait(resolve) { socket.once("close", resolve); }); });
	const closedServer = new Promise(function _Close(resolve, reject) { server.close(function _Done(error) { if (error) reject(error); else resolve(); }); });
	server.closeAllConnections();
	for (const socket of sockets) socket.destroy();
	await Promise.all([closedServer, ...closedSockets]);
}

/** Build the pinned ingress request while discarding browser-supplied forwarding claims. */
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

function _HasExpectedBrowserOrigin(request)
{
	if (_SAFE_METHODS.has(request.method ?? "GET") && request.headers.upgrade?.toLowerCase() !== "websocket") return true;
	const host = request.headers.host;
	if (!host) return false;
	const forwarded = request.headers["x-forwarded-proto"];
	const protocol = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "http";
	const expected = `${protocol}://${host}`;
	if (typeof request.headers.origin === "string") return request.headers.origin === expected;
	if (typeof request.headers.referer !== "string") return false;
	try { return new URL(request.headers.referer).origin === expected; }
	catch { return false; }
}

function _Track(sockets, socket) { sockets.add(socket); socket.once("close", function _Forget() { sockets.delete(socket); }); }

/** Bound one upstream ingress request so a stalled k3d route cannot retain the local proxy. */
export function configureTier3UpstreamTimeout(request, milliseconds) { request.setTimeout(milliseconds, function _Timeout() { request.destroy(new Error(`Tier 3 ingress timed out after ${milliseconds} ms.`)); }); }

function _UpgradeResponseHead(response) { const lines = [`HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}`]; for (let index = 0; index < response.rawHeaders.length; index += 2) lines.push(`${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}`); return `${lines.join("\r\n")}\r\n\r\n`; }
