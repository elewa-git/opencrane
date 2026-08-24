import assert from "node:assert/strict";
import test from "node:test";

import { createDevelopmentChildEnvironment } from "../local-development/process-supervisor.mjs";

test("spawned processes do not inherit model credentials from the developer shell", function _removesParentCredentials()
{
	const environment = createDevelopmentChildEnvironment({
		PATH: "/usr/bin",
		OPENAI_API_KEY: "parent-provider-key",
		LITELLM_MASTER_KEY: "parent-master-key",
		OPENCRANE_INITIAL_MODEL_API_KEY: "parent-initial-key"
	});

	assert.deepEqual(environment, { PATH: "/usr/bin" });
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
