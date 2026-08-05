import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _ReadProcessConfig } from "../config.js";

describe("opencrane process config", function _ProcessConfigSuite()
{
	beforeEach(function _stubRequiredMemoryGatewayEnvironment()
	{
		vi.stubEnv("MEMORY_GATEWAY_URL", "http://opencrane-memory-gateway.default.svc.cluster.local:8080");
		vi.stubEnv("MEMORY_GATEWAY_TOKEN_PATH", "/var/run/opencrane/memory-gateway/token");
	});

	afterEach(function _restoreEnvironment()
	{
		vi.unstubAllEnvs();
	});

	it("reads one shared snapshot for listeners and background workers", function _ReadSnapshot()
	{
		vi.stubEnv("PORT", "9080");
		vi.stubEnv("INTERNAL_PORT", "9081");
		vi.stubEnv("WATCH_NAMESPACE", "workspace-seeds");
		vi.stubEnv("AGENT_RUNTIME_PERSONAL_NAMESPACE", "personal-runs");
		vi.stubEnv("AGENT_RUNTIME_MANAGED_NAMESPACE", "managed-runs");
		vi.stubEnv("OPENCRANE_SCHEDULER_ENABLED", "true");
		vi.stubEnv("OPENCRANE_SCHEDULER_INTERVAL_MS", "2500");

		expect(_ReadProcessConfig()).toMatchObject({
			authWatchNamespace: "workspace-seeds",
			internalPort: 9081,
			publicPort: 9080,
			runtime: {
				managedRuntimeNamespace: "managed-runs",
				memoryGatewayTimeoutMilliseconds: 30_000,
				memoryGatewayTokenPath: "/var/run/opencrane/memory-gateway/token",
				memoryGatewayUrl: "http://opencrane-memory-gateway.default.svc.cluster.local:8080",
				personalRuntimeNamespace: "personal-runs",
			},
			schedulerEnabled: true,
			schedulerIntervalMilliseconds: 2500,
		});
	});

	it("composes the obot block only when both coordinates are present", function _ReadObotBlock()
	{
		expect(_ReadProcessConfig().obot).toBeNull();

		vi.stubEnv("OBOT_GATEWAY_URL", "http://oc-mcp-gateway.silo.svc.cluster.local:8080");
		vi.stubEnv("OBOT_SERVICE_TOKEN_PATH", "/var/run/opencrane/obot/token");
		expect(_ReadProcessConfig().obot).toEqual({ gatewayUrl: "http://oc-mcp-gateway.silo.svc.cluster.local:8080", serviceTokenPath: "/var/run/opencrane/obot/token", requestTimeoutMilliseconds: 30_000 });
	});

	it("refuses a partial obot block or a relative token path at startup", function _RejectPartialObotBlock()
	{
		vi.stubEnv("OBOT_GATEWAY_URL", "http://oc-mcp-gateway.silo.svc.cluster.local:8080");
		expect(function _readPartialObot() { _ReadProcessConfig(); }).toThrow(/configured together/);

		vi.stubEnv("OBOT_SERVICE_TOKEN_PATH", "relative/token");
		expect(function _readRelativeTokenPath() { _ReadProcessConfig(); }).toThrow(/absolute/);
	});

	it("rejects an artifact output ceiling outside the broker boundary", function _RejectInvalidBodyLimit()
	{
		vi.stubEnv("ARTIFACT_PREPROCESSOR_MAX_OUTPUT_BYTES", "67108865");
		expect(function _readInvalidConfig() { _ReadProcessConfig(); }).toThrow(/integer from 1024 through 67108864/);
	});

	it("fails boot when the memory-gateway origin or token path is missing", function _RejectMissingMemoryGateway()
	{
		vi.stubEnv("MEMORY_GATEWAY_URL", "");
		expect(function _readWithoutGatewayUrl() { _ReadProcessConfig(); }).toThrow(/MEMORY_GATEWAY_URL is required/);

		vi.stubEnv("MEMORY_GATEWAY_URL", "http://opencrane-memory-gateway.default.svc.cluster.local:8080");
		vi.stubEnv("MEMORY_GATEWAY_TOKEN_PATH", "");
		expect(function _readWithoutTokenPath() { _ReadProcessConfig(); }).toThrow(/MEMORY_GATEWAY_TOKEN_PATH is required/);
	});

	it("rejects a relative memory-gateway token path and an out-of-bounds timeout", function _RejectInvalidMemoryGatewaySettings()
	{
		vi.stubEnv("MEMORY_GATEWAY_TOKEN_PATH", "var/run/token");
		expect(function _readRelativeTokenPath() { _ReadProcessConfig(); }).toThrow(/MEMORY_GATEWAY_TOKEN_PATH must be an absolute path/);

		vi.stubEnv("MEMORY_GATEWAY_TOKEN_PATH", "/var/run/opencrane/memory-gateway/token");
		vi.stubEnv("MEMORY_GATEWAY_TIMEOUT_SECONDS", "301");
		expect(function _readExcessiveTimeout() { _ReadProcessConfig(); }).toThrow(/integer from 1 through 300/);
	});

	it("rejects malformed or excessive scheduler intervals before a tight loop can start", function _RejectInvalidSchedulerInterval()
	{
		vi.stubEnv("OPENCRANE_SCHEDULER_INTERVAL_MS", "bad");
		expect(function _readMalformedInterval() { _ReadProcessConfig(); }).toThrow(/integer from 1000 through 3600000/);

		vi.stubEnv("OPENCRANE_SCHEDULER_INTERVAL_MS", "3600001");
		expect(function _readExcessiveInterval() { _ReadProcessConfig(); }).toThrow(/integer from 1000 through 3600000/);
	});
});
