import { describe, expect, it } from "vitest";

import { _ReadConfig } from "../config";

/** Return the complete minimum environment supplied by the MCP Job launcher. */
function _Environment(): NodeJS.ProcessEnv
{
	return { OPENCRANE_MCP_EXECUTOR_URL: "http://opencrane-server.opencrane.svc.cluster.local:8081/api/internal/mcp-executor", OPENCRANE_MCP_SERVER_URL: "http://127.0.0.1:3000/mcp", OPENCRANE_MCP_TOKEN_PATH: "/tokens/executor.token", OPENCRANE_MCP_CLAIM_REFERENCE_PATH: "/claim/reference", POD_UID: "pod-uid" };
}

describe("MCP executor config", function _DescribeConfig()
{
	it("accepts only the launcher-owned endpoints and bounded defaults", function _AcceptsLauncherConfig()
	{
		const config = _ReadConfig(_Environment());
		expect(config).toMatchObject({ openCraneTimeoutMilliseconds: 15_000, serverTimeoutMilliseconds: 60_000, commandByteLimit: 1_048_576, resultByteLimit: 4_194_304, reportByteLimit: 4_456_448 });
	});

	it("rejects widened OpenCrane and uploaded-server destinations", function _RejectsWidenedDestinations()
	{
		expect(function _PublicServer() { _ReadConfig({ ..._Environment(), OPENCRANE_MCP_EXECUTOR_URL: "https://example.com/api/internal/mcp-executor" }); }).toThrow(/cluster-local/u);
		expect(function _RemoteMcp() { _ReadConfig({ ..._Environment(), OPENCRANE_MCP_SERVER_URL: "http://10.0.0.1:3000/mcp" }); }).toThrow(/127\.0\.0\.1/u);
	});
});
