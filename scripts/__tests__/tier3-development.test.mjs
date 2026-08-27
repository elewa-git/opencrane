import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { closeTier3BrowserProxy, createTier3BrowserProxy } from "../tier3-browser-proxy.mjs";
import { createTier3SessionConfiguration, parseTier3Arguments } from "../tier3-development-options.mjs";
import { runTier3Development } from "../tier3-development.mjs";
import { readTier3IngressCertificate } from "../tier3-ingress-certificate.mjs";

test("Tier 3 defaults to the minimum-host storage profile and the Codespaces proxy", function _defaults()
{
	assert.deepEqual(parseTier3Arguments([]), {
		help: false,
		proxyPort: 4200,
		smokeOnly: false,
		storageMode: "fast"
	});
});

test("Tier 3 accepts the documented full-storage and smoke-only overrides", function _overrides()
{
	assert.deepEqual(parseTier3Arguments(["--storage-mode", "full", "--proxy-port", "4300", "--smoke-only"]), {
		help: false,
		proxyPort: 4300,
		smokeOnly: true,
		storageMode: "full"
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
		ingressCertificate: {
			certificateName: "opencrane-qa-clustertenant-tls",
			namespace: "opencrane-develop-smoke",
		},
		smokeEnvironment: {
			BASE_DOMAIN: "local.test",
			CLUSTER_TENANT: "qa",
			KEEP_CLUSTER: "1",
			PATH: "/usr/bin",
			SMOKE_HOST_PROFILE: "minimum",
			SMOKE_STORAGE_MODE: "fast",
			TIMEOUT_SECONDS: "600"
		},
		upstreamHost: "qa.local.test"
	});
});

test("Tier 3 preserves explicit smoke resource overrides", function _preservesResourceOverrides()
{
	const configuration = createTier3SessionConfiguration({
		SMOKE_HOST_PROFILE: "recommended",
		TIMEOUT_SECONDS: "900"
	}, "full");

	assert.equal(configuration.smokeEnvironment.SMOKE_HOST_PROFILE, "recommended");
	assert.equal(configuration.smokeEnvironment.TIMEOUT_SECONDS, "900");
});

test("Tier 3 qualifies smoke before it starts and waits on the matching ingress proxy", async function _ordersSession()
{
	const events = [];
	const server = {};
	const certificate = "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n";
	await runTier3Development({ proxyPort: 4300, smokeOnly: false, storageMode: "fast" }, {
		createProxy(options)
		{
			events.push(["create-proxy", options.upstreamHost, options.upstreamCertificate]);
			return server;
		},
		listenProxy(receivedServer, port)
		{
			events.push(["listen", receivedServer, port]);
		},
		parentEnvironment: {},
		runSmoke(environment)
		{
			events.push(["smoke", environment.KEEP_CLUSTER, environment.SMOKE_STORAGE_MODE, environment.SMOKE_HOST_PROFILE, environment.TIMEOUT_SECONDS]);
		},
		readIngressCertificate(identity)
		{
			events.push(["read-certificate", identity.namespace, identity.certificateName]);
			return certificate;
		},
		waitForShutdown(receivedServer)
		{
			events.push(["wait", receivedServer]);
		},
		writeOutput() {}
	});

	assert.deepEqual(events, [
		["smoke", "1", "fast", "minimum", "600"],
		["read-certificate", "opencrane-develop-smoke", "opencrane-smoke-clustertenant-tls"],
		["create-proxy", "smoke.develop-smoke.opencrane.test", certificate],
		["listen", server, 4300],
		["wait", server]
	]);
});

test("the ingress certificate reader follows the Certificate's exact Secret", async function _readsCertificate()
{
	const certificate = "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n";
	const calls = [];
	const result = await readTier3IngressCertificate({
		certificateName: "custom-release-clustertenant-tls",
		namespace: "custom-namespace"
	}, {
		execFile(command, argumentsList, callback)
		{
			calls.push([command, argumentsList]);
			const output = calls.length === 1 ? "custom-wildcard-tls" : Buffer.from(certificate).toString("base64");
			callback(null, output, "");
		}
	});

	assert.equal(result, certificate);
	assert.deepEqual(calls, [
		["kubectl", ["get", "certificate", "custom-release-clustertenant-tls", "-n", "custom-namespace", "-o", "jsonpath={.spec.secretName}"]],
		["kubectl", ["get", "secret", "custom-wildcard-tls", "-n", "custom-namespace", "-o", "jsonpath={.data.tls\\.crt}"]]
	]);
});

test("the ingress certificate reader rejects missing resources and invalid PEM", async function _rejectsCertificateErrors()
{
	await assert.rejects(readTier3IngressCertificate({ certificateName: "missing", namespace: "test" }, {
		execFile(_command, _argumentsList, callback)
		{
			callback(new Error("exit 1"), "", "NotFound");
		}
	}), /Unable to read the Tier 3 ingress Certificate: NotFound/u);

	let callCount = 0;
	await assert.rejects(readTier3IngressCertificate({ certificateName: "invalid", namespace: "test" }, {
		execFile(_command, _argumentsList, callback)
		{
			callCount += 1;
			callback(null, callCount === 1 ? "tls-secret" : Buffer.from("not a certificate").toString("base64"), "");
		}
	}), /does not contain a PEM certificate/u);
});

test("the HTTPS browser proxy fails closed without the smoke ingress certificate", function _requiresCertificate()
{
	assert.throws(function _create()
	{
		createTier3BrowserProxy({ upstreamHost: "smoke.develop-smoke.opencrane.test" });
	}, /requires its smoke-issued certificate/u);
});

test("the HTTPS browser proxy trusts only the supplied smoke certificate", async function _trustsCertificate(context)
{
	const trustedFixture = _CreateTlsFixture("smoke.develop-smoke.opencrane.test");
	context.after(trustedFixture.remove);
	const untrustedFixture = _CreateTlsFixture("other.test");
	context.after(untrustedFixture.remove);
	const upstream = https.createServer({ cert: trustedFixture.certificate, key: trustedFixture.privateKey }, function _respond(_request, response)
	{
		response.end("trusted");
	});
	await _Listen(upstream);
	const upstreamAddress = upstream.address();
	const upstreamOrigin = `https://127.0.0.1:${upstreamAddress.port}`;
	const upstreamHost = "smoke.develop-smoke.opencrane.test";
	const trustedProxy = createTier3BrowserProxy({ upstreamCertificate: trustedFixture.certificate, upstreamHost, upstreamOrigin });
	const untrustedProxy = createTier3BrowserProxy({ upstreamCertificate: untrustedFixture.certificate, upstreamHost, upstreamOrigin });
	await Promise.all([_Listen(trustedProxy), _Listen(untrustedProxy)]);

	const trustedAddress = trustedProxy.address();
	const untrustedAddress = untrustedProxy.address();
	const trustedResult = await _Get(`http://127.0.0.1:${trustedAddress.port}/health`, { host: "example.test" });
	const untrustedResult = await _Get(`http://127.0.0.1:${untrustedAddress.port}/health`, { host: "example.test" });

	assert.equal(trustedResult.statusCode, 200);
	assert.equal(trustedResult.body, "trusted");
	assert.equal(untrustedResult.statusCode, 502);
	assert.match(untrustedResult.body, /certificate/u);
	await Promise.all([_Close(trustedProxy), _Close(untrustedProxy), _Close(upstream)]);
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

test("the devcontainer enforces the Tier 3 minimum and shares the pinned CI toolchain", function _pinsTools()
{
	const devcontainer = JSON.parse(fs.readFileSync(new URL("../../.devcontainer/devcontainer.json", import.meta.url), "utf8"));
	const dockerfile = fs.readFileSync(new URL("../../.devcontainer/Dockerfile", import.meta.url), "utf8");
	const verification = fs.readFileSync(new URL("../../.devcontainer/verify-tools.sh", import.meta.url), "utf8");
	const onCreate = fs.readFileSync(new URL("../../.devcontainer/on-create.sh", import.meta.url), "utf8");
	const workflow = fs.readFileSync(new URL("../../.github/workflows/docker.yml", import.meta.url), "utf8");

	assert.equal(devcontainer.hostRequirements.cpus, 4);
	assert.equal(devcontainer.hostRequirements.memory, "16gb");
	assert.equal(devcontainer.hostRequirements.storage, "32gb");
	assert.ok(devcontainer.features["ghcr.io/devcontainers/features/docker-in-docker:4.1.0"]);
	assert.equal(devcontainer.onCreateCommand, "bash .devcontainer/on-create.sh");
	assert.match(onCreate, /RECOMMENDED_FREE_KIB="\$\(\(40 \* 1024 \* 1024\)\)"/u);
	assert.match(onCreate, /npm cache clean --force/u);
	assert.match(verification, /docker buildx prune --help \| grep -q -- '--min-free-space'/u);
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

test("the devcontainer installs workspace dependencies only with recommended-host headroom", function _budgetsCreationStorage(context)
{
	const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "opencrane-tier3-on-create-"));
	context.after(function _removeFixture() { fs.rmSync(fixture, { force: true, recursive: true }); });
	const callLog = path.join(fixture, "npm.calls");
	const npmStub = path.join(fixture, "npm");
	fs.writeFileSync(npmStub, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "$NPM_CALL_LOG"\n`);
	fs.chmodSync(npmStub, 0o755);
	const executable = fileURLToPath(new URL("../../.devcontainer/on-create.sh", import.meta.url));
	const environment = {
		...process.env,
		NPM_CALL_LOG: callLog,
		PATH: `${fixture}:${process.env.PATH}`
	};

	execFileSync("bash", [executable], {
		env: { ...environment, OPENCRANE_DEVCONTAINER_AVAILABLE_KIB: String(20 * 1024 * 1024) }
	});
	assert.equal(fs.readFileSync(callLog, "utf8"), "cache clean --force\n");

	fs.writeFileSync(callLog, "");
	execFileSync("bash", [executable], {
		env: { ...environment, OPENCRANE_DEVCONTAINER_AVAILABLE_KIB: String(45 * 1024 * 1024) }
	});
	assert.equal(fs.readFileSync(callLog, "utf8"), "ci\n");
});

test("the minimum Codespaces path reclaims image storage without slowing CI imports", function _protectsLowDiskImport()
{
	const smoke = fs.readFileSync(new URL("../../apps/_infra/deploy-k8s/platform/tests/develop-smoke.sh", import.meta.url), "utf8");
	const imageStorage = fs.readFileSync(new URL("../../apps/_infra/deploy-k8s/platform/tests/develop-smoke-image-storage.sh", import.meta.url), "utf8");

	assert.match(smoke, /SMOKE_HOST_PROFILE="\$\{SMOKE_HOST_PROFILE:-recommended\}"/u);
	assert.match(smoke, /_reset_smoke_storage[\s\S]*?_prepare_smoke_host_storage[\s\S]*?_prepare_images &/u);
	assert.match(smoke, /k3d cluster create[\s\S]*?--wait/u);
	// A 32 GB Codespace needs k3d's default image volume because v5.8.3 rolls back cluster
	// creation after failing to discover its tools node when that volume is disabled.
	assert.doesNotMatch(smoke, /--no-image-volume/u);
	assert.match(imageStorage, /rm -rf -- "\$ROOT_DIR\/node_modules"/u);
	assert.match(imageStorage, /npm cache clean --force/u);
	assert.match(imageStorage, /docker buildx prune --all --force --min-free-space "\$\{_SMOKE_REQUIRED_DOCKER_FREE_GIB\}gb"/u);
	assert.match(imageStorage, /df -Pk "\$docker_root"/u);
	assert.match(imageStorage, /available_kib[\s\S]*?_SMOKE_REQUIRED_DOCKER_FREE_GIB/u);
	assert.match(imageStorage, /for image in "\$\{SMOKE_IMAGES\[@\]\}"; do[\s\S]*?k3d image import "\$image"[\s\S]*?docker image rm "\$image"/u);
	assert.match(imageStorage, /done[\s\S]*?docker image prune --force[\s\S]*?docker buildx prune --all --force --min-free-space[\s\S]*?_require_smoke_docker_free_space/u);
	assert.match(imageStorage, /if \[\[ "\$SMOKE_HOST_PROFILE" == "recommended" \]\]; then[\s\S]*?k3d image import "\$\{SMOKE_IMAGES\[@\]\}"/u);
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

/** Creates a self-signed certificate and cleanup callback for hostname and CA trust tests. */
function _CreateTlsFixture(commonName)
{
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrane-tier3-tls-"));
	const certificatePath = path.join(directory, "certificate.pem");
	const privateKeyPath = path.join(directory, "private-key.pem");

	try
	{
		execFileSync("openssl", [
			"req",
			"-x509",
			"-newkey",
			"rsa:2048",
			"-nodes",
			"-keyout",
			privateKeyPath,
			"-out",
			certificatePath,
			"-days",
			"1",
			"-subj",
			`/CN=${commonName}`,
			"-addext",
			`subjectAltName=DNS:${commonName}`
		], { stdio: "ignore" });

		return {
			certificate: fs.readFileSync(certificatePath, "utf8"),
			privateKey: fs.readFileSync(privateKeyPath, "utf8"),
			remove() { fs.rmSync(directory, { force: true, recursive: true }); }
		};
	}
	catch (error)
	{
		fs.rmSync(directory, { force: true, recursive: true });
		throw error;
	}
}
