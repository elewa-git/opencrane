import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyTier3Capacity, formatTier3Capacity } from "../host-capacity.mjs";
import { readTier3IngressCertificate } from "../ingress-certificate.mjs";
import { parseTier3Options } from "../options.mjs";
import { assertTier3ResourceReplacement } from "../resource-ownership.mjs";
import { runTier3Development } from "../../tier3-development.mjs";

test("parses the separate infra and agent contracts", function _Options()
{
	assert.equal(parseTier3Options(["--profile", "infra"]).storageMode, "fast");
	assert.equal(parseTier3Options(["--profile", "agent", "--provider", "OpenAI", "--provider-key-file", "/tmp/key"]).provider, "openai");
	assert.throws(function _Credentials() { parseTier3Options(["--profile", "infra", "--provider", "openai"]); }, /refuses provider credentials/u);
	assert.throws(function _Missing() { parseTier3Options(["--profile", "agent"]); }, /requires --provider/u);
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

test("reads only the Secret selected by the live Certificate", async function _Certificate()
{
	const calls = [];
	const certificate = "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----\n";
	const result = await readTier3IngressCertificate({ certificateName: "release-clustertenant-tls", namespace: "tier3" }, { kubectl: async function _Kubectl(arguments_) { calls.push(arguments_); return calls.length === 1 ? "release-tls-secret" : Buffer.from(certificate).toString("base64"); } });
	assert.equal(result, certificate);
	assert.equal(calls[1][2], "release-tls-secret");
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
		createProxy: function _Proxy() { order.push("proxy"); return {}; },
		listenProxy: async function _Listen() { order.push("listen"); },
		waitForShutdown: async function _Shutdown() { order.push("shutdown"); },
		write: function _Write() {},
	});
	assert.deepEqual(order, ["smoke", "certificate", "proxy", "listen", "shutdown"]);
});

test("keeps the shared smoke defaults compatible with CI", async function _SmokeContract()
{
	const source = await import("node:fs/promises").then(function _Read(fs) { return fs.readFile(new URL("../../../apps/_infra/deploy-k8s/platform/tests/develop-smoke.sh", import.meta.url), "utf8"); });
	assert.match(source, /SMOKE_INGRESS_PORT="\$\{SMOKE_INGRESS_PORT:-8443\}"/u);
	assert.match(source, /SMOKE_RESOURCE_OWNER="\$\{SMOKE_RESOURCE_OWNER:-\}"/u);
	assert.match(source, /--runtime-label "opencrane\.tier3\.owner=\$\{SMOKE_RESOURCE_OWNER\}@server:\*"/u);
});
