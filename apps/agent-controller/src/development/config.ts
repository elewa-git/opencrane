import { isAbsolute, resolve } from "node:path";

import { __ValidateAgentControllerRuntimeProfiles, LocalAgentRuntimeModelStrategies } from "@opencrane/backend/agents/runtime/controller";
import { LocalDevelopmentProfileKinds } from "@opencrane/models/local-development";
import { ___ParseAndValidateJson } from "@opencrane/util";

import type { LocalAgentControllerModelConfiguration, LocalAgentControllerProcessConfig } from "./config.types";

/** Read one required, trimmed development environment value. */
function _Required(environment: NodeJS.ProcessEnv, name: string): string
{
	const value = environment[name]?.trim();

	if (!value)
	{
		throw new Error(`${name} is required`);
	}

	return value;
}

/** Parse a bounded safe integer or use its development default. */
function _Integer(environment: NodeJS.ProcessEnv, name: string, fallback: number, minimum: number, maximum: number): number
{
	const raw = environment[name];
	const value = raw === undefined ? fallback : Number(raw);

	if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
	{
		throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
	}

	return value;
}

/** Return whether a URL host resolves only to this developer's machine by configuration. */
function _IsLoopbackHost(hostname: string): boolean
{
	return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/** Parse an origin without credentials, query, or fragments. */
function _Origin(value: string, name: string): URL
{
	const parsed = URL.parse(value);

	if (!parsed || !["http:", "https:"].includes(parsed.protocol) || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password)
	{
		throw new Error(`${name} must be one HTTP(S) origin without credentials`);
	}

	return parsed;
}

/** Read one of the three Agent-enabled Tier 2 profiles. */
function _Profile(environment: NodeJS.ProcessEnv): Exclude<LocalDevelopmentProfileKinds, LocalDevelopmentProfileKinds.Core>
{
	const value = _Required(environment, "OPENCRANE_DEVELOPMENT_PROFILE");

	if (value === LocalDevelopmentProfileKinds.AgentLocal || value === LocalDevelopmentProfileKinds.AgentRemote || value === LocalDevelopmentProfileKinds.AgentSimulated)
	{
		return value;
	}

	throw new Error("the local Agent controller requires agent-local, agent-remote, or agent-simulated");
}

/** Select the model boundary for the chosen development profile. */
function _ModelConfiguration(environment: NodeJS.ProcessEnv, profile: Exclude<LocalDevelopmentProfileKinds, LocalDevelopmentProfileKinds.Core>): LocalAgentControllerModelConfiguration
{
	if (profile === LocalDevelopmentProfileKinds.AgentSimulated)
	{
		return { modelStrategy: LocalAgentRuntimeModelStrategies.Simulated };
	}

	const litellmBaseUrl = _Required(environment, "LITELLM_ENDPOINT");
	const origin = _Origin(litellmBaseUrl, "LITELLM_ENDPOINT");

	if (profile === LocalDevelopmentProfileKinds.AgentLocal && !_IsLoopbackHost(origin.hostname))
	{
		throw new Error("agent-local requires a loopback LiteLLM origin");
	}

	if (profile === LocalDevelopmentProfileKinds.AgentRemote && (origin.protocol !== "https:" || _IsLoopbackHost(origin.hostname)))
	{
		throw new Error("agent-remote requires an explicit non-loopback HTTPS LiteLLM origin");
	}

	return {
		litellmBaseUrl,
		modelStrategy: LocalAgentRuntimeModelStrategies.LiteLlm
	};
}

/**
 * Read the development Agent controller config without importing it into the production entrypoint.
 *
 * Called by: `apps/agent-controller/src/development/index.ts`.
 * @param environment - Process environment supplied by the Tier 2 coordinator.
 * @returns Validated local endpoints, separate token paths, runtime profiles, and timings.
 * @throws When core selects the Agent controller, a token path is shared, or a model endpoint does
 * not match the selected local/remote/simulated boundary.
 */
export function _ReadDevelopmentConfig(environment: NodeJS.ProcessEnv = process.env): LocalAgentControllerProcessConfig
{
	// 1. Select the Agent profile first, because it decides whether a model endpoint may exist.
	const profile = _Profile(environment);
	const profiles = ___ParseAndValidateJson(_Required(environment, "AGENT_CONTROLLER_PROFILES_JSON"), "AGENT_CONTROLLER_PROFILES_JSON", __ValidateAgentControllerRuntimeProfiles);
	const modelConfiguration = _ModelConfiguration(environment, profile);

	// 2. Keep the controller bearer and runtime signing material in separate private files.
	const controllerTokenPath = _Required(environment, "OPENCRANE_CONTROLLER_TOKEN_PATH");
	const runtimeLaunchSecretPath = _Required(environment, "OPENCRANE_RUNTIME_LAUNCH_SECRET_PATH");

	if (!isAbsolute(controllerTokenPath) || !isAbsolute(runtimeLaunchSecretPath) || controllerTokenPath === runtimeLaunchSecretPath)
	{
		throw new Error("local controller and runtime token paths must be distinct absolute paths");
	}

	// 3. Accept only loopback OpenCrane origins; the local identity boundary never trusts network location.
	const openCraneInternalUrl = _Required(environment, "OPENCRANE_INTERNAL_URL");
	const internalOrigin = _Origin(openCraneInternalUrl, "OPENCRANE_INTERNAL_URL");

	if (internalOrigin.protocol !== "http:" || !_IsLoopbackHost(internalOrigin.hostname))
	{
		throw new Error("the development Agent controller requires a loopback HTTP OpenCrane origin");
	}

	const runtimeStreamUrl = `${internalOrigin.origin}/api/internal/agent-runtime`;

	// 4. Reuse the production profile validator so durable profile, namespace, and identity checks stay unchanged.
	const runtimeApplicationDirectory = resolve(_Required(environment, "OPENCRANE_REPOSITORY_ROOT"), "apps/agent-runtime");
	return {
		profile,
		openCraneInternalUrl,
		controllerTokenPath,
		runtimeLaunchSecretPath,
		runtimeApplicationDirectory,
		pythonExecutable: environment.OPENCRANE_LOCAL_RUNTIME_PYTHON?.trim() || "python3",
		runtimeStreamUrl,
		litellmBaseUrl: modelConfiguration.litellmBaseUrl,
		modelStrategy: modelConfiguration.modelStrategy,
		profiles,
		pollIntervalMilliseconds: _Integer(environment, "AGENT_CONTROLLER_POLL_INTERVAL_MS", 1_000, 100, 60_000),
		outboxPruneIntervalMilliseconds: _Integer(environment, "AGENT_CONTROLLER_OUTBOX_PRUNE_INTERVAL_MS", 3_600_000, 60_000, 86_400_000),
		requestTimeoutMilliseconds: _Integer(environment, "AGENT_CONTROLLER_REQUEST_TIMEOUT_MS", 10_000, 1_000, 60_000)
	};
}
