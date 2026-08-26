import http from "node:http";
import https from "node:https";

/** Matches the k3d load-balancer port created by `develop-smoke.sh`. */
const _DEFAULT_UPSTREAM_ORIGIN = "https://127.0.0.1:8443";
const _UPGRADED_SOCKETS = new WeakMap();

/**
 * Creates the loopback proxy that makes the k3d ingress usable through a forwarded Codespaces port.
 *
 * The k3d ingress routes by its `.test` host, while Codespaces gives the browser an
 * `*.app.github.dev` host. This proxy keeps the browser-facing origin unchanged and replaces only
 * the upstream Host header, so the SPA, API, and WebSocket routes all cross the real ingress.
 * HTTPS requests use the supplied smoke certificate as their CA set: omitting it stops proxy
 * creation, while a different certificate fails the upstream request instead of disabling TLS
 * verification.
 *
 * Called by: `runTier3Development` after the current-silo smoke passes.
 *
 * @param {{ upstreamCertificate?: string | Buffer, upstreamOrigin?: string, upstreamHost: string }} options - Ingress listener, certificate, and smoke-derived host.
 * @returns A stopped HTTP server that the caller can bind to a loopback port.
 * @throws {Error} When an HTTPS origin has no smoke-issued certificate.
 */
export function createTier3BrowserProxy(options)
{
	const upstream = new URL(options.upstreamOrigin ?? _DEFAULT_UPSTREAM_ORIGIN);
	const upstreamHost = options.upstreamHost;
	const upstreamCertificate = options.upstreamCertificate;

	if (upstream.protocol === "https:" && !upstreamCertificate)
	{
		throw new Error("Tier 3 HTTPS ingress requires its smoke-issued certificate.");
	}

	const transport = upstream.protocol === "https:" ? https : http;
	const upgradedSockets = new Set();
	const server = http.createServer(function _forwardRequest(request, response)
	{
		const upstreamRequest = transport.request(_RequestOptions(request, upstream, upstreamHost, upstreamCertificate), function _forwardResponse(upstreamResponse)
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
		_TrackUpgradedSocket(upgradedSockets, socket);
		const upstreamRequest = transport.request(_RequestOptions(request, upstream, upstreamHost, upstreamCertificate));
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
function _RequestOptions(request, upstream, upstreamHost, upstreamCertificate)
{
	const requestOptions = {
		protocol: upstream.protocol,
		hostname: upstream.hostname,
		port: upstream.port,
		method: request.method,
		path: request.url,
		headers: {
			...request.headers,
			host: upstreamHost
		},
		servername: upstreamHost
	};

	if (upstream.protocol === "https:")
	{
		requestOptions.ca = upstreamCertificate;
	}

	return requestOptions;
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
