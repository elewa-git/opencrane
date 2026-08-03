import { describe, expect, it } from "vitest";

import { _ReadConfig } from "../config.js";

/** Build a complete private gateway environment with one intended override. */
function _Environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv
{
	return { PORT: "8080", COGNEE_URL: "http://opencrane-cognee.default.svc.cluster.local:8000", POD_NAMESPACE: "default", SERVER_SERVICE_ACCOUNT_NAME: "opencrane-opencrane-server", SERVER_TOKEN_AUDIENCE: "opencrane-memory-gateway", REQUEST_TIMEOUT_MS: "30000", ...overrides };
}

describe("memory gateway configuration", function _suite()
{
	it("accepts the private release-local Cognee route and exact server identity", function _accepts()
	{
		expect(_ReadConfig(_Environment())).toMatchObject({ port: 8080, namespace: "default", serverServiceAccountName: "opencrane-opencrane-server" });
	});

	it("rejects a non-private Cognee route before starting the gateway", function _rejectsExternalRoute()
	{
		expect(function _external() { _ReadConfig(_Environment({ COGNEE_URL: "https://cognee.example.test" })); }).toThrow(/in-cluster HTTP service origin/);
	});

	it("rejects a missing caller identity instead of admitting every server token", function _rejectsIdentity()
	{
		expect(function _missing() { _ReadConfig(_Environment({ SERVER_SERVICE_ACCOUNT_NAME: "" })); }).toThrow(/SERVER_SERVICE_ACCOUNT_NAME/);
	});
});
