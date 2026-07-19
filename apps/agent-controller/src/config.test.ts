import { describe, expect, it } from "vitest";

import { _ReadConfig } from "./config.js";

/** Builds the closed controller environment accepted by the process boundary. */
function _Environment(): NodeJS.ProcessEnv
{
	return {
		AGENT_CONTROLLER_WORKLOAD_NAMESPACE: "opencrane-runtime",
		AGENT_RUNTIME_SERVICE_ACCOUNT: "agent-runtime",
		AGENT_RUNTIME_IMAGE: `ghcr.io/opencrane/agent-runtime@sha256:${"a".repeat(64)}`,
		AGENT_RUNTIME_APP_NAME: "opencrane",
		AGENT_RUNTIME_RELEASE_INSTANCE: "runtime-test",
		OPENCRANE_INTERNAL_URL: "http://opencrane.opencrane.svc.cluster.local:3000",
		AGENT_CONTROLLER_OPENCRANE_TOKEN_PATH: "/var/run/opencrane/tokens/opencrane/token",
		AGENT_CONTROLLER_KUBERNETES_TOKEN_PATH: "/var/run/opencrane/tokens/kubernetes/token",
		AGENT_CONTROLLER_KUBERNETES_CA_PATH: "/var/run/opencrane/tokens/kubernetes/ca.crt",
	};
}

describe("agent controller configuration", function _describeConfig()
{
	it("accepts only a service-root internal authority URL and defaults the probe port", function _readsRootUrl()
	{
		expect(_ReadConfig(_Environment())).toMatchObject({ openCraneInternalUrl: "http://opencrane.opencrane.svc.cluster.local:3000", healthPort: 8_080, runtimePodLabels: { "app.kubernetes.io/name": "opencrane", "app.kubernetes.io/instance": "runtime-test" } });
		expect(function _rejectsRouteBase() { _ReadConfig({ ..._Environment(), OPENCRANE_INTERNAL_URL: "http://opencrane.opencrane.svc.cluster.local:3000/api/internal/agent-controller" }); }).toThrow("agent controller configuration is incomplete or unsafe");
	});

	it("rejects a probe listener port outside the unprivileged TCP range", function _rejectsInvalidPort()
	{
		expect(function _rejectsPrivilegedPort() { _ReadConfig({ ..._Environment(), AGENT_CONTROLLER_HEALTH_PORT: "80" }); }).toThrow("AGENT_CONTROLLER_HEALTH_PORT must be between 1024 and 65535");
	});
});
