import "./instrument.js";

import * as k8s from "@kubernetes/client-node";

import { _ControllerAuthorityHttpClient, _KubernetesAgentJobMutator } from "@opencrane/backend/agent-controller/kubernetes";
import { ___BindConsole, ___ShutdownTelemetry } from "@opencrane/observability";

import { _ReadConfig } from "./config.js";
import { _ReconcileOnce } from "./controller-loop.js";
import { _CreateControllerHealth } from "./health.js";
import { _log as log } from "./log.js";

/** Starts the bounded database-blind controller loop. */
async function _Main(): Promise<void>
{
	const config = _ReadConfig();
	const kubeConfig = new k8s.KubeConfig();
	kubeConfig.loadFromOptions({ clusters: [{ name: "in-cluster", server: "https://kubernetes.default.svc", caFile: config.kubernetesCaPath, skipTLSVerify: false }], users: [{ name: "agent-controller", tokenFile: config.kubernetesTokenPath }], contexts: [{ name: "agent-controller", cluster: "in-cluster", user: "agent-controller" }], currentContext: "agent-controller" });
	const authority = new _ControllerAuthorityHttpClient({ baseUrl: config.openCraneInternalUrl, tokenPath: config.openCraneTokenPath, fetch: globalThis.fetch });
	const dependencies = { policy: { runtimeNamespace: config.runtimeNamespace, runtimeServiceAccountName: config.runtimeServiceAccountName, runtimeImage: config.runtimeImage }, desiredJobs: authority, status: authority, jobs: new _KubernetesAgentJobMutator(kubeConfig.makeApiClient(k8s.BatchV1Api), kubeConfig.makeApiClient(k8s.CoreV1Api)) };
	const unbindConsole = ___BindConsole(log);
	const health = _CreateControllerHealth({ port: config.healthPort });
	await health.listen();
	let stopping = false;
	let active = false;
	const timer = setInterval(function _tick() { void _reconcile(); }, config.pollIntervalMs);
	await _reconcile();

	async function _reconcile(): Promise<void>
	{
		if (active || stopping) return;
		active = true;
		try
		{
			await _ReconcileOnce(dependencies, health, log);
		}
		finally
		{
			active = false;
		}
	}

	async function _shutdown(signal: string): Promise<void>
	{
		stopping = true;
		clearInterval(timer);
		log.info({ signal }, "agent controller shutting down");
		await health.shutdown();
		await ___ShutdownTelemetry();
		unbindConsole();
		process.exit(0);
	}
	process.on("SIGTERM", function _sigterm() { void _shutdown("SIGTERM"); });
	process.on("SIGINT", function _sigint() { void _shutdown("SIGINT"); });
}

void _Main().catch(function _startupFailure(err)
{
	log.error({ err }, "agent controller startup failed");
	process.exitCode = 1;
});
