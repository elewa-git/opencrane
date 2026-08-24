import { LOCAL_DEVELOPMENT_PROFILES } from "./profiles.mjs";

const _LOCAL_RUNTIME_IMAGE = "local-agent-runtime@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function _runtimeProfile(namespace, serviceAccountName, runtimeStreamUrl, liteLLMBaseUrl)
{
	return {
		namespace,
		image: _LOCAL_RUNTIME_IMAGE,
		imagePullPolicy: "Never",
		runtimeStreamUrl,
		litellmBaseUrl: liteLLMBaseUrl,
		serverNamespace: "local-development-server",
		serviceAccountName,
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
	};
}

export function createAgentControllerEnvironment(configuration, credentials)
{
	if (configuration.profile !== LOCAL_DEVELOPMENT_PROFILES.Agent)
	{
		return {};
	}

	const internalUrl = "http://127.0.0.1:8081";
	const runtimeStreamUrl = "http://opencrane.local-development-server.svc.cluster.local/api/internal/agent-runtime";
	const liteLLMBaseUrl = "http://litellm.local-development-server.svc.cluster.local:4000";

	const profiles = {
		"personal-default": _runtimeProfile("local-development-personal-runtime", "agent-runtime-default", runtimeStreamUrl, liteLLMBaseUrl),
		"managed-default": _runtimeProfile("local-development-managed-runtime", "managed-agent-runtime-default", runtimeStreamUrl, liteLLMBaseUrl)
	};
	const environment = {
		OPENCRANE_DEVELOPMENT_PROFILE: configuration.developmentProfile,
		OPENCRANE_INTERNAL_URL: internalUrl,
		OPENCRANE_CONTROLLER_TOKEN_PATH: credentials.controllerTokenPath,
		OPENCRANE_RUNTIME_LAUNCH_SECRET_PATH: credentials.runtimeLaunchSecretPath,
		OPENCRANE_REPOSITORY_ROOT: configuration.repositoryRoot,
		AGENT_CONTROLLER_PROFILES_JSON: JSON.stringify(profiles)
	};

	return environment;
}
