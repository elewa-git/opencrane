import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { _LoadOperatorConfig } from "../app/config.js";

/** Minimal mandatory env so `_LoadOperatorConfig` reaches the multi-instance guard. */
const _BASE_ENV: Record<string, string> = {
	TENANT_DEFAULT_IMAGE: "ghcr.io/opencrane/tenant:latest",
	INGRESS_DOMAIN: "ai.example.com",
	GATEWAY_PORT: "8080",
	IDLE_TIMEOUT_MINUTES: "30",
	IDLE_CHECK_INTERVAL_SECONDS: "60",
	LITELLM_ENABLED: "false",
	LITELLM_ENDPOINT: "http://litellm:4000",
	LITELLM_DEFAULT_MONTHLY_BUDGET_USD: "100",
};

describe("_LoadOperatorConfig multi-instance fail-closed guard (MI.1 / brief B2)", function _suite()
{
	let _saved: NodeJS.ProcessEnv;

	beforeEach(function _save()
	{
		_saved = process.env;
		process.env = { ..._BASE_ENV };
	});

	afterEach(function _restore()
	{
		process.env = _saved;
	});

	it("throws when REQUIRE_WATCH_NAMESPACE is true and WATCH_NAMESPACE is empty", function _failClosed()
	{
		process.env.WATCH_NAMESPACE = "";
		process.env.REQUIRE_WATCH_NAMESPACE = "true";
		expect(function _load() { _LoadOperatorConfig(); }).toThrow(/refusing to watch all namespaces/);
	});

	it("throws when WATCH_NAMESPACE is only whitespace under the guard", function _whitespace()
	{
		process.env.WATCH_NAMESPACE = "   ";
		process.env.REQUIRE_WATCH_NAMESPACE = "true";
		expect(function _load() { _LoadOperatorConfig(); }).toThrow(/refusing to watch all namespaces/);
	});

	it("loads a scoped namespace under the guard", function _scoped()
	{
		process.env.WATCH_NAMESPACE = "oc-acme";
		process.env.REQUIRE_WATCH_NAMESPACE = "true";
		const config = _LoadOperatorConfig();
		expect(config.watchNamespace).toBe("oc-acme");
		expect(config.requireWatchNamespace).toBe(true);
	});

	it("allows an empty watch namespace when the guard is off (legacy single-install)", function _legacy()
	{
		process.env.WATCH_NAMESPACE = "";
		// REQUIRE_WATCH_NAMESPACE unset → defaults to false.
		const config = _LoadOperatorConfig();
		expect(config.watchNamespace).toBe("");
		expect(config.requireWatchNamespace).toBe(false);
	});

	it("derives runtime-plane URL fallbacks from POD_NAMESPACE, not a shared namespace (B5)", function _podNamespaceFallback()
	{
		process.env.WATCH_NAMESPACE = "oc-acme";
		process.env.POD_NAMESPACE = "oc-acme";
		// Runtime-plane URL env vars are intentionally unset so the fallbacks are exercised.
		const config = _LoadOperatorConfig();
		expect(config.mcpGatewayUrl).toBe("http://opencrane-mcp-gateway.oc-acme.svc:8080");
		// The pod-facing internal URL is namespace-derived (Service DNS on the internal port).
		expect(config.controlPlaneInternalServiceUrl).toBe("http://opencrane-opencrane-server.oc-acme.svc:8081");
		// The operator's OWN internal call is a localhost self-call — not namespace-derived.
		expect(config.controlPlaneInternalUrl).toBe("http://localhost:8081");
	});

	it("falls back to the `default` namespace when POD_NAMESPACE is unset", function _defaultNamespaceFallback()
	{
		process.env.WATCH_NAMESPACE = "oc-acme";
		// POD_NAMESPACE unset → fallback host is `default`, never `opencrane-system`.
		const config = _LoadOperatorConfig();
		expect(config.mcpGatewayUrl).toBe("http://opencrane-mcp-gateway.default.svc:8080");
		expect(config.controlPlaneInternalServiceUrl).toContain(".default.svc:");
	});
});

describe("_LoadOperatorConfig trusted-proxy fail-closed wiring (OC-2 / CONN.4)", function _trustedProxySuite()
{
	let _saved: NodeJS.ProcessEnv;

	beforeEach(function _save()
	{
		_saved = process.env;
		// WATCH_NAMESPACE is mandatory; set it so config load reaches the build step.
		process.env = { ..._BASE_ENV, WATCH_NAMESPACE: "oc-acme" };
	});

	afterEach(function _restore()
	{
		process.env = _saved;
	});

	it("resolves an unset GATEWAY_TRUSTED_PROXIES to trust-nothing (never trust-all)", function _unset()
	{
		// GATEWAY_TRUSTED_PROXIES intentionally absent from _BASE_ENV.
		const config = _LoadOperatorConfig();
		expect(config.gatewayTrustedProxies).toEqual([]);
		expect(config.gatewayTrustNothing).toBe(true);
	});

	it("resolves an empty GATEWAY_TRUSTED_PROXIES to trust-nothing", function _empty()
	{
		process.env.GATEWAY_TRUSTED_PROXIES = "  ";
		const config = _LoadOperatorConfig();
		expect(config.gatewayTrustedProxies).toEqual([]);
		expect(config.gatewayTrustNothing).toBe(true);
	});

	it("parses a configured CIDR allowlist and clears the trust-nothing flag", function _configured()
	{
		process.env.GATEWAY_TRUSTED_PROXIES = "10.55.128.0/17, 192.168.1.0/24";
		const config = _LoadOperatorConfig();
		expect(config.gatewayTrustedProxies).toEqual(["10.55.128.0/17", "192.168.1.0/24"]);
		expect(config.gatewayTrustNothing).toBe(false);
	});

	it("crashes config load on a malformed CIDR rather than shifting the trust boundary", function _malformed()
	{
		process.env.GATEWAY_TRUSTED_PROXIES = "10.55.128.0/99";
		expect(function _load() { _LoadOperatorConfig(); }).toThrow(/invalid IP\/CIDR entry/);
	});
});

describe("_LoadOperatorConfig auto trusted-proxy derivation (task_845dd617)", function _autoSuite()
{
	let _saved: NodeJS.ProcessEnv;

	beforeEach(function _save()
	{
		_saved = process.env;
		process.env = { ..._BASE_ENV, WATCH_NAMESPACE: "oc-acme" };
	});

	afterEach(function _restore()
	{
		process.env = _saved;
	});

	it("expands `auto` to the POD_IP /14 pod range by default", function _autoDefault()
	{
		process.env.GATEWAY_TRUSTED_PROXIES = "auto";
		process.env.POD_IP = "10.8.3.5";
		const config = _LoadOperatorConfig();
		expect(config.gatewayTrustedProxies).toEqual(["10.8.0.0/14"]);
		expect(config.gatewayTrustNothing).toBe(false);
	});

	it("honours GATEWAY_TRUSTED_PROXIES_AUTO_MASK for the derived prefix", function _autoMask()
	{
		process.env.GATEWAY_TRUSTED_PROXIES = "auto";
		process.env.POD_IP = "172.20.55.7";
		process.env.GATEWAY_TRUSTED_PROXIES_AUTO_MASK = "16";
		const config = _LoadOperatorConfig();
		expect(config.gatewayTrustedProxies).toEqual(["172.20.0.0/16"]);
	});

	it("drops `auto` to trust-nothing when POD_IP is missing (stays fail-closed, never trust-all)", function _missingPodIp()
	{
		process.env.GATEWAY_TRUSTED_PROXIES = "auto";
		// POD_IP intentionally absent.
		const config = _LoadOperatorConfig();
		expect(config.gatewayTrustedProxies).toEqual([]);
		expect(config.gatewayTrustNothing).toBe(true);
	});

	it("drops `auto` to trust-nothing when POD_IP is not a valid IPv4 address", function _invalidPodIp()
	{
		process.env.GATEWAY_TRUSTED_PROXIES = "auto";
		process.env.POD_IP = "fd00::1";
		const config = _LoadOperatorConfig();
		expect(config.gatewayTrustNothing).toBe(true);
	});

	it("keeps explicit CIDRs when `auto` derivation fails (partial fallback, no trust-all)", function _mixedFallback()
	{
		process.env.GATEWAY_TRUSTED_PROXIES = "auto, 10.0.0.0/8";
		// POD_IP absent ⇒ the auto token is dropped, the explicit CIDR remains.
		const config = _LoadOperatorConfig();
		expect(config.gatewayTrustedProxies).toEqual(["10.0.0.0/8"]);
		expect(config.gatewayTrustNothing).toBe(false);
	});

	it("falls back to the default /14 when the mask override is not a canonical integer", function _badMask()
	{
		process.env.GATEWAY_TRUSTED_PROXIES = "auto";
		process.env.POD_IP = "10.8.3.5";
		process.env.GATEWAY_TRUSTED_PROXIES_AUTO_MASK = "0xff";
		const config = _LoadOperatorConfig();
		expect(config.gatewayTrustedProxies).toEqual(["10.8.0.0/14"]);
	});
});

describe("_LoadOperatorConfig manageOwnDomain standalone-domain-ownership default (#151 item 2)", function _domainSuite()
{
	let _saved: NodeJS.ProcessEnv;

	beforeEach(function _save()
	{
		_saved = process.env;
		process.env = { ..._BASE_ENV };
	});

	afterEach(function _restore()
	{
		process.env = _saved;
	});

	it("defaults manageOwnDomain to true when FLEET_INTERNAL_URL is unset (standalone: no fleet to own the domain)", function _standalone()
	{
		process.env.WATCH_NAMESPACE = "oc-acme";
		const config = _LoadOperatorConfig();
		expect(config.manageOwnDomain).toBe(true);
	});

	it("defaults manageOwnDomain to false when FLEET_INTERNAL_URL is set (fleet-managed: fleet owns the domain)", function _fleetManaged()
	{
		process.env.WATCH_NAMESPACE = "oc-acme";
		process.env.FLEET_INTERNAL_URL = "http://fleet-manager.fleet.svc:8080";
		const config = _LoadOperatorConfig();
		expect(config.manageOwnDomain).toBe(false);
	});

	it("an explicit MANAGE_OWN_DOMAIN overrides the FLEET_INTERNAL_URL-derived default", function _explicitOverride()
	{
		process.env.WATCH_NAMESPACE = "oc-acme";
		process.env.FLEET_INTERNAL_URL = "http://fleet-manager.fleet.svc:8080";
		process.env.MANAGE_OWN_DOMAIN = "true";
		const config = _LoadOperatorConfig();
		expect(config.manageOwnDomain).toBe(true);
	});

	it("an explicit MANAGE_OWN_DOMAIN=false wins even when standalone (no FLEET_INTERNAL_URL)", function _explicitOverrideFalse()
	{
		process.env.WATCH_NAMESPACE = "oc-acme";
		process.env.MANAGE_OWN_DOMAIN = "false";
		const config = _LoadOperatorConfig();
		expect(config.manageOwnDomain).toBe(false);
	});
});

describe("_LoadOperatorConfig deploymentMode single switch (#151 item 4)", function _deploymentModeSuite()
{
	let _saved: NodeJS.ProcessEnv;

	beforeEach(function _save()
	{
		_saved = process.env;
		process.env = { ..._BASE_ENV };
	});

	afterEach(function _restore()
	{
		process.env = _saved;
	});

	it("derives standalone when neither DEPLOYMENT_MODE nor FLEET_INTERNAL_URL is set", function _derivedStandalone()
	{
		process.env.WATCH_NAMESPACE = "oc-acme";
		const config = _LoadOperatorConfig();
		expect(config.deploymentMode).toBe("standalone");
		expect(config.manageTenantNamespaces).toBe(true);
		expect(config.manageOwnDomain).toBe(true);
	});

	it("derives fleet-managed when FLEET_INTERNAL_URL is set", function _derivedFleetManaged()
	{
		process.env.WATCH_NAMESPACE = "oc-acme";
		process.env.FLEET_INTERNAL_URL = "http://fleet-manager.fleet.svc:8080";
		const config = _LoadOperatorConfig();
		expect(config.deploymentMode).toBe("fleet-managed");
		expect(config.manageTenantNamespaces).toBe(false);
		expect(config.manageOwnDomain).toBe(false);
	});

	it("an explicit DEPLOYMENT_MODE=fleet-managed wins even with no FLEET_INTERNAL_URL", function _explicitFleetManaged()
	{
		process.env.WATCH_NAMESPACE = "oc-acme";
		process.env.DEPLOYMENT_MODE = "fleet-managed";
		const config = _LoadOperatorConfig();
		expect(config.deploymentMode).toBe("fleet-managed");
		expect(config.manageTenantNamespaces).toBe(false);
		expect(config.manageOwnDomain).toBe(false);
	});

	it("an explicit DEPLOYMENT_MODE=standalone wins even with FLEET_INTERNAL_URL set", function _explicitStandalone()
	{
		process.env.WATCH_NAMESPACE = "oc-acme";
		process.env.FLEET_INTERNAL_URL = "http://fleet-manager.fleet.svc:8080";
		process.env.DEPLOYMENT_MODE = "standalone";
		const config = _LoadOperatorConfig();
		expect(config.deploymentMode).toBe("standalone");
	});

	it("MANAGE_TENANT_NAMESPACES / MANAGE_OWN_DOMAIN still override the deploymentMode-derived default", function _individualOverridesStillWin()
	{
		process.env.WATCH_NAMESPACE = "oc-acme";
		process.env.DEPLOYMENT_MODE = "standalone";
		process.env.MANAGE_TENANT_NAMESPACES = "false";
		process.env.MANAGE_OWN_DOMAIN = "false";
		const config = _LoadOperatorConfig();
		expect(config.manageTenantNamespaces).toBe(false);
		expect(config.manageOwnDomain).toBe(false);
	});

	it("standalone self-seed config defaults to empty/shared and reads CLUSTER_TENANT_SEED_* overrides", function _standaloneSeedEnv()
	{
		process.env.WATCH_NAMESPACE = "oc-acme";
		process.env.CLUSTER_TENANT_SEED_NAME = "acme";
		process.env.CLUSTER_TENANT_SEED_OWNER_EMAIL = "owner@acme.test";
		const config = _LoadOperatorConfig();
		expect(config.standaloneSeedName).toBe("acme");
		expect(config.standaloneSeedOwnerEmail).toBe("owner@acme.test");
		expect(config.standaloneSeedTier).toBe("shared");
	});
});
