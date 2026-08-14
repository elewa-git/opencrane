import { describe, expect, it } from "vitest";

import { _ReadConfig } from "../config";

describe("artifact scanner config", () =>
{
	it("defaults to the approved 200 MiB message ceiling", () =>
	{
		const config = _ReadConfig({ OPENCRANE_INTERNAL_URL: "http://opencrane.default.svc.cluster.local:8081", OPENCRANE_SCANNER_TOKEN_PATH: "/tokens/token", ARTIFACT_SCANNER_SCRATCH_DIRECTORY: "/scratch", ARTIFACT_SCANNER_EXECUTABLE_PATH: "/usr/local/bin/clamscan", ARTIFACT_SCANNER_DATABASE_PATH: "/opt/opencrane/clamav-db", ARTIFACT_SCANNER_VERSION: "clamav-1.5.2-pinned" });
		expect(config.maximumSourceBytes).toBe(209_715_200);
	});

	it("rejects public broker origins", () =>
	{
		expect(() => _ReadConfig({ OPENCRANE_INTERNAL_URL: "https://example.com" })).toThrow("cluster-local");
	});
});
