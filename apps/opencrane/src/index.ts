// OpenTelemetry must be the first dependency evaluated so it can patch instrumented modules before
// the remaining import graph runs. Keep this side-effect import first when editing the entrypoint.
import "./bootstrap/process/instrument";

import type { Prisma } from "@prisma/client";
import { ___BindConsole } from "@opencrane/backend/observability";

import { _ReadAgentSandboxReleaseProfileConfig, _ReadProcessConfig } from "./bootstrap/configuration/config";
import { _CreateHistoryStoreComposition } from "@opencrane/backend/server/infra/history-store";
import { _AssertHistoryStoreSilo } from "@opencrane/backend/server/infra/history-store";
import { _StartConversationComputerActivationWorker } from "@opencrane/backend/server/conversations";
import { _CreateConversationGeneratedFileWorkflowComposition } from "./bootstrap/conversations/conversation-generated-file-workflow-composition";
import { _CreateConversationComputerWorkflowComposition } from "./bootstrap/conversations/conversation-computer-workflow-composition";
import { _CreateConversationComputerLifecycleComposition } from "./bootstrap/conversations/conversation-computer-lifecycle-composition";
import { _CreateInternalApp } from "./bootstrap/http/internal-app";
import { _CreateMcpWorkflowComposition } from "./bootstrap/workflows/mcp-workflow-composition";
import { _CreateMcpRuntimeComposition } from "./bootstrap/workflows/mcp-runtime-composition";
import { _CreateProductionConversationRunAdmission } from "@opencrane/backend/server/conversations";
import { _CreateMemoryGatewayClient } from "./bootstrap/process/memory-gateway-client.factory";
import { _CreateKubernetesClients } from "./bootstrap/process/kubernetes-clients";
import { _StartProcessLifecycle } from "./bootstrap/process/lifecycle";
import { _log } from "./bootstrap/process/log";
import { _CreatePublicApp, _CreatePublicAuthentication } from "./bootstrap/http/public-app";

import { _CreateArtifactUploadGateway, _CreatePublishedArtifactReader } from "@opencrane/backend/server/agents/artifacts";
import { PrismaConversationPromptDocumentRepository } from "@opencrane/backend/server/conversation-assets";
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
	// Capture stray console output before constructing dependencies that may log during startup.
	const unbindConsole = ___BindConsole(_log);

	// Read deployment configuration once and share the database, cluster and history clients across the process.
	const config = _ReadProcessConfig();
	const agentSandboxReleaseProfile = _ReadAgentSandboxReleaseProfileConfig();
	const prisma = ___CreatePrismaClient(_log);
	const kubernetes = _CreateKubernetesClients();
	const historyStore = _CreateHistoryStoreComposition(config.historyStore);
	// Stream names carry no silo id, so refuse to share one KurrentDB instance between silos before any worker touches it.
	await _AssertHistoryStoreSilo(historyStore.historyStore, config.workflows.siloId);
	const memoryWorkflow = { siloId: config.workflows.siloId, gateway: _CreateMemoryGatewayClient(config.runtime) };
	const workflows = _CreateMcpWorkflowComposition(prisma, config.workflows, config.runtime.memoryGatewayTimeoutMilliseconds);

	// Build the tool runtime before connecting conversation workflows to its admission and dispatch adapters.
	const mcpRuntime = _CreateMcpRuntimeComposition({
		prisma,
		kubernetes,
		processConfig: config,
		workflows,
		history: historyStore.historyStore,
	});
	// Generated-file processing reuses the tool runtime's invocation participants for authorization and lifecycle updates.
	const generatedFiles = _CreateConversationGeneratedFileWorkflowComposition(prisma, historyStore.historyStore, config.conversationPrivatePayloadKeyringPath, mcpRuntime.invocationParticipants, workflows.execution);
	const providerEffects = _CreateProviderEffectCommandExecutor(prisma, kubernetes.coreApi, config.runtime.serverNamespace, _log);
	// Run admission creates document repositories inside its prompt-preparation and compilation transactions.
	const documentAuthorities = { create: function _CreatePromptDocumentAuthority(transaction: Prisma.TransactionClient) { return new PrismaConversationPromptDocumentRepository(transaction); } };
	const conversationRunAdmission = _CreateProductionConversationRunAdmission(prisma, historyStore.historyStore, config.conversationPrivatePayloadKeyringPath, documentAuthorities, _CreatePublishedArtifactReader(prisma), config.runAdmission, _log);
	const conversationComputerWorkflows = _CreateConversationComputerWorkflowComposition({
		prisma,
		history: historyStore.historyStore,
		kubernetes,
		siloId: config.workflows.siloId,
		profile: agentSandboxReleaseProfile,
		keyringPath: config.conversationPrivatePayloadKeyringPath,
		runAdmission: conversationRunAdmission,
		runtimeAdmission: mcpRuntime.admitToolInvocationInTransaction,
		toolDispatch: mcpRuntime.toolDispatch,
		workflows: workflows.execution,
		generatedFiles: generatedFiles.resultReader,
		generatedOutput: generatedFiles.outputLinker,
	});
	// Register turn and stop handlers before activation can enqueue turns or request computer cleanup.
	const conversationComputerActivations = await _StartConversationComputerActivationWorker(prisma, kubernetes.customApi, historyStore.historyStore, workflows.execution, config.workflows.siloId, agentSandboxReleaseProfile, { stopAuthority: conversationComputerWorkflows.stopAuthority, logger: _log, onExhausted: function _RequestProcessShutdown() { process.kill(process.pid, "SIGTERM"); } });
	const conversationComputerLifecycle = _CreateConversationComputerLifecycleComposition(prisma, historyStore.historyStore, kubernetes.authApi, kubernetes.coreApi, kubernetes.customApi, config.workflows.siloId, agentSandboxReleaseProfile, config.conversationPrivatePayloadKeyringPath, workflows.execution);
	// Give process shutdown one stop hook for both computer workers before their shared stores close.
	const conversationComputerWorkers = { stop: async function _StopComputerWorkers(): Promise<void> { await Promise.all([conversationComputerActivations.stop(), conversationComputerLifecycle.worker.stop()]); } };

	// Public product routes authenticate browser sessions; internal routes verify the calling workload's identity.
	const authentication = _CreatePublicAuthentication(prisma, kubernetes.customApi, config.standaloneFirstUserAdmission);
	const publicHealth = ___CreatePublicHealthReportReader(prisma, config, _log);
	const publicApp = _CreatePublicApp(prisma, authentication, config.runtime.artifactScannerEnabled, publicHealth, workflows, mcpRuntime, providerEffects, memoryWorkflow, historyStore.historyStore, config.conversationPrivatePayloadKeyringPath, agentSandboxReleaseProfile);
	publicApp.locals.artifactUploadGateway = _CreateArtifactUploadGateway(prisma, workflows.execution);
	const internalApp = _CreateInternalApp(prisma, kubernetes.authApi, config.runtime, mcpRuntime, generatedFiles, workflows.execution, conversationComputerWorkflows.reviewCredentialRouter, conversationComputerLifecycle.router);
	// Start remaining workers after route composition registers its workflows, then bind both listeners and shutdown cleanup.
	await _StartProcessLifecycle(publicApp, internalApp, prisma, config, unbindConsole, mcpRuntime.authority, workflows.runtime, providerEffects, historyStore, conversationComputerWorkers);
}

void _Main().catch(function _fatalStartupError(err: unknown)
{
	_log.fatal({ err }, "opencrane control plane startup failed");
	process.exitCode = 1;
});
