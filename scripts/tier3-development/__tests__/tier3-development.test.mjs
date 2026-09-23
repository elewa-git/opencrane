import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { classifyTier3Capacity, formatTier3Capacity, measureTier3Capacity } from "../host-capacity.mjs";
import { buildTier3UpstreamRequestOptions, configureTier3UpstreamTimeout, isAllowedTier3BrowserRequest, tier3BrowserOrigins } from "../browser-proxy.mjs";
import { readTier3IngressCertificate } from "../ingress-certificate.mjs";
import { parseTier3Options } from "../options.mjs";
import { assertTier3ResourceReplacement, inspectTier3Resources, tier3ResourceIdentity } from "../resource-ownership.mjs";
import { downTier3Resources } from "../../tier3-development-down.mjs";
import { runTier3Development } from "../../tier3-development.mjs";

const _TEST_REPOSITORY_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** Allows a focused cleanup test to replace the smoke's Docker ownership proof. */
async function _SafeGuard() {}

/** Allows a focused cleanup test to replace owner-scoped image removal. */
async function _NoopPrune() {}

/** Runs the smoke's read-only ownership mode with a fake Docker command and no daemon writes. */
function _RunFakeSmokeGuard(scenario)
{
	const fakeDocker = `() {
		if [[ "$1" == "inspect" ]]; then
			if [[ "$2" == "--format" ]]; then
				if [[ "$4" == "k3d-opencrane-test-server-0" ]]; then
					echo worktree-good
					return 0
				fi
				if [[ "$4" == "node-id" ]]; then
					case "$3" in
						*'.Name'*) echo /k3d-opencrane-test-server-1 ;;
						*'opencrane.tier3.owner'*) if [[ "$FAKE_DOCKER_CASE" == "foreign-node" ]]; then echo other-owner; else echo worktree-good; fi ;;
						*'NetworkSettings.Networks'*) echo '{"k3d-opencrane-test":{}}' ;;
							*) echo opencrane-test ;;
						esac
					return 0
				fi
			fi
			if [[ "$2" == "k3d-opencrane-test-server-0" && "$FAKE_DOCKER_CASE" != "orphan" && "$FAKE_DOCKER_CASE" != "docker-failure" && "$FAKE_DOCKER_CASE" != "clean" ]]; then return 0; fi
			return 1
		fi
		if [[ "$1" == "ps" ]]; then
			if [[ "$FAKE_DOCKER_CASE" == "docker-failure" ]]; then return 1; fi
			if [[ "$FAKE_DOCKER_CASE" == "orphan" || "$FAKE_DOCKER_CASE" == "foreign-node" ]]; then echo node-id; fi
			return 0
		fi
		if [[ "$1" == "volume" && "$2" == "ls" ]]; then
			if [[ "$FAKE_DOCKER_CASE" == "extra-volume" ]]; then echo unexpected-volume; fi
			return 0
		fi
		return 1
	}`;
	const environment = {
		...process.env,
		"BASH_FUNC_docker%%": fakeDocker,
		CLUSTER_NAME: "opencrane-test",
		FAKE_DOCKER_CASE: scenario,
		SMOKE_RESOURCE_OWNER: "worktree-good",
	};
	const script = fileURLToPath(new URL("../../../apps/_infra/deploy-k8s/platform/tests/develop-smoke.sh", import.meta.url));
	const result = spawnSync("bash", [script, "--assert-owned-resources"], { encoding: "utf8", env: environment });
	return result;
}

test("parses the separate infra and agent contracts", function _Options()
{
	assert.equal(parseTier3Options(["--profile", "infra"]).storageMode, "fast");
	assert.equal(parseTier3Options(["--profile", "agent", "--provider", "OpenAI", "--provider-key-file", "/tmp/key"]).provider, "openai");
	assert.equal(parseTier3Options(["--profile", "agent", "--default-provider", "Anthropic"]).defaultProvider, "anthropic");
	assert.throws(function _Credentials() { parseTier3Options(["--profile", "infra", "--provider", "openai"]); }, /refuses provider credentials/u);
	assert.doesNotThrow(function _CodespacesDiscovery() { parseTier3Options(["--profile", "agent"]); });
	assert.throws(function _Unsupported() { parseTier3Options(["--profile", "agent", "--provider", "unsupported", "--provider-key-file", "/tmp/key"]); }, /provider must be one of/u);
	assert.throws(function _UnsupportedDefault() { parseTier3Options(["--profile", "agent", "--default-provider", "unsupported"]); }, /default provider must be one of/u);
});

test("reports exact minimum and recommended host shortfalls", function _Capacity()
{
	const result = classifyTier3Capacity({ cpu: 4, memoryGiB: 16, storageAvailableGiB: 40, storageGiB: 64 });
	assert.deepEqual(result.minimumShortfalls, []);
	assert.deepEqual(result.recommendedShortfalls, ["4 more CPU required", "13.8 GiB more memory required"]);
	assert.match(formatTier3Capacity(result), /4 CPU, 16\.0 GiB memory, 64\.0 GiB storage \(40\.0 GiB available\)/u);
});

test("accepts the Codespaces decimal-GB minimum and rejects a real shortfall", function _CodespacesCapacity()
{
	const codespace = classifyTier3Capacity({ cpu: 4, memoryGiB: 15.6, storageAvailableGiB: 25.5, storageGiB: 31.3 });
	assert.deepEqual(codespace.minimumShortfalls, []);
	const undersized = classifyTier3Capacity({ cpu: 4, memoryGiB: 14.8, storageAvailableGiB: 25.5, storageGiB: 29.7 });
	assert.deepEqual(undersized.minimumShortfalls, ["0.1 GiB more memory required", "0.1 GiB more allocated storage required"]);
});

test("measures the Docker backing filesystem instead of the checkout device", async function _DockerCapacity()
{
	const calls = [];
	const measured = await measureTier3Capacity({
		cpus: function _Cpus() { return [{}, {}, {}, {}]; },
		execFile: async function _Run(command, arguments_)
		{
			calls.push([command, arguments_]);
			return { stdout: "Filesystem 1024-blocks Used Available Capacity Mounted on\noverlay 67108864 1048576 66060288 2% /\n" };
		},
		totalmem: function _Memory() { return 16 * 1_073_741_824; },
	});
	assert.deepEqual(measured, { cpu: 4, memoryGiB: 16, storageAvailableGiB: 63, storageGiB: 64 });
	assert.equal(calls[0][0], "docker");
	assert.deepEqual(calls[0][1].slice(0, 3), ["run", "--rm", "--pull=missing"]);
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

test("treats only an explicit missing Docker object as absent", async function _DockerInspection()
{
	const identity = { clusterName: "cluster", registryName: "registry" };
	const missing = Object.assign(new Error("missing"), { code: 1, stderr: "Error: No such object: test" });
	assert.deepEqual(await inspectTier3Resources(identity, { execFile: async function _Missing() { throw missing; } }), { clusterExists: false, existingOwner: null, registryExists: false });
	const unavailable = Object.assign(new Error("daemon unavailable"), { code: 1, stderr: "Cannot connect to the Docker daemon" });
	await assert.rejects(inspectTier3Resources(identity, { execFile: async function _Unavailable() { throw unavailable; } }), /daemon unavailable/u);
});

test("deletes only inspected resources and propagates cleanup failures", async function _Cleanup()
{
	const calls = [];
	const owner = tier3ResourceIdentity(_TEST_REPOSITORY_ROOT).owner;
	/** Provides a retained cluster owned by this test worktree. */
	async function _Inspect() { return { clusterExists: true, existingOwner: owner, registryExists: false }; }
	/** Records the exact k3d command chosen for cleanup. */
	async function _Run(command, arguments_) { calls.push([command, arguments_]); }
	const operations = {
		guard: _SafeGuard,
		inspectResources: _Inspect,
		pruneImages: _NoopPrune,
		run: _Run,
	};
	await downTier3Resources(operations);
	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0][1].slice(0, 2), ["cluster", "delete"]);
	/** Exposes a registry owned by the same retained cluster. */
	async function _InspectWithRegistry() { return { clusterExists: true, existingOwner: owner, registryExists: true }; }
	/** Models Docker becoming unavailable during exact deletion. */
	async function _Unavailable() { throw new Error("daemon unavailable"); }
	const unavailableOperations = {
		guard: _SafeGuard,
		inspectResources: _InspectWithRegistry,
		pruneImages: _NoopPrune,
		run: _Unavailable,
	};
	await assert.rejects(downTier3Resources(unavailableOperations), /daemon unavailable/u);
});

test("retries cleanup after the registry was deleted but cluster deletion failed", async function _CleanupRetry()
{
	const calls = [];
	const owner = tier3ResourceIdentity(_TEST_REPOSITORY_ROOT).owner;
	const resources = { clusterExists: true, existingOwner: owner, registryExists: true };
	let clusterAttempts = 0;
	/** Returns the mutable resource set after each simulated k3d deletion. */
	async function _Inspect() { return { ...resources }; }
	/** Deletes the registry, then fails once while deleting the cluster. */
	async function _Run(_command, arguments_)
	{
		calls.push(arguments_.slice(0, 2));
		if (arguments_[0] === "registry") resources.registryExists = false;
		else if (clusterAttempts++ === 0) throw new Error("cluster deletion failed");
		else resources.clusterExists = false;
	}
	const operations = {
		guard: _SafeGuard,
		inspectResources: _Inspect,
		pruneImages: _NoopPrune,
		run: _Run,
	};
	await assert.rejects(downTier3Resources(operations), /cluster deletion failed/u);
	await downTier3Resources(operations);
	assert.deepEqual(calls, [["registry", "delete"], ["cluster", "delete"], ["cluster", "delete"]]);
});

test("rechecks ownership immediately before deleting a retained resource", async function _CleanupOwnershipRace()
{
	let inspections = 0;
	let deleted = false;
	const owner = tier3ResourceIdentity(_TEST_REPOSITORY_ROOT).owner;
	/** Changes the winner between admission and the pre-delete inspection. */
	async function _Inspect()
	{
		inspections += 1;
		return { clusterExists: true, existingOwner: inspections === 1 ? owner : "replacement-owner", registryExists: false };
	}
	/** Records whether an unproved resource would be deleted. */
	async function _Run() { deleted = true; }
	const operations = {
		guard: _SafeGuard,
		inspectResources: _Inspect,
		pruneImages: _NoopPrune,
		run: _Run,
	};
	await assert.rejects(downTier3Resources(operations), /resource collision/u);
	assert.equal(deleted, false);
});

test("refuses an orphan deletion set even when the server and registry are absent", async function _CleanupOrphan()
{
	let pruned = false;
	/** Models the shared smoke guard finding an orphan node or volume. */
	async function _Guard() { throw new Error("unproved orphan node or volume"); }
	/** Records whether image cleanup can run after a failed resource proof. */
	async function _Prune() { pruned = true; }
	/** Represents the misleading absence of the server and registry. */
	async function _Inspect() { return { clusterExists: false, existingOwner: null, registryExists: false }; }
	const operations = {
		guard: _Guard,
		inspectResources: _Inspect,
		pruneImages: _Prune,
	};
	await assert.rejects(downTier3Resources(operations), /unproved orphan/u);
	assert.equal(pruned, false);
});

test("rechecks the complete resource set before each exact k3d deletion", async function _CleanupFullSetRace()
{
	const calls = [];
	const owner = tier3ResourceIdentity(_TEST_REPOSITORY_ROOT).owner;
	let guards = 0;
	/** Models a foreign cluster member arriving after registry deletion. */
	async function _Guard()
	{
		guards += 1;
		if (guards === 3) throw new Error("foreign cluster member");
	}
	/** Records exact k3d deletions without changing local Docker state. */
	async function _Run(_command, arguments_) { calls.push(arguments_.slice(0, 2)); }
	/** Keeps both resources visible so every deletion needs a fresh guard. */
	async function _Inspect() { return { clusterExists: true, existingOwner: owner, registryExists: true }; }
	const operations = {
		guard: _Guard,
		inspectResources: _Inspect,
		pruneImages: _NoopPrune,
		run: _Run,
	};
	await assert.rejects(downTier3Resources(operations), /foreign cluster member/u);
	assert.deepEqual(calls, [["registry", "delete"]]);
});

test("removes owner image references after an already-clean cluster", async function _CleanupImagesOnly()
{
	let pruned = false;
	/** Records the owner-scoped image removal mode. */
	async function _Prune() { pruned = true; }
	/** Represents a cluster and registry already removed by k3d. */
	async function _Inspect() { return { clusterExists: false, existingOwner: null, registryExists: false }; }
	const operations = {
		guard: _SafeGuard,
		inspectResources: _Inspect,
		pruneImages: _Prune,
	};
	await downTier3Resources(operations);
	assert.equal(pruned, true);
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
	const rewrittenRead = {
		method: "GET",
		url: "/api/v1/me/conversations/conversation/events",
		headers: {
			host: "localhost:4200",
			origin: "https://localhost:4200",
			referer: "https://example-codespace-4200.app.github.dev/conversations/conversation",
			"sec-fetch-site": "same-origin",
			"x-forwarded-host": "example-codespace-4200.app.github.dev",
			"x-forwarded-proto": "https",
		},
	};
	const allowed = ["http://127.0.0.1:4200", "https://example-codespace-4200.app.github.dev"];
	assert.equal(isAllowedTier3BrowserRequest(rewrittenRead, allowed), true);
	const readOptions = {
		developmentCredential: "coordinator-proof",
		upstreamCertificate: "certificate",
		upstreamHost: "tier3.local.opencrane.test",
	};
	const builtRead = buildTier3UpstreamRequestOptions(rewrittenRead, new URL("https://127.0.0.1:28443"), readOptions);
	assert.equal(builtRead.headers.origin, "https://tier3.local.opencrane.test");
	assert.equal(builtRead.headers.referer, "https://tier3.local.opencrane.test/");
});

test("selects exact browser authorities from the coordinator, not request headers", function _BrowserOrigins()
{
	const local = tier3BrowserOrigins(4_200, {});
	assert.deepEqual(local, ["http://127.0.0.1:4200"]);
	const codespaces = tier3BrowserOrigins(4_200, {
		CODESPACES: "true",
		CODESPACE_NAME: "example-codespace",
		GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev",
	});
	assert.deepEqual(codespaces, ["http://127.0.0.1:4200", "https://example-codespace-4200.app.github.dev"]);
	assert.throws(function _MissingDomain() { tier3BrowserOrigins(4_200, { CODESPACES: "true", CODESPACE_NAME: "example" }); }, /valid codespace name and port-forwarding domain/u);
	assert.throws(function _InvalidDomain() { tier3BrowserOrigins(4_200, { CODESPACES: "true", CODESPACE_NAME: "example", GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "attacker.example:443" }); }, /valid codespace name and port-forwarding domain/u);
});

test("rejects foreign Host even for safe reads before the proxy attaches credentials", function _BrowserHost()
{
	const allowed = ["http://127.0.0.1:4200", "https://example-codespace-4200.app.github.dev"];
	const localRead = { method: "GET", headers: { host: "127.0.0.1:4200" } };
	const codespacesRead = { method: "GET", headers: { host: "example-codespace-4200.app.github.dev:443" } };
	const forwardedRead = { method: "GET", headers: { host: "localhost:4200", "x-forwarded-host": "example-codespace-4200.app.github.dev", "x-forwarded-proto": "https" } };
	const rewrittenRead = {
		method: "GET",
		headers: {
			host: "localhost:4200",
			origin: "https://localhost:4200",
			referer: "https://example-codespace-4200.app.github.dev/",
			"sec-fetch-site": "same-origin",
			"x-forwarded-host": "example-codespace-4200.app.github.dev",
			"x-forwarded-proto": "https",
		},
	};
	const directRewrittenRead = { ...rewrittenRead, headers: { ...rewrittenRead.headers, host: "example-codespace-4200.app.github.dev", "x-forwarded-host": undefined, "x-forwarded-proto": undefined } };
	const githubNavigation = {
		method: "GET",
		headers: {
			host: "example-codespace-4200.app.github.dev",
			referer: "https://github.com/",
			"sec-fetch-dest": "document",
			"sec-fetch-mode": "navigate",
			"sec-fetch-site": "cross-site",
			"sec-fetch-user": "?1",
		},
	};
	const foreignRead = { method: "GET", headers: { host: "foreign.example", origin: "http://foreign.example" } };
	const foreignUpgrade = { method: "GET", headers: { host: "foreign.example", origin: "http://foreign.example", upgrade: "websocket" } };
	assert.equal(isAllowedTier3BrowserRequest(localRead, allowed), true);
	assert.equal(isAllowedTier3BrowserRequest(codespacesRead, allowed), true);
	assert.equal(isAllowedTier3BrowserRequest(forwardedRead, allowed), true);
	assert.equal(isAllowedTier3BrowserRequest(rewrittenRead, allowed), true);
	assert.equal(isAllowedTier3BrowserRequest(directRewrittenRead, allowed), true);
	assert.equal(isAllowedTier3BrowserRequest(githubNavigation, allowed), true);
	assert.equal(isAllowedTier3BrowserRequest({ ...githubNavigation, headers: { ...githubNavigation.headers, origin: "https://attacker.example" } }, allowed), false);
	assert.equal(isAllowedTier3BrowserRequest({ ...githubNavigation, headers: { ...githubNavigation.headers, referer: "https://attacker.example/lure" } }, allowed), false);
	assert.equal(isAllowedTier3BrowserRequest({ ...githubNavigation, headers: { ...githubNavigation.headers, host: "127.0.0.1:4200" } }, allowed), false);
	assert.equal(isAllowedTier3BrowserRequest({ ...githubNavigation, headers: { ...githubNavigation.headers, "sec-fetch-user": undefined } }, allowed), false);
	assert.equal(isAllowedTier3BrowserRequest({ ...githubNavigation, headers: { ...githubNavigation.headers, "sec-fetch-dest": "iframe" } }, allowed), false);
	assert.equal(isAllowedTier3BrowserRequest({ ...githubNavigation, headers: { ...githubNavigation.headers, "sec-fetch-mode": "no-cors" } }, allowed), false);
	assert.equal(isAllowedTier3BrowserRequest({ ...githubNavigation, headers: { ...githubNavigation.headers, "sec-fetch-site": "same-origin" } }, allowed), false);
	assert.equal(isAllowedTier3BrowserRequest({ ...githubNavigation, method: "HEAD" }, allowed), false);
	assert.equal(isAllowedTier3BrowserRequest({ ...rewrittenRead, headers: { ...rewrittenRead.headers, referer: undefined } }, allowed), false);
	assert.equal(isAllowedTier3BrowserRequest({ ...rewrittenRead, headers: { ...rewrittenRead.headers, referer: "https://attacker.example/" } }, allowed), false);
	assert.equal(isAllowedTier3BrowserRequest({ ...rewrittenRead, headers: { ...rewrittenRead.headers, "sec-fetch-site": "cross-site" } }, allowed), false);
	assert.equal(isAllowedTier3BrowserRequest({ ...rewrittenRead, headers: { ...rewrittenRead.headers, host: "127.0.0.1:4200", "x-forwarded-host": undefined, "x-forwarded-proto": undefined } }, allowed), false);
	assert.equal(isAllowedTier3BrowserRequest(foreignRead, allowed), false);
	assert.equal(isAllowedTier3BrowserRequest(foreignUpgrade, allowed), false);
	assert.equal(isAllowedTier3BrowserRequest({ method: "GET", headers: { host: "127.0.0.1:4200", origin: "http://foreign.example" } }, allowed), false);
	assert.equal(isAllowedTier3BrowserRequest({ method: "GET", headers: { host: "127.0.0.1:4200", referer: "http://foreign.example/" } }, allowed), false);
});

test("requires the mutation origin to match a coordinator-selected direct or forwarded authority", function _BrowserMutation()
{
	const allowed = ["http://127.0.0.1:4200", "https://example-codespace-4200.app.github.dev"];
	const local = { method: "POST", headers: { host: "127.0.0.1:4200", origin: "http://127.0.0.1:4200" } };
	const forwarded = {
		method: "POST",
		headers: {
			host: "localhost:4200",
			origin: "https://example-codespace-4200.app.github.dev",
			"x-forwarded-host": "example-codespace-4200.app.github.dev",
			"x-forwarded-proto": "https",
		},
	};
	const defaultHttpsPort = { method: "POST", headers: { host: "example-codespace-4200.app.github.dev:443", origin: "https://example-codespace-4200.app.github.dev" } };
	const rewritten = {
		method: "POST",
		headers: {
			host: "localhost:4200",
			origin: "https://localhost:4200",
			referer: "https://example-codespace-4200.app.github.dev/onboarding",
			"sec-fetch-site": "same-origin",
			"x-forwarded-host": "example-codespace-4200.app.github.dev",
			"x-forwarded-proto": "https",
		},
	};
	const foreignForward = { method: "POST", headers: { host: "localhost:4200", origin: "https://example-codespace-4200.app.github.dev", "x-forwarded-host": "foreign.example", "x-forwarded-proto": "https" } };
	const wrongForwardedProtocol = { method: "POST", headers: { host: "localhost:4200", origin: "https://example-codespace-4200.app.github.dev", "x-forwarded-host": "example-codespace-4200.app.github.dev", "x-forwarded-proto": "http" } };
	const forgedProtocol = { method: "POST", headers: { host: "127.0.0.1:4200", origin: "https://127.0.0.1:4200", "x-forwarded-proto": "https" } };
	const mismatchedHost = { method: "POST", headers: { host: "127.0.0.1:4200", origin: "https://example-codespace-4200.app.github.dev" } };
	const localReferer = { method: "POST", headers: { host: "127.0.0.1:4200", referer: "http://127.0.0.1:4200/onboarding" } };
	const missingUpgradeOrigin = { method: "GET", headers: { host: "127.0.0.1:4200", upgrade: "websocket" } };
	const refererOnlyUpgrade = { method: "GET", headers: { host: "127.0.0.1:4200", referer: "http://127.0.0.1:4200/onboarding", upgrade: "websocket" } };
	const otherUpgrade = { method: "GET", headers: { host: "127.0.0.1:4200", origin: "http://127.0.0.1:4200", upgrade: "h2c" } };
	assert.equal(isAllowedTier3BrowserRequest(local, allowed), true);
	assert.equal(isAllowedTier3BrowserRequest(forwarded, allowed), true);
	assert.equal(isAllowedTier3BrowserRequest(defaultHttpsPort, allowed), true);
	assert.equal(isAllowedTier3BrowserRequest(rewritten, allowed), true);
	assert.equal(isAllowedTier3BrowserRequest(localReferer, allowed), true);
	assert.equal(isAllowedTier3BrowserRequest(foreignForward, allowed), false);
	assert.equal(isAllowedTier3BrowserRequest(wrongForwardedProtocol, allowed), false);
	assert.equal(isAllowedTier3BrowserRequest(forgedProtocol, allowed), false);
	assert.equal(isAllowedTier3BrowserRequest(mismatchedHost, allowed), false);
	assert.equal(isAllowedTier3BrowserRequest(missingUpgradeOrigin, allowed), false);
	assert.equal(isAllowedTier3BrowserRequest(refererOnlyUpgrade, allowed), false);
	assert.equal(isAllowedTier3BrowserRequest(otherUpgrade, allowed), false);
	assert.equal(isAllowedTier3BrowserRequest({ method: "POST", headers: { host: "127.0.0.1:4200" } }, allowed), false);
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
		environment: { SMOKE_HOST_PROFILE: "recommended", SMOKE_PREREQUISITE_TIMEOUT_SECONDS: "900" },
		inspectResources: async function _Inspect() { return { existingOwner: null }; },
		measureCapacity: async function _Capacity() { return { cpu: 8, memoryGiB: 32, storageAvailableGiB: 80, storageGiB: 100 }; },
		readCertificate: async function _Certificate() { order.push("certificate"); return "certificate"; },
		runSmoke: async function _Smoke(environment) { order.push("smoke"); assert.equal(environment.SMOKE_HOST_PROFILE, "recommended"); assert.equal(environment.SMOKE_PREREQUISITE_TIMEOUT_SECONDS, "900"); assert.equal(environment.KEEP_CLUSTER, "1"); assert.match(environment.SMOKE_RESOURCE_OWNER, /^worktree-/u); },
		createProxy: function _Proxy(options) { order.push("proxy"); assert.equal(options.developmentCredential, null); assert.deepEqual(options.allowedBrowserOrigins, ["http://127.0.0.1:4200"]); return {}; },
		listenProxy: async function _Listen() { order.push("listen"); },
		waitForShutdown: async function _Shutdown() { order.push("shutdown"); },
		write: function _Write() {},
	});
	assert.deepEqual(order, ["smoke", "certificate", "proxy", "listen", "shutdown"]);
});

test("defaults Tier 3 qualification to the minimum host profile", async function _MinimumHostProfile()
{
	let smokeEnvironment;
	await runTier3Development(parseTier3Options(["--profile", "infra", "--smoke-only"]), {
		environment: {},
		inspectResources: async function _Inspect() { return { existingOwner: null }; },
		measureCapacity: async function _Capacity() { return { cpu: 4, memoryGiB: 16, storageAvailableGiB: 40, storageGiB: 40 }; },
		runSmoke: async function _Smoke(environment) { smokeEnvironment = environment; },
		write: function _Write() {},
	});
	assert.equal(smokeEnvironment.SMOKE_HOST_PROFILE, "minimum");
	assert.equal(smokeEnvironment.SMOKE_PREREQUISITE_TIMEOUT_SECONDS, "1800");
	assert.equal(smokeEnvironment.TIMEOUT_SECONDS, "600");
});

test("rejects invalid Codespaces forwarding identity before acquiring k3d resources", async function _CodespacesPreflight()
{
	let acquired = false;
	/** Records whether resource acquisition starts after browser-origin preflight. */
	async function _Inspect() { acquired = true; return { existingOwner: null }; }
	const operations = {
		environment: { CODESPACES: "true", CODESPACE_NAME: "example" },
		inspectResources: _Inspect,
	};
	await assert.rejects(runTier3Development(parseTier3Options(["--profile", "infra"]), operations), /valid codespace name and port-forwarding domain/u);
	assert.equal(acquired, false);
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
		prepareProviderCredentials: async function _Credentials() { return { provider: "openai", providerKey: "provider-key" }; },
		readCertificate: async function _Certificate() { return "certificate"; },
		runAgentJourney: async function _Journey() { order.push("journey"); throw new Error("qualification failed"); },
		runSmoke: async function _Smoke() {},
		write: function _Write() {},
	}), /qualification failed/u);
	assert.deepEqual(order, ["listen", "journey", "close"]);
});

test("removes every Codespaces provider key before Tier 3 child work", async function _CodespacesCredentialBoundary()
{
	const providerKey = "selected-provider-key";
	const environment = {
		CODESPACES: "true",
		CODESPACE_NAME: "example-codespace",
		GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev",
		ANTHROPIC_TIER3_PROVIDER_API_KEY: "unused-provider-key",
		OPENAI_TIER3_PROVIDER_API_KEY: providerKey,
	};
	let journeyInput;
	await runTier3Development(parseTier3Options(["--profile", "agent", "--provider", "openai"]), {
		createProxy: function _Proxy() { return {}; },
		environment,
		inspectResources: async function _Inspect() { return { existingOwner: null }; },
		listenProxy: async function _Listen() {},
		measureCapacity: async function _Capacity()
		{
			assert.equal("OPENAI_TIER3_PROVIDER_API_KEY" in environment, false);
			assert.equal("ANTHROPIC_TIER3_PROVIDER_API_KEY" in environment, false);
			return { cpu: 8, memoryGiB: 32, storageAvailableGiB: 80, storageGiB: 100 };
		},
		readCertificate: async function _Certificate() { return "certificate"; },
		runAgentJourney: async function _Journey(input) { journeyInput = input; },
		runSmoke: async function _Smoke(smokeEnvironment)
		{
			assert.equal("OPENAI_TIER3_PROVIDER_API_KEY" in smokeEnvironment, false);
			assert.equal("ANTHROPIC_TIER3_PROVIDER_API_KEY" in smokeEnvironment, false);
			assert.doesNotMatch(JSON.stringify(smokeEnvironment), /provider-key/u);
		},
		waitForShutdown: async function _Shutdown() {},
		write: function _Write() {},
	});
	assert.equal(journeyInput.provider, "openai");
	assert.equal(journeyInput.providerKey, providerKey);
});

test("keeps the shared smoke defaults compatible with CI", async function _SmokeContract()
{
	const source = await readFile(new URL("../../../apps/_infra/deploy-k8s/platform/tests/develop-smoke.sh", import.meta.url), "utf8");
	assert.match(source, /SMOKE_INGRESS_PORT="\$\{SMOKE_INGRESS_PORT:-8443\}"/u);
	assert.match(source, /SMOKE_PREREQUISITE_TIMEOUT_SECONDS="\$\{SMOKE_PREREQUISITE_TIMEOUT_SECONDS:-\$TIMEOUT_SECONDS\}"/u);
	assert.match(source, /SMOKE_RESOURCE_OWNER="\$\{SMOKE_RESOURCE_OWNER:-develop-smoke-\$\$\}"/u);
	assert.match(source, /--runtime-label "opencrane\.tier3\.owner=\$\{SMOKE_RESOURCE_OWNER\}@all"/u);
	assert.match(source, /_assert_owned_resource_set/u);
	assert.match(source, /--filter "label=k3d\.cluster=\$\{CLUSTER_NAME\}"/u);
	assert.match(source, /select\(\.Type == "volume"\)/u);
	assert.match(source, /SMOKE_REGISTRY_CONTAINER_ID="\$\(docker inspect --format '\{\{\.Id\}\}' "k3d-\$\{SMOKE_LOCAL_REGISTRY_NAME\}"\)"/u);
	assert.match(source, /if \[\[ "\$registry_id" != "\$SMOKE_REGISTRY_CONTAINER_ID" \]\]; then/u);
	assert.doesNotMatch(source, /docker rm -f -v/u);
	assert.doesNotMatch(source, /docker volume rm/u);
	assert.doesNotMatch(source, /opencrane\.develop-smoke=true/u);
	assert.match(source, /SMOKE_IMAGE_TAG="\$\{SMOKE_RESOURCE_OWNER\}-\$\$"/u);
	assert.match(source, /SMOKE_OWNER_IMAGE_LABEL="opencrane\.develop-smoke\.owner=\$\{SMOKE_RESOURCE_OWNER\}"/u);
	assert.match(source, /--assert-owned-resources\)/u);
	assert.match(source, /--prune-owned-images\)/u);
	assert.match(source, /docker image rm --no-prune "\$reference"/u);
	assert.match(source, /docker image prune --all --force --filter "label=\$\{SMOKE_OWNER_IMAGE_LABEL\}"/u);
	assert.match(source, /if \[\[ "\$KEEP_CLUSTER" == "1" && "\$SMOKE_CLUSTER_CREATED" == "1" \]\]; then/u);
	assert.match(source, /SMOKE_CLUSTER_CREATED=1/u);
	assert.match(source, /set -Eeuo pipefail/u);
	assert.match(source, /trap '_capture_failure "\$\?" "\$LINENO"' ERR/u);
	assert.match(source, /FAILURE: phase='\$\{SMOKE_FAILURE_PHASE:-unknown\}' line='\$\{SMOKE_FAILURE_LINE:-unknown\}' status='\$\{SMOKE_FAILURE_STATUS:-\$exit_code\}'/u);
	assert.match(source, /_start_phase "verify database authority isolation"/u);
	assert.match(source, /_start_phase "verify KurrentDB secure probe contract"/u);
	assert.match(source, /_start_phase "verify Agent Sandbox runtime resources"/u);
	assert.match(source, /_start_phase "verify public ingress health"/u);
	assert.equal((source.match(/_capture_failure "\$status" "\$LINENO"/gu) ?? []).length, 2);
	assert.match(source, /_start_phase "wait for cert-manager installation"/u);
	assert.equal((source.match(/--wait --timeout "\$\{SMOKE_PREREQUISITE_TIMEOUT_SECONDS\}s"/gu) ?? []).length, 2);
	assert.match(source, /_start_phase "prepare candidate images"/u);
});

test("smoke ownership mode fails closed on orphans, foreign nodes, volumes, and Docker errors", function _SmokeOwnershipBehavior()
{
	const clean = _RunFakeSmokeGuard("clean");
	assert.equal(clean.status, 0, clean.stderr);
	const orphan = _RunFakeSmokeGuard("orphan");
	assert.notEqual(orphan.status, 0);
	assert.match(orphan.stderr, /unproved orphan nodes or image storage/u);
	const foreign = _RunFakeSmokeGuard("foreign-node");
	assert.notEqual(foreign.status, 0);
	assert.match(foreign.stderr, /Refusing unproved k3d cluster member/u);
	const volume = _RunFakeSmokeGuard("extra-volume");
	assert.notEqual(volume.status, 0);
	assert.match(volume.stderr, /Refusing unproved k3d volume/u);
	const unavailable = _RunFakeSmokeGuard("docker-failure");
	assert.notEqual(unavailable.status, 0);
});

test("pins the Tier 3 devcontainer tools for amd64 and arm64", async function _DevcontainerContract()
{
	const source = await readFile(new URL("../../../.devcontainer/Dockerfile", import.meta.url), "utf8");
	const tier3 = JSON.parse(await readFile(new URL("../../../.devcontainer/devcontainer.json", import.meta.url), "utf8"));
	const tier2 = JSON.parse(await readFile(new URL("../../../.devcontainer/tier2/devcontainer.json", import.meta.url), "utf8"));
	assert.match(source, /ARG TARGETARCH/u);
	assert.match(source, /amd64\) HELM_SHA256="\$\{HELM_SHA256_AMD64\}"; K3D_SHA256="\$\{K3D_SHA256_AMD64\}"; KUBECTL_SHA256="\$\{KUBECTL_SHA256_AMD64\}"/u);
	assert.match(source, /arm64\) HELM_SHA256="\$\{HELM_SHA256_ARM64\}"; K3D_SHA256="\$\{K3D_SHA256_ARM64\}"; KUBECTL_SHA256="\$\{KUBECTL_SHA256_ARM64\}"/u);
	assert.match(source, /Unsupported Tier 3 devcontainer architecture/u);
	assert.match(source, /helm-\$\{HELM_VERSION\}-linux-\$\{TARGETARCH\}\.tar\.gz/u);
	assert.match(source, /k3d-linux-\$\{TARGETARCH\}/u);
	assert.match(source, /bin\/linux\/\$\{TARGETARCH\}\/kubectl/u);
	assert.equal((source.match(/sha256sum --check -/gu) ?? []).length, 3);
	assert.deepEqual(Object.keys(tier3.secrets).sort(), [
		"ANTHROPIC_TIER3_PROVIDER_API_KEY",
		"DEEPSEEK_TIER3_PROVIDER_API_KEY",
		"GEMINI_TIER3_PROVIDER_API_KEY",
		"GLM_TIER3_PROVIDER_API_KEY",
		"MISTRAL_TIER3_PROVIDER_API_KEY",
		"OPENAI_TIER3_PROVIDER_API_KEY",
	]);
	assert.equal("OPENCRANE_TIER3_DEFAULT_PROVIDER" in tier3.secrets, false);
	assert.equal("OPENCRANE_TIER2_DEFAULT_PROVIDER" in tier2.secrets, false);
});
