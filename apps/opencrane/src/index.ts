// OpenTelemetry must be the first dependency evaluated so it can patch instrumented modules before
// the remaining import graph runs. Keep this side-effect import first when editing the entrypoint.
import "./app/instrument";

import { __CreateManagedRunAdmissionPort, __CreatePersonalRunAdmissionPort, __ReadRunAdmissionConcurrencyPolicy, _CreateRunAdmissionCapacityGate } from "@opencrane/backend/agents/execution/admission";
import { _CreateManagedExecutionEvidenceAuthority } from "@opencrane/backend/server/agents/agent-services";
import { _CreateFleetMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";
import { ___BindConsole } from "@opencrane/backend/observability";

import { _ReadProcessConfig } from "./app/config";
import { _ReconcileChannelTargetRoutes, _StartChannelTargetRouteReconciler } from "./app/channel-target-composition";
import { _CreateExternalActionWorker } from "./app/external-action-composition";
import { _CreateInternalApp } from "./app/internal-app";
import { _BootstrapInitialModel } from "./app/initial-model-bootstrap";
import { _CreateKubernetesClients } from "./app/kubernetes-clients";
import { _StartProcessLifecycle } from "./app/lifecycle";
import { _log } from "./app/log";
import { _CreatePublicApp, _CreatePublicAuthentication } from "./app/public-app";
import { _CreateRunCancellationAuthority } from "./app/run-cancellation-composition";
import { _CreateArtifactUploadGateway } from "./infra/artifacts/artifact-upload.factory";
import { ___CreatePrismaClient } from "./infra/db/db";
import { _CreateObotAdapters } from "./infra/obot/obot-adapters.factory";

/**
 * Compose the process once, from telemetry through coordinated shutdown.
 *
 * This entrypoint owns only app wiring and lifecycle. Product authorities remain in packages, and
 * the public and workload-facing routers remain separate even though they share one process.
 */
async function _Main(): Promise<void>
{
	// 1. Capture stray console output before constructing dependencies that may log during startup.
	const unbindConsole = ___BindConsole(_log);

	// 2. Freeze process configuration and external clients so every component shares one target.
	const config = _ReadProcessConfig();
	const prisma = ___CreatePrismaClient(_log);
	const kubernetes = _CreateKubernetesClients();
	await _BootstrapInitialModel({ prisma, coreApi: kubernetes.coreApi, config: config.initialModelBootstrap, namespace: config.runtime.serverNamespace });
	await _ReconcileChannelTargetRoutes(prisma, config.runtime.channelTargets);

	// 3. Compose one shared capacity gate and deployment-selected membership evidence for every run
	//    entrypoint. Standalone has no key mount and remains deny-only until a local issuer exists.
	const runAdmissionCapacityGate = _CreateRunAdmissionCapacityGate(__ReadRunAdmissionConcurrencyPolicy());
	const membershipEvidence = _CreateFleetMembershipEvidenceConfig();
	const managedRunAdmission = __CreateManagedRunAdmissionPort(prisma, runAdmissionCapacityGate, _CreateManagedExecutionEvidenceAuthority());
	const personalRunAdmission = __CreatePersonalRunAdmissionPort(prisma, runAdmissionCapacityGate, membershipEvidence);
	const runCancellation = _CreateRunCancellationAuthority(prisma, config.runtime);

	// 4. Compose the server-owned Obot custody and action transport without exposing it to runtimes.
	const obot = _CreateObotAdapters(config.obot);
	const externalActions = _CreateExternalActionWorker(prisma, obot.invocation, _log);
	const channelTargetRoutes = _StartChannelTargetRouteReconciler(prisma, config.runtime.channelTargets);

	// 5. Build separate HTTP listeners; only the internal app receives workload-only routes.
	const authentication = _CreatePublicAuthentication(prisma, kubernetes.customApi, config.standaloneFirstUserAdmission);
	const publicApp = _CreatePublicApp(prisma, kubernetes.coreApi, managedRunAdmission, personalRunAdmission, runCancellation, config.runtime.serverNamespace, obot.custody, authentication, config.runtime.artifactScannerEnabled);
	publicApp.locals.artifactUploadGateway = _CreateArtifactUploadGateway(prisma);
	const internalApp = _CreateInternalApp(prisma, kubernetes.authApi, config.runtime, authentication.sessionMiddleware);

	// 6. Start listeners and workers under one drain order so shared dependencies close exactly once.
	_StartProcessLifecycle(publicApp, internalApp, prisma, kubernetes.batchApi, managedRunAdmission, runCancellation, config, channelTargetRoutes, unbindConsole, externalActions, obot.stop);
}

void _Main().catch(function _fatalStartupError(err: unknown)
{
	_log.fatal({ err }, "opencrane control plane startup failed");
	process.exitCode = 1;
});
