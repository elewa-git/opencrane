// OpenTelemetry must be the first dependency evaluated so it can patch instrumented modules before
// the remaining import graph runs. Keep this side-effect import first when editing the entrypoint.
import "./bootstrap/process/instrument";

import { ___BindConsole } from "@opencrane/backend/observability";

import { _ReadAgentSandboxReleaseProfileConfig, _ReadProcessConfig } from "./bootstrap/configuration/config";
import { _CreateHistoryStoreComposition } from "@opencrane/backend/server/infra/history-store";
import { _AssertHistoryStoreSilo } from "@opencrane/backend/server/infra/history-store";
import { _StartConversationComputerActivationWorker } from "@opencrane/backend/server/conversations";
import { _CreateConversationComputerWorkflowComposition } from "./bootstrap/conversations/conversation-computer-workflow-composition";
import { _CreateConversationComputerLifecycleComposition } from "./bootstrap/conversations/conversation-computer-lifecycle-composition";
import { _CreateInternalApp } from "./bootstrap/http/internal-app";
import { _CreateMcpWorkflowComposition } from "./bootstrap/workflows/mcp-workflow-composition";
import { _CreateMcpRuntimeComposition } from "./bootstrap/workflows/mcp-runtime-composition";
import { _CreateProductionConversationRunAdmission } from "@opencrane/backend/server/conversations";
import { _CreateKubernetesClients } from "./bootstrap/process/kubernetes-clients";
import { _StartProcessLifecycle } from "./bootstrap/process/lifecycle";
import { _log } from "./bootstrap/process/log";
import { _CreatePublicApp, _CreatePublicAuthentication } from "./bootstrap/http/public-app";

import { _CreateArtifactUploadGateway } from "@opencrane/backend/server/agents/artifacts";
import { ___CreatePrismaClient } from "@opencrane/backend/server/infra/prisma-unit-of-work";
import { ___CreatePublicHealthReportReader } from "@opencrane/backend/server/infra/http";
import { _CreateProviderEffectCommandExecutor } from "@opencrane/backend/server/gateways/providers";

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
	const agentSandboxReleaseProfile = _ReadAgentSandboxReleaseProfileConfig();
	const prisma = ___CreatePrismaClient(_log);
	const kubernetes = _CreateKubernetesClients();
	const historyStore = _CreateHistoryStoreComposition(config.historyStore);
	// Stream names carry no silo id, so refuse to share one KurrentDB instance between silos before any worker touches it.
	await _AssertHistoryStoreSilo(historyStore.historyStore, config.workflows.siloId);
	const workflows = _CreateMcpWorkflowComposition(prisma, config.workflows);

	// 3. Compose the retained workload authorities.
	const mcpRuntime = _CreateMcpRuntimeComposition(prisma, kubernetes.authApi, config.runtime, workflows, historyStore.historyStore);
	const providerEffects = _CreateProviderEffectCommandExecutor(prisma, kubernetes.coreApi, config.runtime.serverNamespace, _log);
	const conversationRunAdmission = _CreateProductionConversationRunAdmission(prisma, historyStore.historyStore, config.conversationPrivatePayloadKeyringPath, config.runAdmission, _log);
	const conversationComputerReviewCredential = _CreateConversationComputerWorkflowComposition(prisma, historyStore.historyStore, kubernetes.authApi, kubernetes.coreApi, kubernetes.customApi, config.workflows.siloId, agentSandboxReleaseProfile, config.conversationPrivatePayloadKeyringPath, conversationRunAdmission, mcpRuntime.admitToolInvocationInTransaction, workflows.execution);
	const conversationComputerActivations = await _StartConversationComputerActivationWorker(prisma, kubernetes.customApi, historyStore.historyStore, workflows.execution, config.workflows.siloId, agentSandboxReleaseProfile, { logger: _log, onExhausted: function _RequestProcessShutdown() { process.kill(process.pid, "SIGTERM"); } });
	const conversationComputerLifecycle = _CreateConversationComputerLifecycleComposition(prisma, historyStore.historyStore, kubernetes.authApi, kubernetes.coreApi, kubernetes.customApi, config.workflows.siloId, agentSandboxReleaseProfile, config.conversationPrivatePayloadKeyringPath, workflows.execution);
	const conversationComputerWorkers = { stop: async function _StopComputerWorkers(): Promise<void> { await Promise.all([conversationComputerActivations.stop(), conversationComputerLifecycle.worker.stop()]); } };

	// 4. Build separate HTTP listeners; only the internal app receives workload-only routes.
	const authentication = _CreatePublicAuthentication(prisma, kubernetes.customApi, config.standaloneFirstUserAdmission);
	const publicHealth = ___CreatePublicHealthReportReader(prisma, config, _log);
	const publicApp = _CreatePublicApp(prisma, authentication, config.runtime.artifactScannerEnabled, publicHealth, workflows, mcpRuntime, providerEffects, historyStore.historyStore, config.conversationPrivatePayloadKeyringPath, agentSandboxReleaseProfile);
	publicApp.locals.artifactUploadGateway = _CreateArtifactUploadGateway(prisma, workflows.execution);
	const internalApp = _CreateInternalApp(prisma, kubernetes.authApi, config.runtime, mcpRuntime, workflows.execution, conversationComputerReviewCredential, conversationComputerLifecycle.router);
	// 5. Start listeners and workers under one drain order so shared dependencies close exactly once.
	await _StartProcessLifecycle(publicApp, internalApp, prisma, config, unbindConsole, mcpRuntime.authority, workflows.runtime, providerEffects, historyStore, conversationComputerWorkers);
}

void _Main().catch(function _fatalStartupError(err: unknown)
{
	_log.fatal({ err }, "opencrane control plane startup failed");
	process.exitCode = 1;
});
