import { isAbsolute, resolve } from "node:path";

import { __AssertWarmRuntimePoolProfile } from "@opencrane/backend/agents/runtime/k8s-launcher";
import type { WarmRuntimePoolProfiles } from "@opencrane/backend/agents/runtime/controller";
import { LocalAgentRuntimeModelStrategies, __ParseLocalDevelopmentProfileKind, LocalDevelopmentProfileKinds } from "@opencrane/models/local-development";
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
	const profile = __ParseLocalDevelopmentProfileKind(value);
	if (profile && profile !== LocalDevelopmentProfileKinds.Core)
	{
		return profile;
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
	return { litellmBaseUrl, modelStrategy: LocalAgentRuntimeModelStrategies.LiteLlm };
}

/** Validate the two synthetic warm pools supplied by the Tier 2 coordinator. */
function _WarmRuntimeProfiles(value: unknown): WarmRuntimePoolProfiles
{
	if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length !== 2)
	{
		throw new Error("local warm runtime requires exactly personal and managed profiles");
	}
	const profiles = value as Record<string, unknown>;
	const ports = new Set<number>();
	for (const candidate of Object.values(profiles))
	{
		if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate))
		{
			throw new Error("local warm runtime profile must be one object");
		}
		__AssertWarmRuntimePoolProfile(candidate as Parameters<typeof __AssertWarmRuntimePoolProfile>[0]);
		ports.add((candidate as { readonly bindingPort: number }).bindingPort);
	}
	if (ports.size !== 2)
	{
		throw new Error("local warm runtime profiles require distinct binding ports");
	}
	return structuredClone(profiles) as WarmRuntimePoolProfiles;
}

/** Read and fail-closed validate the Tier 2 warm-runtime controller configuration. */
export function _ReadDevelopmentConfig(environment: NodeJS.ProcessEnv = process.env): LocalAgentControllerProcessConfig
{
	const profile = _Profile(environment);
	const modelConfiguration = _ModelConfiguration(environment, profile);
	const controllerTokenPath = _Required(environment, "OPENCRANE_CONTROLLER_TOKEN_PATH");
	const runtimeLaunchSecretPath = _Required(environment, "OPENCRANE_RUNTIME_LAUNCH_SECRET_PATH");
	if (!isAbsolute(controllerTokenPath) || !isAbsolute(runtimeLaunchSecretPath) || controllerTokenPath === runtimeLaunchSecretPath)
	{
		throw new Error("local controller and runtime token paths must be distinct absolute paths");
	}
	const openCraneInternalUrl = _Required(environment, "OPENCRANE_INTERNAL_URL");
	const internalOrigin = _Origin(openCraneInternalUrl, "OPENCRANE_INTERNAL_URL");
	if (internalOrigin.protocol !== "http:" || !_IsLoopbackHost(internalOrigin.hostname))
	{
		throw new Error("the development Agent controller requires a loopback HTTP OpenCrane origin");
	}
	const databaseUrl = _Required(environment, "DATABASE_URL");
	const database = new URL(databaseUrl);
	if (!_IsLoopbackHost(database.hostname))
	{
		throw new Error("the development Agent controller requires loopback PostgreSQL");
	}
	return {
		profile,
		openCraneInternalUrl,
		serverServiceName: _Required(environment, "OPENCRANE_SERVER_SERVICE_NAME"),
		serverNamespace: _Required(environment, "OPENCRANE_SERVER_NAMESPACE"),
		siloId: _Required(environment, "OPENCRANE_SILO_ID"),
		databaseUrl,
		controllerTokenPath,
		runtimeLaunchSecretPath,
		runtimeApplicationDirectory: resolve(_Required(environment, "OPENCRANE_REPOSITORY_ROOT"), "apps/agent-runtime"),
		pythonExecutable: _Required(environment, "OPENCRANE_LOCAL_RUNTIME_PYTHON"),
		runtimeStreamUrl: `${internalOrigin.origin}/api/internal/warm-runtime`,
		litellmBaseUrl: modelConfiguration.litellmBaseUrl,
		modelStrategy: modelConfiguration.modelStrategy,
		warmRuntimeProfiles: ___ParseAndValidateJson(_Required(environment, "AGENT_CONTROLLER_WARM_PROFILES_JSON"), "AGENT_CONTROLLER_WARM_PROFILES_JSON", _WarmRuntimeProfiles),
		workflowDatabasePoolSize: _Integer(environment, "OPENCRANE_WORKFLOW_DATABASE_POOL_SIZE", 2, 1, 20),
		workflowWorkerConcurrency: _Integer(environment, "OPENCRANE_WORKFLOW_WORKER_CONCURRENCY", 2, 1, 20),
		workflowPollIntervalMilliseconds: _Integer(environment, "OPENCRANE_WORKFLOW_POLL_INTERVAL_MS", 100, 10, 60_000),
		pollIntervalMilliseconds: _Integer(environment, "AGENT_CONTROLLER_POLL_INTERVAL_MS", 1_000, 100, 60_000),
		requestTimeoutMilliseconds: _Integer(environment, "AGENT_CONTROLLER_REQUEST_TIMEOUT_MS", 10_000, 1_000, 60_000)
	};
}
