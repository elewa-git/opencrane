import { describe, expect, it } from "vitest";

import { _ReadConfig } from "../config";

/** Build a complete private gateway environment with one intended override. */
function _Environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv
{
	return { PORT: "8080", COGNEE_URL: "http://opencrane-cognee.default.svc.cluster.local:8000", COGNEE_CREDENTIAL_EMAIL_PATH: "/var/run/opencrane/cognee/email", COGNEE_CREDENTIAL_PASSWORD_PATH: "/var/run/opencrane/cognee/password", COGNEE_ALLOW_FIRST_INSTALL_REGISTRATION: "true", POD_NAMESPACE: "default", SERVER_SERVICE_ACCOUNT_NAME: "opencrane-opencrane-server", SERVER_TOKEN_AUDIENCE: "opencrane-memory-gateway", REQUEST_TIMEOUT_MS: "30000", ...overrides };
}

describe("memory gateway configuration", function _suite()
{
	it("accepts the private release-local Cognee route and exact server identity", function _accepts()
	{
		expect(_ReadConfig(_Environment())).toMatchObject({ port: 8080, namespace: "default", serverServiceAccountName: "opencrane-opencrane-server", allowFirstInstallRegistration: true });
	});

	it("rejects a non-private Cognee route before starting the gateway", function _rejectsExternalRoute()
	{
		expect(function _external() { _ReadConfig(_Environment({ COGNEE_URL: "https://cognee.example.test" })); }).toThrow(/in-cluster HTTP service origin/);
	});

	it("rejects a missing caller identity instead of admitting every server token", function _rejectsIdentity()
	{
		expect(function _missing() { _ReadConfig(_Environment({ SERVER_SERVICE_ACCOUNT_NAME: "" })); }).toThrow(/SERVER_SERVICE_ACCOUNT_NAME/);
	});

	it("keeps provider registration disabled unless it is explicitly enabled", function _registrationDefault()
	{
		expect(_ReadConfig(_Environment({ COGNEE_ALLOW_FIRST_INSTALL_REGISTRATION: undefined })).allowFirstInstallRegistration).toBe(false);
		expect(function _invalid() { _ReadConfig(_Environment({ COGNEE_ALLOW_FIRST_INSTALL_REGISTRATION: "yes" })); }).toThrow(/must be true or false/u);
	});

	it("requires fixed absolute credential file paths", function _credentialPaths()
	{
		expect(function _relative() { _ReadConfig(_Environment({ COGNEE_CREDENTIAL_EMAIL_PATH: "email" })); }).toThrow(/absolute path/u);
		expect(function _traversal() { _ReadConfig(_Environment({ COGNEE_CREDENTIAL_PASSWORD_PATH: "/var/run/../password" })); }).toThrow(/without traversal/u);
	});
});
