import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _ReadMcpConnectionConfig } from "../mcp-connection-config";

describe("remote MCP process coordinates", function _Suite()
{
	beforeEach(function _Environment()
	{
		vi.stubEnv("MCP_CONNECTION_CREDENTIAL_NAMESPACE", "release-mcp-credentials");
		vi.stubEnv("POD_NAMESPACE", "server-namespace");
		vi.stubEnv("POD_UID", "server-pod-1");
		vi.stubEnv("MCP_SERVER_SERVICE_ACCOUNT_NAME", "opencrane-server");
		vi.stubEnv("MCP_CONNECTION_MATERIAL_KEYRING_PATH", "/var/run/mcp/keyring.json");
		vi.stubEnv("MCP_SERVER_TOKEN_PATH", "/var/run/mcp-server/token");
	});

	afterEach(function _Restore() { vi.unstubAllEnvs(); });

	it("keeps credential custody outside the namespace containing server keys", function _SeparateCustody()
	{
		expect(_ReadMcpConnectionConfig()).toEqual({ credentialNamespace: "release-mcp-credentials", serverNamespace: "server-namespace", serverPodUid: "server-pod-1", serverServiceAccountName: "opencrane-server", materialKeyringPath: "/var/run/mcp/keyring.json", tokenPath: "/var/run/mcp-server/token" });
		vi.stubEnv("MCP_CONNECTION_CREDENTIAL_NAMESPACE", "server-namespace");
		expect(_ReadMcpConnectionConfig).toThrow("namespace separate from the server");
	});

	it.each(["MCP_CONNECTION_CREDENTIAL_NAMESPACE", "POD_NAMESPACE", "MCP_SERVER_SERVICE_ACCOUNT_NAME"])("rejects an invalid Kubernetes coordinate in %s", function _InvalidCoordinate(name)
	{
		vi.stubEnv(name, "../another-namespace");
		expect(_ReadMcpConnectionConfig).toThrow("Kubernetes DNS label");
	});

	it.each(["MCP_CONNECTION_MATERIAL_KEYRING_PATH", "MCP_SERVER_TOKEN_PATH"])("rejects a relative mounted path in %s", function _RelativePath(name)
	{
		vi.stubEnv(name, "relative-file");
		expect(_ReadMcpConnectionConfig).toThrow("absolute mounted file path");
	});

	it("requires the actual server Pod coordinate", function _MissingPod()
	{
		vi.stubEnv("POD_UID", "");
		expect(_ReadMcpConnectionConfig).toThrow("POD_UID is required");
	});
});
