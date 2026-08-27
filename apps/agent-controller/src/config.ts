import { isAbsolute } from "node:path";

import { __AssertWarmRuntimePoolProfile } from "@opencrane/backend/agents/runtime/k8s-launcher";
import type { WarmRuntimePoolProfiles } from "@opencrane/backend/agents/runtime/controller";
import { __ValidateMcpExecutorControllerProfile } from "@opencrane/backend/agents/runtime/mcp-executor/controller";
import { __ValidateSkillWorkloadControllerProfiles } from "@opencrane/backend/agents/skills/controller";
import { __BuildArtifactPreprocessorJob, type ArtifactPreprocessorJobProfile } from "@opencrane/backend/artifacts/preprocessor/k8s-launcher";
import { ___ParseAndValidateJson } from "@opencrane/util";

import type { AgentControllerProcessConfig } from "./config.types";

/** Read one required, trimmed environment value. */
function _Required(environment: NodeJS.ProcessEnv, name: string): string
{
	const value = environment[name]?.trim();
	if (!value)
	{
		throw new Error(`${name} is required`);
	}
	return value;
}

/** Parse a bounded safe integer or use its explicit default. */
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

/** Require one Kubernetes DNS label before it becomes a server or namespace coordinate. */
function _KubernetesName(environment: NodeJS.ProcessEnv, name: string): string
{
	const value = _Required(environment, name);
	if (value.length > 63 || !/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/u.test(value))
	{
		throw new Error(`${name} must be one Kubernetes DNS label`);
	}
	return value;
}

/** Require the credential-free same-silo OpenCrane Service origin used by every controller authority. */
function _OpenCraneOrigin(environment: NodeJS.ProcessEnv, serverServiceName: string, serverNamespace: string): string
{
	const value = _Required(environment, "OPENCRANE_INTERNAL_URL");
	const parsed = URL.parse(value);
	if (!parsed || parsed.protocol !== "http:" || parsed.hostname !== `${serverServiceName}.${serverNamespace}.svc.cluster.local` || parsed.pathname !== "/" || parsed.username || parsed.password || parsed.search || parsed.hash)
	{
		throw new Error("OPENCRANE_INTERNAL_URL must be the credential-free same-silo OpenCrane Service origin");
	}
	return value;
}

/** Validate the complete artifact profile through the same pure Job builder used by task execution. */
function _ValidateArtifactProfile(value: unknown): ArtifactPreprocessorJobProfile
{
	if (typeof value !== "object" || value === null || Array.isArray(value))
	{
		throw new Error("artifact preprocessing controller profile must be one object");
	}
	const expectedKeys = ["image", "imagePullPolicy", "serverNamespace", "serverServiceName", "namespace", "serviceAccountName", "tokenAudience", "openCraneInternalUrl", "tokenPath", "bootstrapReferencePath", "scratchSize", "activeDeadlineSeconds", "ttlSecondsAfterFinished", "resources"];
	if (Object.keys(value).length !== expectedKeys.length || !expectedKeys.every(function _HasKey(key): boolean { return Object.hasOwn(value, key); }))
	{
		throw new Error("artifact preprocessing controller profile must contain only its deployment-owned fields");
	}
	const profile = structuredClone(value) as ArtifactPreprocessorJobProfile;
	__BuildArtifactPreprocessorJob({ preprocessJobId: "profile-validation", siloId: "profile-validation", namespace: profile.namespace, bootstrapReference: `artifact-preprocess-bootstrap-v1_${"a".repeat(64)}` }, profile);
	return profile;
}

/** Parse the optional artifact profile that exists only when its isolated plane is enabled. */
function _ArtifactProfile(environment: NodeJS.ProcessEnv): ArtifactPreprocessorJobProfile | undefined
{
	const raw = environment["AGENT_CONTROLLER_ARTIFACT_PREPROCESSOR_PROFILE_JSON"]?.trim();
	if (!raw)
	{
		return undefined;
	}
	return ___ParseAndValidateJson(raw, "AGENT_CONTROLLER_ARTIFACT_PREPROCESSOR_PROFILE_JSON", _ValidateArtifactProfile);
}

/** Validates the two fixed pools supplied by Helm. */
function _ValidateWarmRuntimeProfiles(value: unknown): WarmRuntimePoolProfiles
{
	if (typeof value !== "object" || value === null || Array.isArray(value))
	{
		throw new Error("warm runtime profiles must be an object");
	}
	const profiles = value as Record<string, unknown>;
	const names = Object.keys(profiles);
	if (names.length !== 2)
	{
		throw new Error("warm runtime requires exactly personal and managed pool profiles");
	}
	for (const [name, candidate] of Object.entries(profiles))
	{
		if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate))
		{
			throw new Error(`warm runtime profile '${name}' must be one object`);
		}
		__AssertWarmRuntimePoolProfile(candidate as Parameters<typeof __AssertWarmRuntimePoolProfile>[0]);
	}
	return structuredClone(profiles) as WarmRuntimePoolProfiles;
}

/** Read and fail-closed validate the complete agent-controller process configuration. */
export function _ReadConfig(environment: NodeJS.ProcessEnv = process.env): AgentControllerProcessConfig
{
	// 1. Require the separately audience-bound OpenCrane credential by mounted path, never raw value.
	const controllerTokenPath = _Required(environment, "OPENCRANE_CONTROLLER_TOKEN_PATH");
	if (!isAbsolute(controllerTokenPath))
	{
		throw new Error("OPENCRANE_CONTROLLER_TOKEN_PATH must be absolute");
	}

	// 2. Validate every immutable profile and its dedicated runtime namespace at startup.
	const warmRuntimeProfiles = ___ParseAndValidateJson(_Required(environment, "AGENT_CONTROLLER_WARM_PROFILES_JSON"), "AGENT_CONTROLLER_WARM_PROFILES_JSON", _ValidateWarmRuntimeProfiles);
	const skillWorkloadProfiles = ___ParseAndValidateJson(_Required(environment, "AGENT_CONTROLLER_SKILL_WORKLOAD_PROFILES_JSON"), "AGENT_CONTROLLER_SKILL_WORKLOAD_PROFILES_JSON", __ValidateSkillWorkloadControllerProfiles);
	const mcpExecutorProfile = ___ParseAndValidateJson(_Required(environment, "AGENT_CONTROLLER_MCP_EXECUTOR_PROFILE_JSON"), "AGENT_CONTROLLER_MCP_EXECUTOR_PROFILE_JSON", __ValidateMcpExecutorControllerProfile);
	const artifactPreprocessorProfile = _ArtifactProfile(environment);
	const serverServiceName = _KubernetesName(environment, "OPENCRANE_SERVER_SERVICE_NAME");
	const serverNamespace = _KubernetesName(environment, "POD_NAMESPACE");
	const openCraneInternalUrl = _OpenCraneOrigin(environment, serverServiceName, serverNamespace);
	if (artifactPreprocessorProfile !== undefined && (artifactPreprocessorProfile.serverServiceName !== serverServiceName || artifactPreprocessorProfile.serverNamespace !== serverNamespace || artifactPreprocessorProfile.openCraneInternalUrl !== openCraneInternalUrl || artifactPreprocessorProfile.namespace === serverNamespace))
	{
		throw new Error("AGENT_CONTROLLER_ARTIFACT_PREPROCESSOR_PROFILE_JSON must use the configured same-silo OpenCrane Service and an isolated worker namespace");
	}
	return {
		databaseUrl: _Required(environment, "DATABASE_URL"),
		workflowDatabasePoolSize: _Integer(environment, "OPENCRANE_WORKFLOW_DATABASE_POOL_SIZE", 2, 1, 20),
		workflowWorkerConcurrency: _Integer(environment, "OPENCRANE_WORKFLOW_WORKER_CONCURRENCY", 2, 1, 20),
		workflowPollIntervalMilliseconds: _Integer(environment, "OPENCRANE_WORKFLOW_POLL_INTERVAL_MS", 100, 10, 60_000),
		siloId: _Required(environment, "OPENCRANE_SILO_ID"),
		openCraneInternalUrl,
		serverServiceName,
		serverNamespace,
		controllerTokenPath,
		pollIntervalMilliseconds: _Integer(environment, "AGENT_CONTROLLER_POLL_INTERVAL_MS", 1_000, 100, 60_000),
		requestTimeoutMilliseconds: _Integer(environment, "AGENT_CONTROLLER_REQUEST_TIMEOUT_MS", 10_000, 1_000, 60_000),
		warmRuntimeProfiles,
		skillWorkloadProfiles,
		mcpExecutorProfile,
		artifactPreprocessorProfile,
	};
}
