import http from "node:http";
import https from "node:https";

import tier3DevelopmentAuthProtocol from "../libs/contracts/src/tier3-development-auth.protocol.json" with { type: "json" };

/** Matches the k3d load-balancer port created by `develop-smoke.sh`. */
const _DEFAULT_UPSTREAM_ORIGIN = "https://127.0.0.1:8443";
const _PROXY_SECRET_HEADER = tier3DevelopmentAuthProtocol.proxySecretHeader;
const _UPGRADED_SOCKETS = new WeakMap();
const _SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Creates the loopback proxy that makes the k3d ingress usable through a forwarded Codespaces port.
 *
 * The k3d ingress routes by its `.test` host, while Codespaces gives the browser an
 * `*.app.github.dev` host. This proxy validates the browser-facing origin, then presents the fixed
 * `.test` authority to the upstream SPA, API, and WebSocket routes.
 * HTTPS requests use the supplied smoke certificate as their CA set: omitting it stops proxy
 * creation, while a different certificate fails the upstream request instead of disabling TLS
 * verification.
 *
 * Called by: `runTier3Development` after the current-silo smoke passes.
 *
 * @param {{ proxySecret: string, upstreamCertificate?: string | Buffer, upstreamOrigin?: string, upstreamHost: string }} options - Ingress listener, certificate, proof, and smoke-derived host.
 * @returns A stopped HTTP server that the caller can bind to a loopback port.
 * @throws {Error} When an HTTPS origin has no smoke-issued certificate.
 */
export function createTier3BrowserProxy(options)
{
	const upstream = new URL(options.upstreamOrigin ?? _DEFAULT_UPSTREAM_ORIGIN);
	const upstreamHost = options.upstreamHost;
	const upstreamCertificate = options.upstreamCertificate;
	const proxySecret = options.proxySecret;

	if (Buffer.byteLength(proxySecret) < 32)
	{
		throw new Error("Tier 3 browser proxy requires a 32-byte proxy secret.");
	}

	if (upstream.protocol === "https:" && !upstreamCertificate)
	{
		throw new Error("Tier 3 HTTPS ingress requires its smoke-issued certificate.");
	}

	const transport = upstream.protocol === "https:" ? https : http;
	const upgradedSockets = new Set();
	const server = http.createServer(function _forwardRequest(request, response)
	{
		if (!_HasExpectedBrowserOrigin(request))
		{
			response.writeHead(403, { "content-type": "application/json" });
			response.end(JSON.stringify({ error: "Tier 3 state changes require the forwarded browser origin.", code: "TIER3_ORIGIN_MISMATCH" }));
			return;
		}

		const upstreamRequest = transport.request(_RequestOptions(request, upstream, upstreamHost, upstreamCertificate, proxySecret), function _forwardResponse(upstreamResponse)
		{
			response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.statusMessage, upstreamResponse.headers);
			upstreamResponse.pipe(response);
		});

		upstreamRequest.once("error", function _reportError(error)
		{
			if (!response.headersSent)
			{
				response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
			}

			response.end(`Tier 3 ingress is unavailable: ${error.message}\n`);
		});
		request.pipe(upstreamRequest);
	});

	server.on("upgrade", function _forwardUpgrade(request, socket, head)
	{
		if (!_HasExpectedBrowserOrigin(request))
		{
			socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
			return;
		}
		_TrackUpgradedSocket(upgradedSockets, socket);
		const upstreamRequest = transport.request(_RequestOptions(request, upstream, upstreamHost, upstreamCertificate, proxySecret));
		socket.once("close", function _abortHandshake() { upstreamRequest.destroy(); });
		upstreamRequest.once("upgrade", function _connected(upstreamResponse, upstreamSocket, upstreamHead)
		{
			_TrackUpgradedSocket(upgradedSockets, upstreamSocket);
			socket.write(_UpgradeResponseHead(upstreamResponse));

			if (upstreamHead.length)
			{
				socket.write(upstreamHead);
			}

			if (head.length)
			{
				upstreamSocket.write(head);
			}

			upstreamSocket.pipe(socket).pipe(upstreamSocket);
		});
		upstreamRequest.once("response", function _rejectUpgrade()
		{
			socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
		});
		upstreamRequest.once("error", function _closeSocket()
		{
			socket.destroy();
		});
		upstreamRequest.end();
	});
	_UPGRADED_SOCKETS.set(server, upgradedSockets);

	return server;
}

/**
 * Stops new proxy traffic and destroys WebSocket connections that Node no longer tracks as HTTP.
 *
 * Called by: the Tier 3 signal handler after a developer ends an interactive session.
 *
 * @param {import("node:http").Server} server - Browser proxy returned by `createTier3BrowserProxy`.
 * @returns {Promise<void>} Resolves after the listener and every upgraded socket have closed.
 */
export async function closeTier3BrowserProxy(server)
{
	const upgradedSockets = [...(_UPGRADED_SOCKETS.get(server) ?? [])];
	const socketClosures = upgradedSockets.map(function _waitForSocket(socket)
	{
		if (socket.destroyed)
		{
			return Promise.resolve();
		}

		return new Promise(function _wait(resolve) { socket.once("close", resolve); });
	});
	const listenerClosure = new Promise(function _close(resolve, reject)
	{
		server.close(function _closed(error)
		{
			if (error)
			{
				reject(error);
				return;
			}

			resolve();
		});
	});
	server.closeAllConnections();

	for (const socket of upgradedSockets)
	{
		socket.destroy();
	}

	await Promise.all([listenerClosure, ...socketClosures]);
}

/** Keeps shutdown ownership for a socket after HTTP hands it to the WebSocket tunnel. */
function _TrackUpgradedSocket(sockets, socket)
{
	sockets.add(socket);
	socket.once("close", function _forget() { sockets.delete(socket); });
}

/** Applies the routing and trust inputs validated by `createTier3BrowserProxy`. */
function _RequestOptions(request, upstream, upstreamHost, upstreamCertificate, proxySecret)
{
	const headers = {
		...request.headers,
		host: upstreamHost,
		"x-forwarded-host": upstreamHost,
		"x-forwarded-proto": "https"
	};
	delete headers[_PROXY_SECRET_HEADER];
	if (_RequiresProxyProof(request))
	{
		headers[_PROXY_SECRET_HEADER] = proxySecret;
	}
	if (!_SAFE_METHODS.has(request.method ?? "GET") || request.headers.upgrade?.toLowerCase() === "websocket")
	{
		if (typeof request.headers.origin === "string") headers.origin = `https://${upstreamHost}`;
		if (typeof request.headers.referer === "string") headers.referer = `https://${upstreamHost}/`;
	}
	const requestOptions = {
		protocol: upstream.protocol,
		hostname: upstream.hostname,
		port: upstream.port,
		method: request.method,
		path: request.url,
		headers,
		servername: upstreamHost
	};
	if (upstream.protocol === "https:")
	{
		requestOptions.ca = upstreamCertificate;
	}

	return requestOptions;
}

/** Adds the run proof only to the two exact login endpoints that consume it. */
function _RequiresProxyProof(request)
{
	if (request.method !== "GET")
	{
		return false;
	}
	const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
	return pathname === "/api/v1/auth/login" || pathname === "/api/v1/auth/reauthenticate";
}

/** Accepts safe reads and same-origin browser mutations before the proxy adds its server proof. */
function _HasExpectedBrowserOrigin(request)
{
	if (_SAFE_METHODS.has(request.method ?? "GET") && request.headers.upgrade?.toLowerCase() !== "websocket")
	{
		return true;
	}
	const host = request.headers.host;
	if (!host)
	{
		return false;
	}
	const forwardedProtocol = request.headers["x-forwarded-proto"];
	const protocol = typeof forwardedProtocol === "string" ? forwardedProtocol.split(",")[0].trim() : "http";
	const expectedOrigin = `${protocol}://${host}`;
	const origin = request.headers.origin;
	if (typeof origin === "string")
	{
		return origin === expectedOrigin;
	}
	const referer = request.headers.referer;
	if (typeof referer !== "string")
	{
		return false;
	}
	try
	{
		return new URL(referer).origin === expectedOrigin;
	}
	catch
	{
		return false;
	}
}

/** Replays the accepted upstream upgrade response before joining both sockets. */
function _UpgradeResponseHead(response)
{
	const lines = [`HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}`];

	for (let index = 0; index < response.rawHeaders.length; index += 2)
	{
		lines.push(`${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}`);
	}

	return `${lines.join("\r\n")}\r\n\r\n`;
}
