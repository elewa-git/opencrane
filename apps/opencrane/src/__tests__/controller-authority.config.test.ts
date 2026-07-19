import { describe, expect, it } from "vitest";

import { _LoadControllerAuthorityConfig } from "../app/controller-authority.config.js";

/** Creates a complete closed controller/runtime environment fixture. */
function _environment(): NodeJS.ProcessEnv
{
	return {
		AGENT_CONTROLLER_NAMESPACE: "opencrane-system",
		AGENT_CONTROLLER_SERVICE_ACCOUNT: "agent-controller",
		AGENT_RUNTIME_PROFILE: "personal-default",
		AGENT_RUNTIME_NAMESPACE: "agent-runtimes",
		AGENT_RUNTIME_SERVICE_ACCOUNT: "agent-runtime",
		AGENT_RUNTIME_IMAGE: `registry.example/runtime@sha256:${"a".repeat(64)}`,
		AGENT_RUNTIME_ASSIGNMENT_TTL_SECONDS: "120",
	};
}

describe("controller authority server configuration", function _suite()
{
	it("loads one closed controller identity and immutable runtime profile", function _loads()
	{
		const config = _LoadControllerAuthorityConfig(_environment());

		expect(config).toMatchObject({ identity: { audience: "agent-controller", namespace: "opencrane-system", serviceAccountName: "agent-controller" } });
		expect(config?.runtimeProfiles.get("personal-default")).toEqual(expect.objectContaining({ namespace: "agent-runtimes", assignmentTtlMs: 120_000 }));
	});

	it("fails closed when deployment configuration is incomplete or widens runtime image selection", function _failsClosed()
	{
		const missingIdentity = _environment();
		delete missingIdentity.AGENT_CONTROLLER_SERVICE_ACCOUNT;
		const mutableImage = { ..._environment(), AGENT_RUNTIME_IMAGE: "registry.example/runtime:latest" };

		expect(_LoadControllerAuthorityConfig(missingIdentity)).toBeNull();
		expect(_LoadControllerAuthorityConfig(mutableImage)).toBeNull();
	});
});
