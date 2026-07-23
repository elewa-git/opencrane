import { describe, expect, it } from "vitest";

import { _ReadConfig } from "../config.js";

/** Verify configuration fails closed around the mounted projected-token and scratch paths. */
describe("artifact preprocessor configuration", function _suite()
{
	it("accepts bounded explicit process values", function _reads()
	{
		const config = _ReadConfig({ OPENCRANE_INTERNAL_URL: "http://server", ARTIFACT_SERVICE_URL: "http://artifact-service", OPENCRANE_PREPROCESSOR_TOKEN_PATH: "/var/run/opencrane/tokens/opencrane.token", ARTIFACT_PREPROCESSOR_SCRATCH_DIRECTORY: "/scratch", ARTIFACT_PREPROCESSOR_MAX_SOURCE_BYTES: "200", ARTIFACT_PREPROCESSOR_MAX_OUTPUT_BYTES: "100" });
		expect(config).toMatchObject({ maximumSourceBytes: 200, maximumOutputBytes: 100, pollIntervalMilliseconds: 1_000 });
	});

	it("rejects a relative projected-token path", function _rejectsRelativeToken()
	{
		expect(function _read() { _ReadConfig({ OPENCRANE_INTERNAL_URL: "http://server", ARTIFACT_SERVICE_URL: "http://artifact-service", OPENCRANE_PREPROCESSOR_TOKEN_PATH: "token", ARTIFACT_PREPROCESSOR_SCRATCH_DIRECTORY: "/scratch" }); }).toThrow("OPENCRANE_PREPROCESSOR_TOKEN_PATH must be absolute");
	});
});
