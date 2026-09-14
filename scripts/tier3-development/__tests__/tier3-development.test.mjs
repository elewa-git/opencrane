import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyTier3Capacity, formatTier3Capacity } from "../host-capacity.mjs";
import { buildTier3UpstreamRequestOptions, configureTier3UpstreamTimeout } from "../browser-proxy.mjs";
import { readTier3IngressCertificate } from "../ingress-certificate.mjs";
import { parseTier3Options } from "../options.mjs";
import { assertTier3ResourceReplacement, inspectTier3Resources } from "../resource-ownership.mjs";
import { downTier3Resources } from "../../tier3-development-down.mjs";
import { runTier3Development } from "../../tier3-development.mjs";

test("parses the separate infra and agent contracts", function _Options()
{
	assert.equal(parseTier3Options(["--profile", "infra"]).storageMode, "fast");
	assert.equal(parseTier3Options(["--profile", "agent", "--provider", "OpenAI", "--provider-key-file", "/tmp/key"]).provider, "openai");
	assert.throws(function _Credentials() { parseTier3Options(["--profile", "infra", "--provider", "openai"]); }, /refuses provider credentials/u);
	assert.throws(function _Missing() { parseTier3Options(["--profile", "agent"]); }, /requires --provider/u);
	assert.throws(function _Unsupported() { parseTier3Options(["--profile", "agent", "--provider", "unsupported", "--provider-key-file", "/tmp/key"]); }, /provider must be one of/u);
});

test("reports exact minimum and recommended host shortfalls", function _Capacity()
{
	const result = classifyTier3Capacity({ cpu: 4, memoryGiB: 16, storageAvailableGiB: 40, storageGiB: 64 });
	assert.deepEqual(result.minimumShortfalls, []);
	assert.deepEqual(result.recommendedShortfalls, ["4 more CPU required", "16.0 GiB more memory required", "24.0 GiB more available storage required"]);
	assert.match(formatTier3Capacity(result), /4 CPU, 16\.0 GiB memory, 64\.0 GiB storage \(40\.0 GiB available\)/u);
});

test("refuses foreign and implicit owned replacement", function _Ownership()
{
	assert.throws(function _Foreign() { assertTier3ResourceReplacement("other", "expected", true); }, /collision/u);
	assert.throws(function _Implicit() { assertTier3ResourceReplacement("expected", "expected", false); }, /--replace-owned/u);
	assert.doesNotThrow(function _Fresh() { assertTier3ResourceReplacement(null, "expected", false); });
});

test("accepts a registry only when it shares the owner-labelled cluster network", async function _RegistryOwnership()
{
	const identity = { clusterName: "cluster", registryName: "registry" };
	const associated = await inspectTier3Resources(identity, { inspect: async function _Inspect(name) { return name.endsWith("server-0") ? { exists: true, networks: ["k3d-cluster"], owner: "owner" } : { exists: true, networks: ["k3d-cluster"], owner: null }; } });
	assert.deepEqual(associated, { clusterExists: true, existingOwner: "owner", registryExists: true });
	const foreign = await inspectTier3Resources(identity, { inspect: async function _Inspect(name) { return name.endsWith("server-0") ? { exists: true, networks: ["k3d-cluster"], owner: "owner" } : { exists: true, networks: ["bridge"], owner: null }; } });
	assert.equal(foreign.existingOwner, "unknown");
});

test("deletes only inspected resources and propagates cleanup failures", async function _Cleanup()
{
	const calls = [];
	const owner = (await import("../resource-ownership.mjs")).tier3ResourceIdentity(new URL("../../..", import.meta.url).pathname).owner;
	await downTier3Resources({ inspectResources: async function _Inspect() { return { clusterExists: true, existingOwner: owner, registryExists: false }; }, run: async function _Run(command, arguments_) { calls.push([command, arguments_]); } });
	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0][1].slice(0, 2), ["cluster", "delete"]);
	await assert.rejects(downTier3Resources({ inspectResources: async function _Inspect() { return { clusterExists: true, existingOwner: owner, registryExists: true }; }, run: async function _Run() { throw new Error("daemon unavailable"); } }), /daemon unavailable/u);
});

test("reads only the Secret selected by the live Certificate", async function _Certificate()
{
	const calls = [];
	const certificate = "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----\n";
	const result = await readTier3IngressCertificate({ certificateName: "release-clustertenant-tls", namespace: "tier3" }, { kubectl: async function _Kubectl(arguments_) { calls.push(arguments_); return calls.length === 1 ? "release-tls-secret" : Buffer.from(certificate).toString("base64"); } });
	assert.equal(result, certificate);
	assert.equal(calls[1][2], "release-tls-secret");
});

test("pins Tier 3 proxy trust and replaces untrusted forwarding and credential claims", function _ProxyRequest()
{
	const request = { method: "POST", url: "/api/v1/me/persona", headers: { host: "127.0.0.1:4200", origin: "http://127.0.0.1:4200", referer: "http://127.0.0.1:4200/onboarding", forwarded: "for=attacker", "x-forwarded-host": "attacker.example", "x-forwarded-proto": "http", "x-opencrane-development-session": "session-proof" } };
	const built = buildTier3UpstreamRequestOptions(request, new URL("https://127.0.0.1:28443"), { developmentCredential: "coordinator-proof", upstreamCertificate: "certificate", upstreamHost: "tier3.local.opencrane.test" });
	assert.equal(built.servername, "tier3.local.opencrane.test");
	assert.equal(built.ca, "certificate");
	assert.equal(built.rejectUnauthorized, true);
	assert.equal(built.headers.host, "tier3.local.opencrane.test");
	assert.equal(built.headers["x-forwarded-host"], "tier3.local.opencrane.test");
	assert.equal(built.headers["x-forwarded-proto"], "https");
	assert.equal(built.headers.origin, "https://tier3.local.opencrane.test");
	assert.equal(built.headers.referer, "https://tier3.local.opencrane.test/");
	assert.equal(built.headers.forwarded, undefined);
	assert.equal(built.headers["x-opencrane-development-session"], "coordinator-proof");
	const absent = buildTier3UpstreamRequestOptions({ ...request, headers: { ...request.headers, "x-opencrane-development-session": undefined } }, new URL("https://127.0.0.1:28443"), { developmentCredential: "coordinator-proof", upstreamCertificate: "certificate", upstreamHost: "tier3.local.opencrane.test" });
	assert.equal(absent.headers["x-opencrane-development-session"], "coordinator-proof");
	const infra = buildTier3UpstreamRequestOptions(request, new URL("https://127.0.0.1:28443"), { developmentCredential: null, upstreamCertificate: "certificate", upstreamHost: "tier3.local.opencrane.test" });
	assert.equal(infra.headers["x-opencrane-development-session"], undefined);
});

test("destroys an upstream request when its ingress deadline expires", function _ProxyTimeout()
{
	let timeoutHandler;
	let destroyedWith;
	const request = { destroy: function _Destroy(error) { destroyedWith = error; }, setTimeout: function _Set(milliseconds, handler) { assert.equal(milliseconds, 25); timeoutHandler = handler; } };
	configureTier3UpstreamTimeout(request, 25);
	timeoutHandler();
	assert.match(destroyedWith.message, /timed out after 25 ms/u);
});

test("runs the current smoke before proxying and preserves recommended qualification", async function _Orchestrator()
{
	const order = [];
	await runTier3Development(parseTier3Options(["--profile", "infra"]), {
		environment: { SMOKE_HOST_PROFILE: "recommended" },
		inspectResources: async function _Inspect() { return { existingOwner: null }; },
		measureCapacity: async function _Capacity() { return { cpu: 8, memoryGiB: 32, storageAvailableGiB: 80, storageGiB: 100 }; },
		readCertificate: async function _Certificate() { order.push("certificate"); return "certificate"; },
		runSmoke: async function _Smoke(environment) { order.push("smoke"); assert.equal(environment.SMOKE_HOST_PROFILE, "recommended"); assert.equal(environment.KEEP_CLUSTER, "1"); assert.match(environment.SMOKE_RESOURCE_OWNER, /^worktree-/u); },
		createProxy: function _Proxy(options) { order.push("proxy"); assert.equal(options.developmentCredential, null); return {}; },
		listenProxy: async function _Listen() { order.push("listen"); },
		waitForShutdown: async function _Shutdown() { order.push("shutdown"); },
		write: function _Write() {},
	});
	assert.deepEqual(order, ["smoke", "certificate", "proxy", "listen", "shutdown"]);
});

test("closes the browser proxy when the agent qualification fails", async function _FailedAgentJourney()
{
	const order = [];
	await assert.rejects(runTier3Development(parseTier3Options(["--profile", "agent", "--provider", "openai", "--provider-key-file", "/tmp/key"]), {
		closeProxy: async function _Close() { order.push("close"); },
		createProxy: function _Proxy() { return {}; },
		inspectResources: async function _Inspect() { return { existingOwner: null }; },
		listenProxy: async function _Listen() { order.push("listen"); },
		measureCapacity: async function _Capacity() { return { cpu: 8, memoryGiB: 32, storageAvailableGiB: 80, storageGiB: 100 }; },
		readCertificate: async function _Certificate() { return "certificate"; },
		runAgentJourney: async function _Journey() { order.push("journey"); throw new Error("qualification failed"); },
		runSmoke: async function _Smoke() {},
		write: function _Write() {},
	}), /qualification failed/u);
	assert.deepEqual(order, ["listen", "journey", "close"]);
});

test("keeps the shared smoke defaults compatible with CI", async function _SmokeContract()
{
	const source = await import("node:fs/promises").then(function _Read(fs) { return fs.readFile(new URL("../../../apps/_infra/deploy-k8s/platform/tests/develop-smoke.sh", import.meta.url), "utf8"); });
	assert.match(source, /SMOKE_INGRESS_PORT="\$\{SMOKE_INGRESS_PORT:-8443\}"/u);
	assert.match(source, /SMOKE_RESOURCE_OWNER="\$\{SMOKE_RESOURCE_OWNER:-\}"/u);
	assert.match(source, /--runtime-label "opencrane\.tier3\.owner=\$\{SMOKE_RESOURCE_OWNER\}@server:\*"/u);
	assert.match(source, /if \[\[ "\$KEEP_CLUSTER" == "1" && "\$SMOKE_CLUSTER_CREATED" == "1" \]\]; then/u);
	assert.match(source, /SMOKE_CLUSTER_CREATED=1/u);
});
