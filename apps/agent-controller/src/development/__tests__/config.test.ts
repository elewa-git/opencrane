import { LocalDevelopmentProfileKinds } from "@opencrane/models/local-development";
import { describe, expect, it } from "vitest";

import { _ReadDevelopmentConfig } from "../config";

/** Return a valid Kubernetes projection profile used by the unchanged controller reconciler. */
function _RuntimeProfiles(): string
{
	return JSON.stringify({
		"personal-default": {
			namespace: "local-development-personal-runtime",
			image: "local-agent-runtime@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
			imagePullPolicy: "Never",
			runtimeStreamUrl: "http://opencrane.local-development-server.svc.cluster.local/api/internal/agent-runtime",
			litellmBaseUrl: "http://litellm.local-development-server.svc.cluster.local:4000",
			serverNamespace: "local-development-server",
			serviceAccountName: "agent-runtime-default",
			projectedTokenTtlSeconds: 600,
			scratchSize: "64Mi",
			activeDeadlineSeconds: 900,
			ttlSecondsAfterFinished: 0,
			resources: {
				requests: {
					cpu: "25m",
					memory: "64Mi"
				},
				limits: {
					cpu: "250m",
					memory: "128Mi"
				}
			}
		}
	});
}

/** Build the common explicit local process environment. */
function _Environment(profile: LocalDevelopmentProfileKinds): NodeJS.ProcessEnv
{
	return {
		OPENCRANE_DEVELOPMENT_PROFILE: profile,
		LITELLM_ENDPOINT: "http://127.0.0.1:4000",
		OPENCRANE_INTERNAL_URL: "http://127.0.0.1:3001",
		OPENCRANE_CONTROLLER_TOKEN_PATH: "/tmp/opencrane-controller.token",
		OPENCRANE_RUNTIME_LAUNCH_SECRET_PATH: "/tmp/opencrane-runtime-launch.secret",
		OPENCRANE_REPOSITORY_ROOT: "/workspace/opencrane",
		AGENT_CONTROLLER_PROFILES_JSON: _RuntimeProfiles()
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
