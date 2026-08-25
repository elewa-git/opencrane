import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import test from "node:test";

import { closeTier3BrowserProxy, createTier3BrowserProxy } from "../tier3-browser-proxy.mjs";
import { createTier3SessionConfiguration, parseTier3Arguments } from "../tier3-development-options.mjs";
import { runTier3Development } from "../tier3-development.mjs";

test("Tier 3 defaults to full storage qualification and the Codespaces proxy", function _defaults()
{
	assert.deepEqual(parseTier3Arguments([]), {
		help: false,
		proxyPort: 4200,
		smokeOnly: false,
		storageMode: "full"
	});
});

test("Tier 3 accepts the documented fast and smoke-only overrides", function _overrides()
{
	assert.deepEqual(parseTier3Arguments(["--storage-mode", "fast", "--proxy-port", "4300", "--smoke-only"]), {
		help: false,
		proxyPort: 4300,
		smokeOnly: true,
		storageMode: "fast"
	});
});

test("Tier 3 rejects ambiguous storage and port values", function _rejectsInvalidValues()
{
	assert.throws(function _storage() { parseTier3Arguments(["--storage-mode", "other"]); }, /must be 'fast' or 'full'/u);
	assert.throws(function _port() { parseTier3Arguments(["--proxy-port", "80"]); }, /1024 through 65535/u);
	assert.throws(function _unknown() { parseTier3Arguments(["--reuse"]); }, /Unknown Tier 3 option/u);
});

test("Tier 3 always keeps the smoke cluster and applies the selected storage mode", function _keepsCluster()
{
	assert.deepEqual(createTier3SessionConfiguration({
		BASE_DOMAIN: "local.test",
		CLUSTER_TENANT: "qa",
		KEEP_CLUSTER: "0",
		PATH: "/usr/bin"
	}, "fast"), {
		smokeEnvironment: {
			BASE_DOMAIN: "local.test",
			CLUSTER_TENANT: "qa",
			KEEP_CLUSTER: "1",
			PATH: "/usr/bin",
			SMOKE_STORAGE_MODE: "fast"
		},
		upstreamHost: "qa.local.test"
	});
});

test("Tier 3 qualifies smoke before it starts and waits on the matching ingress proxy", async function _ordersSession()
{
	const events = [];
	const server = {};
	await runTier3Development({ proxyPort: 4300, smokeOnly: false, storageMode: "fast" }, {
		createProxy(options)
		{
			events.push(["create-proxy", options.upstreamHost]);
			return server;
		},
		listenProxy(receivedServer, port)
		{
			events.push(["listen", receivedServer, port]);
		},
		parentEnvironment: {},
		runSmoke(environment)
		{
			events.push(["smoke", environment.KEEP_CLUSTER, environment.SMOKE_STORAGE_MODE]);
		},
		waitForShutdown(receivedServer)
		{
			events.push(["wait", receivedServer]);
		},
		writeOutput() {}
	});

	assert.deepEqual(events, [
		["smoke", "1", "fast"],
		["create-proxy", "smoke.develop-smoke.opencrane.test"],
		["listen", server, 4300],
		["wait", server]
	]);
});

test("Tier 3 smoke-only sessions do not create a browser proxy", async function _skipsProxy()
{
	let smokeRuns = 0;
	await runTier3Development({ proxyPort: 4200, smokeOnly: true, storageMode: "full" }, {
		createProxy()
		{
			assert.fail("smoke-only must not create a proxy");
		},
		runSmoke()
		{
			smokeRuns += 1;
		}
	});
	assert.equal(smokeRuns, 1);
});

test("the browser proxy replaces only the ingress routing host", async function _proxiesIngress()
{
	const received = {};
	const upstream = http.createServer(function _capture(request, response)
	{
		received.host = request.headers.host;
		received.path = request.url;
		received.forwardedHost = request.headers["x-forwarded-host"];
		response.writeHead(200, { "content-type": "application/json" });
		response.end(JSON.stringify({ ok: true }));
	});
	await _Listen(upstream);
	const upstreamAddress = upstream.address();
	const proxy = createTier3BrowserProxy({
		upstreamOrigin: `http://127.0.0.1:${upstreamAddress.port}`,
		upstreamHost: "smoke.develop-smoke.opencrane.test"
	});
	await _Listen(proxy);
	const proxyAddress = proxy.address();
	const result = await _Get(`http://127.0.0.1:${proxyAddress.port}/api/healthz`, {
		host: "example-4200.app.github.dev",
		"x-forwarded-host": "example-4200.app.github.dev"
	});

	assert.equal(result.statusCode, 200);
	assert.deepEqual(JSON.parse(result.body), { ok: true });
	assert.deepEqual(received, {
		forwardedHost: "example-4200.app.github.dev",
		host: "smoke.develop-smoke.opencrane.test",
		path: "/api/healthz"
	});
	await Promise.all([_Close(proxy), _Close(upstream)]);
});

test("the browser proxy closes active WebSocket tunnels during shutdown", { timeout: 2_000 }, async function _closesUpgrades()
{
	let upstreamPeer;
	const upstream = http.createServer();
	upstream.on("upgrade", function _accept(_request, socket)
	{
		upstreamPeer = socket;
		socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n");
	});
	await _Listen(upstream);
	const upstreamAddress = upstream.address();
	const proxy = createTier3BrowserProxy({
		upstreamOrigin: `http://127.0.0.1:${upstreamAddress.port}`,
		upstreamHost: "smoke.develop-smoke.opencrane.test"
	});
	await _Listen(proxy);
	const proxyAddress = proxy.address();
	const client = net.createConnection(proxyAddress.port, "127.0.0.1");
	await new Promise(function _upgrade(resolve, reject)
	{
		client.once("error", reject);
		client.once("data", resolve);
		client.write("GET /gateway HTTP/1.1\r\nHost: example.test\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n");
	});

	const clientClosed = new Promise(function _closed(resolve) { client.once("close", resolve); });
	await closeTier3BrowserProxy(proxy);
	await clientClosed;
	assert.equal(client.destroyed, true);
	upstreamPeer.destroy();
	await _Close(upstream);
});

test("the browser proxy aborts WebSocket handshakes during shutdown", { timeout: 2_000 }, async function _closesPendingUpgrade()
{
	let acceptUpgrade;
	let upstreamPeer;
	const upgradeAccepted = new Promise(function _accepted(resolve) { acceptUpgrade = resolve; });
	const upstream = http.createServer();
	upstream.on("upgrade", function _hold(_request, socket)
	{
		upstreamPeer = socket;
		socket.once("error", function _ignoreReset() {});
		acceptUpgrade();
	});
	await _Listen(upstream);
	const upstreamAddress = upstream.address();
	const proxy = createTier3BrowserProxy({
		upstreamOrigin: `http://127.0.0.1:${upstreamAddress.port}`,
		upstreamHost: "smoke.develop-smoke.opencrane.test"
	});
	await _Listen(proxy);
	const proxyAddress = proxy.address();
	const client = net.createConnection(proxyAddress.port, "127.0.0.1");
	client.once("error", function _ignoreReset() {});
	client.write("GET /gateway HTTP/1.1\r\nHost: example.test\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n");
	await upgradeAccepted;
	const clientClosed = new Promise(function _closed(resolve) { client.once("close", resolve); });

	await closeTier3BrowserProxy(proxy);
	await clientClosed;
	assert.equal(client.destroyed, true);
	upstreamPeer.destroy();
	await _Close(upstream);
});

test("the devcontainer and CI share the complete pinned Tier 3 toolchain", function _pinsTools()
{
	const devcontainer = JSON.parse(fs.readFileSync(new URL("../../.devcontainer/devcontainer.json", import.meta.url), "utf8"));
	const dockerfile = fs.readFileSync(new URL("../../.devcontainer/Dockerfile", import.meta.url), "utf8");
	const workflow = fs.readFileSync(new URL("../../.github/workflows/docker.yml", import.meta.url), "utf8");

	assert.equal(devcontainer.hostRequirements.cpus, 8);
	assert.equal(devcontainer.hostRequirements.memory, "32gb");
	assert.equal(devcontainer.hostRequirements.storage, "64gb");
	assert.ok(devcontainer.features["ghcr.io/devcontainers/features/docker-in-docker:4.1.0"]);
	assert.match(dockerfile, /javascript-node:5\.0\.2-24-bookworm/u);
	assert.match(dockerfile, /HELM_VERSION=v4\.1\.4/u);
	assert.match(dockerfile, /HELM_LINUX_AMD64_SHA256=70b2c30a19da4db264dfd68c8a3664e05093a361cefd89572ffb36f8abfa3d09/u);
	assert.match(dockerfile, /K3D_VERSION=v5\.8\.3/u);
	assert.match(dockerfile, /K3D_LINUX_AMD64_SHA256=dbaa79a76ace7f4ca230a1ff41dc7d8a5036a8ad0309e9c54f9bf3836dbe853e/u);
	assert.match(dockerfile, /KUBECTL_VERSION=v1\.30\.10/u);
	assert.match(dockerfile, /KUBECTL_LINUX_AMD64_SHA256=bc74dbeefd4b9d53f03016f6778f3ffc9a72ef4ca7b7c80fd5dc1a41d52dcab7/u);
	assert.match(workflow, /node-version: 24/u);
	assert.match(workflow, /K3D_VERSION: v5\.8\.3/u);
	assert.match(workflow, /K3D_LINUX_AMD64_SHA256: dbaa79a76ace7f4ca230a1ff41dc7d8a5036a8ad0309e9c54f9bf3836dbe853e/u);
	assert.match(workflow, /KUBECTL_VERSION: v1\.30\.10/u);
	assert.match(workflow, /KUBECTL_LINUX_AMD64_SHA256: bc74dbeefd4b9d53f03016f6778f3ffc9a72ef4ca7b7c80fd5dc1a41d52dcab7/u);
	assert.match(workflow, /version: v4\.1\.4/u);
});

function _Listen(server)
{
	return new Promise(function _listen(resolve, reject)
	{
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
}

function _Close(server)
{
	return new Promise(function _close(resolve)
	{
		server.close(resolve);
	});
}

function _Get(url, headers)
{
	return new Promise(function _request(resolve, reject)
	{
		const request = http.get(url, { headers }, function _response(response)
		{
			const chunks = [];
			response.on("data", function _data(chunk) { chunks.push(chunk); });
			response.on("end", function _end()
			{
				resolve({
					body: Buffer.concat(chunks).toString("utf8"),
					statusCode: response.statusCode
				});
			});
		});
		request.once("error", reject);
	});
}
