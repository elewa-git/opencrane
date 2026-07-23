import { describe, expect, it } from "vitest";

import { _ReadConfig } from "../config.js";

/** Return one Helm-equivalent immutable profile JSON value. */
function _ProfilesJson(serverNamespace = "silo-a"): string
{
	return JSON.stringify({
		"personal-default": {
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
	});
}

/** Return the minimal complete process environment. */
function _Environment(): NodeJS.ProcessEnv
{
	return { OPENCRANE_INTERNAL_URL: "http://opencrane-server.silo-a.svc.cluster.local:3001", OPENCRANE_CONTROLLER_TOKEN_PATH: "/var/run/opencrane/tokens/opencrane.token", AGENT_RUNTIME_NAMESPACE: "silo-a-runtime", AGENT_CONTROLLER_POLL_INTERVAL_MS: "1000", AGENT_CONTROLLER_PROFILES_JSON: _ProfilesJson() };
}

describe("agent-controller process config", function _Suite()
{
	it("loads the explicit token paths, namespace, and validated immutable profiles", function _Loads()
	{
		const config = _ReadConfig(_Environment());
		expect(config.runtimeNamespace).toBe("silo-a-runtime");
		expect(config.profiles["personal-default"]?.serverNamespace).toBe("silo-a");
		expect(config.controllerTokenPath).toBe("/var/run/opencrane/tokens/opencrane.token");
		expect(config.requestTimeoutMilliseconds).toBe(10_000);
		expect(config.outboxPruneIntervalMilliseconds).toBe(3_600_000);
		expect(config.profiles["personal-default"]?.serviceAccountName).toBe("agent-runtime-default");
	});

	it("rejects a collapsed namespace or moving image tag", function _RejectsUnsafeConfig()
	{
		expect(function _SameNamespace() { _ReadConfig({ ..._Environment(), AGENT_RUNTIME_NAMESPACE: "silo-a" }); }).toThrow(/namespaces separate/);
		expect(function _MovingImage() { _ReadConfig({ ..._Environment(), AGENT_CONTROLLER_PROFILES_JSON: _ProfilesJson().replace(/@sha256:[a-f0-9]{64}/, ":latest") }); }).toThrow(/immutable image/);
	});

	it("rejects an outbox-retention cadence outside the safe maintenance range", function _RejectsUnsafeRetentionInterval()
	{
		expect(function _TooFrequent() { _ReadConfig({ ..._Environment(), AGENT_CONTROLLER_OUTBOX_PRUNE_INTERVAL_MS: "59999" }); }).toThrow(/OUTBOX_PRUNE_INTERVAL/);
		expect(function _TooSlow() { _ReadConfig({ ..._Environment(), AGENT_CONTROLLER_OUTBOX_PRUNE_INTERVAL_MS: "86400001" }); }).toThrow(/OUTBOX_PRUNE_INTERVAL/);
	});
});
