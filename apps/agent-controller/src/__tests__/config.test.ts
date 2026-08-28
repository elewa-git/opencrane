import { describe, expect, it } from "vitest";

import { _ReadConfig } from "../config";

/** Return the two fixed Helm-owned warm pool profiles. */
function _WarmProfilesJson(): string
{
	const image = "ghcr.io/elewa-git/opencrane-agent-runtime@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
	const common = { serviceAccountName: "warm-runtime", genericProfile: "generic", image, imagePullPolicy: "IfNotPresent", bindingPort: 8090, genericIdleSeconds: 900, scratchSize: "64Mi", resources: { requests: { cpu: "25m", memory: "64Mi" }, limits: { cpu: "250m", memory: "128Mi" } } };
	return JSON.stringify({
		"personal-default": { ...common, namespace: "silo-a-runtime", deploymentName: "opencrane-personal-warm", claimedProfile: "personal" },
		"managed-default": { ...common, namespace: "silo-a-managed-runtime", deploymentName: "opencrane-managed-warm", claimedProfile: "managed" },
	});
}

/** Return both Helm-equivalent governed skill workload profiles. */
function _SkillProfilesJson(): string
{
	return JSON.stringify({
		authoring: { kind: "authoring", image: `ghcr.io/elewa-git/opencrane-skill-authoring@sha256:${"a".repeat(64)}`, imagePullPolicy: "IfNotPresent", serverNamespace: "silo-a", namespace: "opencrane-skill-authoring", serviceAccountName: "skill-authoring-default", capabilityTokenAudience: "opencrane-skill-authoring", bootstrapUrl: "http://opencrane-opencrane-server.silo-a.svc.cluster.local:8081/api/internal/agent-runtime", capabilityTokenPath: "/var/run/opencrane/tokens/capability.token", bootstrapReferencePath: "/var/run/opencrane/bootstrap/reference", scratchSize: "128Mi", activeDeadlineSeconds: 300, ttlSecondsAfterFinished: 0, resources: { requests: { cpu: "500m", memory: "3Gi" }, limits: { cpu: "2", memory: "4Gi" } } },
		"tool-runner": { kind: "tool-runner", image: `ghcr.io/elewa-git/opencrane-tool-runner@sha256:${"b".repeat(64)}`, imagePullPolicy: "IfNotPresent", serverNamespace: "silo-a", namespace: "opencrane-tools", serviceAccountName: "tool-runner-default", capabilityTokenAudience: "opencrane-tool-runner", bootstrapUrl: "http://opencrane-opencrane-server.silo-a.svc.cluster.local:8081/api/internal/agent-runtime", capabilityTokenPath: "/var/run/opencrane/tokens/capability.token", bootstrapReferencePath: "/var/run/opencrane/bootstrap/reference", scratchSize: "64Mi", activeDeadlineSeconds: 300, ttlSecondsAfterFinished: 0, resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "256Mi" } } },
	});
}

/** Return the Helm-equivalent OCI MCP executor profile. */
function _McpExecutorProfileJson(): string
{
	return JSON.stringify({ companionImage: `ghcr.io/elewa-git/opencrane-mcp-executor@sha256:${"c".repeat(64)}`, imagePullPolicy: "IfNotPresent", serverNamespace: "silo-a", namespace: "opencrane-mcp-executor", serviceAccountName: "mcp-executor-default", opencraneInternalUrl: "http://opencrane-server.silo-a.svc.cluster.local:3001/api/internal/mcp-executor", projectedTokenTtlSeconds: 600, scratchSize: "64Mi", activeDeadlineSeconds: 600, serverResources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "512Mi" } }, companionResources: { requests: { cpu: "25m", memory: "64Mi" }, limits: { cpu: "250m", memory: "128Mi" } } });
}

/** Return the Helm-equivalent optional artifact preprocessing profile. */
function _ArtifactPreprocessorProfileJson(serverNamespace = "silo-a"): string
{
	return JSON.stringify({ image: `ghcr.io/elewa-git/opencrane-artifact-preprocessor@sha256:${"d".repeat(64)}`, imagePullPolicy: "IfNotPresent", serverNamespace, serverServiceName: "opencrane-server", namespace: "opencrane-artifact-preprocessing", serviceAccountName: "artifact-preprocessor", tokenAudience: "opencrane-artifact-preprocessor", openCraneInternalUrl: `http://opencrane-server.${serverNamespace}.svc.cluster.local:3001`, tokenPath: "/var/run/opencrane/tokens/opencrane.token", bootstrapReferencePath: "/var/run/opencrane/bootstrap/reference", scratchSize: "128Mi", activeDeadlineSeconds: 300, resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "1000m", memory: "512Mi" } } });
}

/** Return the minimal complete process environment. */
function _Environment(): NodeJS.ProcessEnv
{
	return { DATABASE_URL: "postgresql://opencrane:secret@postgres-pooler.silo-a.svc.cluster.local:5432/opencrane", OPENCRANE_SILO_ID: "silo-a", OPENCRANE_INTERNAL_URL: "http://opencrane-server.silo-a.svc.cluster.local:3001", OPENCRANE_SERVER_SERVICE_NAME: "opencrane-server", POD_NAMESPACE: "silo-a", OPENCRANE_CONTROLLER_TOKEN_PATH: "/var/run/opencrane/tokens/opencrane.token", AGENT_CONTROLLER_POLL_INTERVAL_MS: "1000", AGENT_CONTROLLER_WARM_PROFILES_JSON: _WarmProfilesJson(), AGENT_CONTROLLER_SKILL_WORKLOAD_PROFILES_JSON: _SkillProfilesJson(), AGENT_CONTROLLER_MCP_EXECUTOR_PROFILE_JSON: _McpExecutorProfileJson() };
}

describe("agent-controller process config", function _Suite()
{
	it("loads the explicit token path and namespace-bound immutable profiles", function _Loads()
	{
		const config = _ReadConfig(_Environment());
		expect(config.warmRuntimeProfiles["personal-default"]?.claimedProfile).toBe("personal");
		expect(config.warmRuntimeProfiles["managed-default"]?.namespace).toBe("silo-a-managed-runtime");
		expect(config.controllerTokenPath).toBe("/var/run/opencrane/tokens/opencrane.token");
		expect(config.requestTimeoutMilliseconds).toBe(10_000);
		expect(config.workflowDatabasePoolSize).toBe(2);
		expect(config.workflowWorkerConcurrency).toBe(2);
		expect(config.workflowPollIntervalMilliseconds).toBe(100);
		expect(config.artifactPreprocessorProfile).toBeUndefined();
		expect(config.warmRuntimeProfiles["personal-default"]?.serviceAccountName).toBe("warm-runtime");
		expect(config.skillWorkloadProfiles.authoring.serviceAccountName).toBe("skill-authoring-default");
		expect(config.mcpExecutorProfile.serviceAccountName).toBe("mcp-executor-default");
	});

	it("rejects a collapsed namespace or moving image tag", function _RejectsUnsafeConfig()
	{
		expect(function _InvalidNamespace() { _ReadConfig({ ..._Environment(), AGENT_CONTROLLER_WARM_PROFILES_JSON: _WarmProfilesJson().replace("\"silo-a-runtime\"", "\"Not a namespace\"") }); }).toThrow(/Kubernetes DNS labels/);
		expect(function _MovingImage() { _ReadConfig({ ..._Environment(), AGENT_CONTROLLER_WARM_PROFILES_JSON: _WarmProfilesJson().replace(/@sha256:[a-f0-9]{64}/, ":latest") }); }).toThrow(/immutable image/);
		expect(function _SkillProfileWrongClass() { _ReadConfig({ ..._Environment(), AGENT_CONTROLLER_SKILL_WORKLOAD_PROFILES_JSON: _SkillProfilesJson().replace("\"kind\":\"authoring\"", "\"kind\":\"tool-runner\"") }); }).toThrow(/wrong workload class/);
		expect(function _McpProfileMovingImage() { _ReadConfig({ ..._Environment(), AGENT_CONTROLLER_MCP_EXECUTOR_PROFILE_JSON: _McpExecutorProfileJson().replace(/@sha256:[a-f0-9]{64}/, ":latest") }); }).toThrow(/immutable companion image/);
	});

	it("loads and binds the optional artifact preprocessing profile to this server", function _LoadsArtifactProfile()
	{
		const config = _ReadConfig({ ..._Environment(), AGENT_CONTROLLER_ARTIFACT_PREPROCESSOR_PROFILE_JSON: _ArtifactPreprocessorProfileJson() });
		expect(config.artifactPreprocessorProfile?.namespace).toBe("opencrane-artifact-preprocessing");
		expect(config.artifactPreprocessorProfile?.activeDeadlineSeconds).toBe(300);
	});

	it("rejects workflow limits and server coordinates outside their bounded contracts", function _RejectsUnsafeWorkflowConfig()
	{
		expect(function _MissingDatabase() { _ReadConfig({ ..._Environment(), DATABASE_URL: "" }); }).toThrow(/DATABASE_URL is required/);
		expect(function _TooMuchConcurrency() { _ReadConfig({ ..._Environment(), OPENCRANE_WORKFLOW_WORKER_CONCURRENCY: "21" }); }).toThrow(/WORKFLOW_WORKER_CONCURRENCY/);
		expect(function _WrongServer() { _ReadConfig({ ..._Environment(), OPENCRANE_INTERNAL_URL: "http://other.silo-a.svc.cluster.local:3001" }); }).toThrow(/same-silo OpenCrane Service origin/);
		expect(function _ArtifactWrongSilo() { _ReadConfig({ ..._Environment(), AGENT_CONTROLLER_ARTIFACT_PREPROCESSOR_PROFILE_JSON: _ArtifactPreprocessorProfileJson("silo-b") }); }).toThrow(/configured same-silo OpenCrane Service/);
	});

	it("identifies the exact JSON configuration source whose syntax is invalid", function _RejectsInvalidJson()
	{
		expect(function _InvalidWarmProfiles() { _ReadConfig({ ..._Environment(), AGENT_CONTROLLER_WARM_PROFILES_JSON: "{" }); }).toThrow(/AGENT_CONTROLLER_WARM_PROFILES_JSON must contain valid JSON/);
		expect(function _InvalidSkillProfiles() { _ReadConfig({ ..._Environment(), AGENT_CONTROLLER_SKILL_WORKLOAD_PROFILES_JSON: "{" }); }).toThrow(/AGENT_CONTROLLER_SKILL_WORKLOAD_PROFILES_JSON must contain valid JSON/);
		expect(function _InvalidMcpProfile() { _ReadConfig({ ..._Environment(), AGENT_CONTROLLER_MCP_EXECUTOR_PROFILE_JSON: "{" }); }).toThrow(/AGENT_CONTROLLER_MCP_EXECUTOR_PROFILE_JSON must contain valid JSON/);
		expect(function _InvalidArtifactProfile() { _ReadConfig({ ..._Environment(), AGENT_CONTROLLER_ARTIFACT_PREPROCESSOR_PROFILE_JSON: "{" }); }).toThrow(/AGENT_CONTROLLER_ARTIFACT_PREPROCESSOR_PROFILE_JSON must contain valid JSON/);
	});
});
