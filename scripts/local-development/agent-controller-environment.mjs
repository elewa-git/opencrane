import fs from "node:fs";

import { LOCAL_DEVELOPMENT_PROFILES } from "./profiles.mjs";

const _LOCAL_RUNTIME_IMAGE = "local-agent-runtime@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const _RUNTIME_IDENTITIES = JSON.parse(fs.readFileSync(new URL("../../libs/models/local-development/main/profile-contract.json", import.meta.url), "utf8")).runtimeIdentities;

function _runtimeProfile(name, namespace, serviceAccountName, bindingPort)
{
	return {
		namespace,
		deploymentName: `local-${name}-warm`,
		serviceAccountName,
		genericProfile: "generic",
		claimedProfile: name,
		image: _LOCAL_RUNTIME_IMAGE,
		imagePullPolicy: "Never",
		bindingPort,
		genericIdleSeconds: 900,
		scratchSize: "64Mi",
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

/**
 * Builds the controller environment from the profile contract shared with the server.
 * Personal and managed profiles carry their identity class so the controller validates each
 * ServiceAccount against the right naming rule instead of treating both as personal. Core returns
 * no variables because it never starts the Agent controller.
 *
 * Called by: `createApplicationEnvironment` before it narrows variables for each application process.
 * @param {ReturnType<typeof import("./configuration.mjs").createLocalDevelopmentConfiguration>} configuration - Selected Tier 2 composition.
 * @param {{ controllerTokenPath?: string, runtimeLaunchSecretPath?: string }} credentials - Disposable credential paths created for this session.
 * @returns {Record<string, string>} Variables admitted to the Agent controller process.
 */
export function createAgentControllerEnvironment(configuration, credentials)
{
	if (configuration.profile !== LOCAL_DEVELOPMENT_PROFILES.Agent)
	{
		return {};
	}

	const internalUrl = `http://127.0.0.1:${configuration.internalPort}`;
	const profiles = {
		"personal-default": _runtimeProfile("personal", _RUNTIME_IDENTITIES.personal.namespace, _RUNTIME_IDENTITIES.personal.serviceAccountName, 18_081),
		"managed-default": _runtimeProfile("managed", _RUNTIME_IDENTITIES.managed.namespace, _RUNTIME_IDENTITIES.managed.serviceAccountName, 18_082)
	};
	const environment = {
		OPENCRANE_INTERNAL_URL: internalUrl,
		OPENCRANE_CONTROLLER_TOKEN_PATH: credentials.controllerTokenPath,
		OPENCRANE_RUNTIME_LAUNCH_SECRET_PATH: credentials.runtimeLaunchSecretPath,
		OPENCRANE_LOCAL_RUNTIME_PYTHON: configuration.runtimePythonPath,
		OPENCRANE_REPOSITORY_ROOT: configuration.repositoryRoot,
		OPENCRANE_SERVER_SERVICE_NAME: "opencrane",
		OPENCRANE_SERVER_NAMESPACE: _RUNTIME_IDENTITIES.serverNamespace,
		OPENCRANE_SILO_ID: "local-development",
		AGENT_CONTROLLER_WARM_PROFILES_JSON: JSON.stringify(profiles)
	};

	return environment;
}
