import assert from "node:assert/strict";
import test from "node:test";

import { createDevelopmentChildEnvironment } from "../local-development/process-supervisor.mjs";

test("spawned processes inherit only reviewed toolchain variables from the developer shell", function _removesParentCredentials()
{
	const environment = createDevelopmentChildEnvironment({
		PATH: "/usr/bin",
		HOME: "/home/developer",
		OPENAI_API_KEY: "parent-provider-key",
		LITELLM_MASTER_KEY: "parent-master-key",
		OPENCRANE_INITIAL_MODEL_API_KEY: "parent-initial-key",
		GH_TOKEN: "github-token",
		AWS_SECRET_ACCESS_KEY: "aws-secret"
	});

	assert.deepEqual(environment, {
		HOME: "/home/developer",
		PATH: "/usr/bin"
	});
});

test("an application process receives only the model credential its profile supplies explicitly", function _keepsExplicitCredential()
{
	const environment = createDevelopmentChildEnvironment({
		PATH: "/usr/bin",
		LITELLM_MASTER_KEY: "stale-parent-key"
	}, {
		LITELLM_MASTER_KEY: "selected-profile-key"
	});

	assert.equal(environment.LITELLM_MASTER_KEY, "selected-profile-key");
});

test("explicit Tier 2 listener ports override conflicting parent values", function _FixedListenerPorts()
{
	const environment = createDevelopmentChildEnvironment({
		PORT: "9090",
		INTERNAL_PORT: "9091",
		AWS_ACCESS_KEY_ID: "parent-access-key"
	}, {
		PORT: "8080",
		INTERNAL_PORT: "8081"
	});

	assert.equal(environment.PORT, "8080");
	assert.equal(environment.INTERNAL_PORT, "8081");
	assert.equal(environment.AWS_ACCESS_KEY_ID, undefined);
});
