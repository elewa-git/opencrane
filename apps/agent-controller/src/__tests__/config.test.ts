import { describe, expect, it } from "vitest";

import { _ReadConfig } from "../config";

/** Return one Helm-equivalent immutable profile JSON value. */
function _ProfilesJson(serverNamespace = "silo-a"): string
{
	return JSON.stringify({
		"personal-default": {
			namespace: "silo-a-runtime",
			image: "ghcr.io/elewa-git/opencrane-agent-runtime@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
			imagePullPolicy: "IfNotPresent",
			runtimeStreamUrl: `http://opencrane-server.${serverNamespace}.svc.cluster.local:3001/api/internal/agent-runtime`,
				litellmBaseUrl: `http://litellm.${serverNamespace}.svc.cluster.local:4000`,
				serverNamespace,
			serviceAccountName: "agent-runtime-default",
			projectedTokenTtlSeconds: 600,
			scratchSize: "64Mi",
			activeDeadlineSeconds: 900,
			ttlSecondsAfterFinished: 0,
			resources: { requests: { cpu: "25m", memory: "64Mi" }, limits: { cpu: "250m", memory: "128Mi" } },
		},
		"managed-default": {
			namespace: "silo-a-managed-runtime",
			identityProfile: "managed",
			image: "ghcr.io/elewa-git/opencrane-agent-runtime@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
			imagePullPolicy: "IfNotPresent",
			runtimeStreamUrl: `http://opencrane-server.${serverNamespace}.svc.cluster.local:3001/api/internal/agent-runtime`,
			litellmBaseUrl: `http://litellm.${serverNamespace}.svc.cluster.local:4000`,
			serverNamespace,
			serviceAccountName: "managed-agent-runtime-default",
			projectedTokenTtlSeconds: 600,
			scratchSize: "64Mi",
			activeDeadlineSeconds: 900,
			ttlSecondsAfterFinished: 0,
			resources: { requests: { cpu: "25m", memory: "64Mi" }, limits: { cpu: "250m", memory: "128Mi" } },
		},
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

/** Return the Helm-equivalent fixed MCP bundle validator profile. */
function _McpbValidatorProfileJson(): string
{
	return JSON.stringify({ image: `ghcr.io/elewa-git/opencrane-mcpb-validator@sha256:${"c".repeat(64)}`, imagePullPolicy: "IfNotPresent", serverNamespace: "silo-a", namespace: "opencrane-mcpb-validation", serviceAccountName: "mcpb-validator-default", tokenAudience: "opencrane-mcpb-validator", bootstrapUrl: "http://opencrane-server.silo-a.svc.cluster.local:8081/api/internal/mcpb-validator", tokenPath: "/var/run/opencrane/tokens/validator.token", bootstrapReferencePath: "/var/run/opencrane/bootstrap/reference", scratchSize: "128Mi", activeDeadlineSeconds: 300, ttlSecondsAfterFinished: 0, resources: { requests: { cpu: "250m", memory: "256Mi" }, limits: { cpu: "1", memory: "1Gi" } } });
}

/** Return the minimal complete process environment. */
function _Environment(): NodeJS.ProcessEnv
{
	return { OPENCRANE_INTERNAL_URL: "http://opencrane-server.silo-a.svc.cluster.local:3001", OPENCRANE_CONTROLLER_TOKEN_PATH: "/var/run/opencrane/tokens/opencrane.token", AGENT_CONTROLLER_POLL_INTERVAL_MS: "1000", AGENT_CONTROLLER_PROFILES_JSON: _ProfilesJson(), AGENT_CONTROLLER_SKILL_WORKLOAD_PROFILES_JSON: _SkillProfilesJson(), AGENT_CONTROLLER_MCPB_VALIDATOR_PROFILE_JSON: _McpbValidatorProfileJson() };
}

describe("agent-controller process config", function _Suite()
{
	it("loads the explicit token path and namespace-bound immutable profiles", function _Loads()
	{
		const config = _ReadConfig(_Environment());
		expect(config.profiles["personal-default"]?.namespace).toBe("silo-a-runtime");
		expect(config.profiles["managed-default"]?.namespace).toBe("silo-a-managed-runtime");
		expect(config.profiles["managed-default"]?.serviceAccountName).toBe("managed-agent-runtime-default");
		expect(config.profiles["personal-default"]?.serverNamespace).toBe("silo-a");
		expect(config.controllerTokenPath).toBe("/var/run/opencrane/tokens/opencrane.token");
		expect(config.requestTimeoutMilliseconds).toBe(10_000);
		expect(config.outboxPruneIntervalMilliseconds).toBe(3_600_000);
		expect(config.profiles["personal-default"]?.serviceAccountName).toBe("agent-runtime-default");
		expect(config.skillWorkloadProfiles.authoring.serviceAccountName).toBe("skill-authoring-default");
		expect(config.mcpbValidatorProfile.serviceAccountName).toBe("mcpb-validator-default");
	});

	it("rejects a collapsed namespace or moving image tag", function _RejectsUnsafeConfig()
	{
		expect(function _SameNamespace() { _ReadConfig({ ..._Environment(), AGENT_CONTROLLER_PROFILES_JSON: _ProfilesJson("silo-a").replace("\"silo-a-runtime\"", "\"silo-a\"") }); }).toThrow(/unique runtime namespace separate/);
		expect(function _MovingImage() { _ReadConfig({ ..._Environment(), AGENT_CONTROLLER_PROFILES_JSON: _ProfilesJson().replace(/@sha256:[a-f0-9]{64}/, ":latest") }); }).toThrow(/immutable image/);
		expect(function _SkillProfileWrongClass() { _ReadConfig({ ..._Environment(), AGENT_CONTROLLER_SKILL_WORKLOAD_PROFILES_JSON: _SkillProfilesJson().replace("\"kind\":\"authoring\"", "\"kind\":\"tool-runner\"") }); }).toThrow(/wrong workload class/);
	});

	it("rejects an outbox-retention cadence outside the safe maintenance range", function _RejectsUnsafeRetentionInterval()
	{
		expect(function _TooFrequent() { _ReadConfig({ ..._Environment(), AGENT_CONTROLLER_OUTBOX_PRUNE_INTERVAL_MS: "59999" }); }).toThrow(/OUTBOX_PRUNE_INTERVAL/);
		expect(function _TooSlow() { _ReadConfig({ ..._Environment(), AGENT_CONTROLLER_OUTBOX_PRUNE_INTERVAL_MS: "86400001" }); }).toThrow(/OUTBOX_PRUNE_INTERVAL/);
	});

	it("identifies the exact JSON configuration source whose syntax is invalid", function _RejectsInvalidJson()
	{
		expect(function _InvalidRuntimeProfiles() { _ReadConfig({ ..._Environment(), AGENT_CONTROLLER_PROFILES_JSON: "{" }); }).toThrow(/AGENT_CONTROLLER_PROFILES_JSON must contain valid JSON/);
		expect(function _InvalidSkillProfiles() { _ReadConfig({ ..._Environment(), AGENT_CONTROLLER_SKILL_WORKLOAD_PROFILES_JSON: "{" }); }).toThrow(/AGENT_CONTROLLER_SKILL_WORKLOAD_PROFILES_JSON must contain valid JSON/);
	});
});
