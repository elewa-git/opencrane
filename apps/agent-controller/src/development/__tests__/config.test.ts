import { LocalDevelopmentProfileKinds } from "@opencrane/models/local-development";
import { describe, expect, it } from "vitest";

import { _ReadDevelopmentConfig } from "../config";

/** Return the two synthetic warm pools used by the local workflow controller. */
function _RuntimeProfiles(): string
{
	function _Profile(name: string, namespace: string, serviceAccountName: string, bindingPort: number)
	{
		return {
			namespace,
			deploymentName: `local-${name}-warm`,
			serviceAccountName,
			genericProfile: "generic",
			claimedProfile: name,
			image: `local-agent-runtime@sha256:${"a".repeat(64)}`,
			imagePullPolicy: "Never",
			bindingPort,
			genericIdleSeconds: 900,
			scratchSize: "64Mi",
			resources: { requests: { cpu: "25m", memory: "64Mi" }, limits: { cpu: "250m", memory: "128Mi" } }
		};
	}
	return JSON.stringify({
		"personal-default": _Profile("personal", "local-development-personal-runtime", "agent-runtime-default", 18_081),
		"managed-default": _Profile("managed", "local-development-managed-runtime", "managed-agent-runtime-default", 18_082)
	});
}

/** Build the common explicit local process environment. */
function _Environment(profile: LocalDevelopmentProfileKinds): NodeJS.ProcessEnv
{
	return {
		OPENCRANE_DEVELOPMENT_PROFILE: profile,
		DATABASE_URL: "postgresql://opencrane:local@127.0.0.1:55432/opencrane",
		LITELLM_ENDPOINT: "http://127.0.0.1:4000",
		OPENCRANE_INTERNAL_URL: "http://127.0.0.1:3001",
		OPENCRANE_SERVER_SERVICE_NAME: "opencrane",
		OPENCRANE_SERVER_NAMESPACE: "local-development-server",
		OPENCRANE_SILO_ID: "local-development",
		OPENCRANE_CONTROLLER_TOKEN_PATH: "/tmp/opencrane-controller.token",
		OPENCRANE_RUNTIME_LAUNCH_SECRET_PATH: "/tmp/opencrane-runtime-launch.secret",
		OPENCRANE_LOCAL_RUNTIME_PYTHON: "/workspace/opencrane/apps/agent-runtime/.venv/bin/python",
		OPENCRANE_REPOSITORY_ROOT: "/workspace/opencrane",
		AGENT_CONTROLLER_WARM_PROFILES_JSON: _RuntimeProfiles()
	};
}

describe("local Agent controller config", function _Suite()
{
	it("uses real LiteLLM for the default local Agent profile", function _ReadsLocalProfile()
	{
		const config = _ReadDevelopmentConfig(_Environment(LocalDevelopmentProfileKinds.AgentLocal));

		expect(config.profile).toBe(LocalDevelopmentProfileKinds.AgentLocal);
		expect(config.modelStrategy).toBe("litellm");
		expect(config.litellmBaseUrl).toBe("http://127.0.0.1:4000");
	});

	it("uses no configured LiteLLM endpoint for simulated Agent work", function _ReadsSimulatedProfile()
	{
		const environment = _Environment(LocalDevelopmentProfileKinds.AgentSimulated);
		delete environment.LITELLM_ENDPOINT;
		const config = _ReadDevelopmentConfig(environment);

		expect(config.modelStrategy).toBe("simulated");
		expect(config.litellmBaseUrl).toBeUndefined();
	});

	it("requires remote LiteLLM to be explicit HTTPS", function _RejectsUnsafeRemoteProfile()
	{
		const environment = _Environment(LocalDevelopmentProfileKinds.AgentRemote);

		expect(function _ReadUnsafeRemote() { _ReadDevelopmentConfig(environment); }).toThrow(/non-loopback HTTPS/);
		environment.LITELLM_ENDPOINT = "https://litellm.dev.example";
		expect(_ReadDevelopmentConfig(environment).litellmBaseUrl).toBe("https://litellm.dev.example");
	});

	it("rejects core and shared controller/runtime token files", function _RejectsInvalidIdentityProfile()
	{
		const core = _Environment(LocalDevelopmentProfileKinds.Core);
		expect(function _ReadCore() { _ReadDevelopmentConfig(core); }).toThrow(/requires agent-local/);

		const sharedToken = _Environment(LocalDevelopmentProfileKinds.AgentLocal);
		sharedToken.OPENCRANE_RUNTIME_LAUNCH_SECRET_PATH = sharedToken.OPENCRANE_CONTROLLER_TOKEN_PATH;
		expect(function _ReadSharedToken() { _ReadDevelopmentConfig(sharedToken); }).toThrow(/distinct absolute paths/);
	});
});
