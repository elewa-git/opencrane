import { afterEach, describe, expect, it, vi } from "vitest";

import { _ReadProcessConfig } from "../config.js";

describe("opencrane process config", function _ProcessConfigSuite()
{
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
				personalRuntimeNamespace: "personal-runs",
			},
			schedulerEnabled: true,
			schedulerIntervalMilliseconds: 2500,
		});
	});

	it("rejects an artifact output ceiling outside the broker boundary", function _RejectInvalidBodyLimit()
	{
		vi.stubEnv("ARTIFACT_PREPROCESSOR_MAX_OUTPUT_BYTES", "67108865");
		expect(function _readInvalidConfig() { _ReadProcessConfig(); }).toThrow(/integer from 1024 through 67108864/);
	});

	it("rejects malformed or excessive scheduler intervals before a tight loop can start", function _RejectInvalidSchedulerInterval()
	{
		vi.stubEnv("OPENCRANE_SCHEDULER_INTERVAL_MS", "bad");
		expect(function _readMalformedInterval() { _ReadProcessConfig(); }).toThrow(/integer from 1000 through 3600000/);

		vi.stubEnv("OPENCRANE_SCHEDULER_INTERVAL_MS", "3600001");
		expect(function _readExcessiveInterval() { _ReadProcessConfig(); }).toThrow(/integer from 1000 through 3600000/);
	});
});
