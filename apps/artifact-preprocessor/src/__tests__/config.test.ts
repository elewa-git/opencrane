import { describe, expect, it } from "vitest";

import { _ReadConfig } from "../config";

/** Verify configuration fails closed around the mounted projected-token and scratch paths. */
describe("artifact preprocessor configuration", function _suite()
{
	it("accepts bounded explicit process values", function _reads()
	{
		const config = _ReadConfig({ OPENCRANE_INTERNAL_URL: "http://opencrane-server.default.svc.cluster.local:8081", OPENCRANE_PREPROCESSOR_TOKEN_PATH: "/var/run/opencrane/tokens/opencrane.token", ARTIFACT_PREPROCESSOR_SCRATCH_DIRECTORY: "/scratch", ARTIFACT_PREPROCESSOR_MAX_SOURCE_BYTES: "2000", ARTIFACT_PREPROCESSOR_MAX_OUTPUT_BYTES: "1200" });
		expect(config).toMatchObject({ maximumSourceBytes: 2_000, maximumOutputBytes: 1_200, pollIntervalMilliseconds: 1_000 });
	});

	it("rejects a relative projected-token path", function _rejectsRelativeToken()
	{
		expect(function _read() { _ReadConfig({ OPENCRANE_INTERNAL_URL: "http://opencrane-server.default.svc.cluster.local:8081", OPENCRANE_PREPROCESSOR_TOKEN_PATH: "token", ARTIFACT_PREPROCESSOR_SCRATCH_DIRECTORY: "/scratch" }); }).toThrow("OPENCRANE_PREPROCESSOR_TOKEN_PATH must be absolute");
	});

	it("rejects a broker origin outside the same cluster trust boundary", function _RejectsExternalBroker()
	{
		expect(function _Read() { _ReadConfig({ OPENCRANE_INTERNAL_URL: "https://example.test", OPENCRANE_PREPROCESSOR_TOKEN_PATH: "/token", ARTIFACT_PREPROCESSOR_SCRATCH_DIRECTORY: "/scratch" }); }).toThrow("credential-free cluster-local HTTP origin");
	});
});
