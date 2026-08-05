// OpenTelemetry must be the first dependency evaluated so it can patch instrumented modules before
// the remaining import graph runs. Keep this side-effect import first when editing the entrypoint.
import "./app/instrument.js";

import { __CreateManagedRunAdmissionPort, __ReadRunAdmissionConcurrencyPolicy } from "@opencrane/backend/agents/execution/admission";
import { _CreateManagedExecutionEvidenceAuthority } from "@opencrane/backend/server/agents/agent-services";
import { ___BindConsole } from "@opencrane/backend/observability";

import { _ReadProcessConfig } from "./app/config.js";
import { _CreateInternalApp } from "./app/internal-app.js";
import { _CreateKubernetesClients } from "./app/kubernetes-clients.js";
import { _StartProcessLifecycle } from "./app/lifecycle.js";
import { _log } from "./app/log.js";
import { _CreatePublicApp } from "./app/public-app.js";
import { _CreateArtifactUploadGateway } from "./infra/artifacts/artifact-upload.factory.js";
import { ___CreatePrismaClient } from "./infra/db/db.js";
import { _CreateMemoryGatewayClient } from "./infra/memory/memory-gateway-client.factory.js";
import { _CreateObotAdapters } from "./infra/obot/obot-adapters.factory.js";

/**
 * Compose the process once, from telemetry through coordinated shutdown.
 *
 * This entrypoint owns only app wiring and lifecycle. Product authorities remain in packages, and
 * the public and workload-facing routers remain separate even though they share one process.
 */
function _Main(): void
{
	// 1. Capture stray console output before constructing dependencies that may log during startup.
	const unbindConsole = ___BindConsole(_log);

	// 2. Freeze process configuration and external clients so every component shares one target.
	const config = _ReadProcessConfig();
	const prisma = ___CreatePrismaClient(_log);
	const kubernetes = _CreateKubernetesClients();
	const memoryGateway = _CreateMemoryGatewayClient(config.runtime);

	// 3. Compose the single managed-run capacity authority shared by HTTP and scheduled admissions.
	const managedRunAdmission = __CreateManagedRunAdmissionPort(prisma, __ReadRunAdmissionConcurrencyPolicy(), _CreateManagedExecutionEvidenceAuthority());

	// 4. Compose the optional Obot custody and attempt-key transport once, so the public custody
	//    route and the runtime dispatch plane always target the same Obot with one credential.
	const obot = _CreateObotAdapters(config.obot);

	// 5. Build separate transport surfaces; only the internal app receives workload-only routes.
	const publicApp = _CreatePublicApp(prisma, kubernetes.customApi, kubernetes.coreApi, managedRunAdmission, config.authWatchNamespace, config.runtime.serverNamespace, obot.custody);
	publicApp.locals.artifactUploadGateway = _CreateArtifactUploadGateway(prisma);
	const internalApp = _CreateInternalApp(prisma, kubernetes.authApi, config.runtime, memoryGateway, obot.attemptKeys);

	// 6. Start listeners and workers under one drain order so shared dependencies close exactly once.
	_StartProcessLifecycle(publicApp, internalApp, prisma, kubernetes.batchApi, managedRunAdmission, config, unbindConsole);
}

_Main();
