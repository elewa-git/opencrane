// OpenTelemetry must be the first dependency evaluated so it can patch instrumented modules before
// the remaining import graph runs. Keep this side-effect import first when editing the entrypoint.
import "./app/instrument";

import type { PrismaClient } from "@prisma/client";
import { __CreateManagedRunAdmissionPort, __CreatePersonalRunAdmissionPort, __ReadRunAdmissionConcurrencyPolicy, _CreateRunAdmissionCapacityGate } from "@opencrane/backend/agents/execution/admission";
import { _CreateElicitationInterruptReader } from "@opencrane/backend/agents/execution/elicitation";
import { ConversationComputerActivationClaimAuthority, ConversationComputerExecutionAuthority, ConversationComputerHistory, ConversationComputerParticipantInputAdmission, ConversationComputerParticipantInputAuthority, ConversationComputerParticipantInputDispatchAuthority, ConversationComputerRuntimeCommandAuthority, ConversationComputerSandboxReconciliationAuthority, ConversationHistoryReader, PrismaConversationComputerParticipantInputAuthorizerUnitOfWork, PrismaConversationPrivatePayloadStoreUnitOfWork, _CreatePrismaSelfConversationSocketServer } from "@opencrane/backend/server/conversations";
import type { ConversationComputerActivationAuthority } from "@opencrane/backend/server/conversations";
import { _CreateConversationAttachmentAdmission } from "@opencrane/backend/server/conversation-assets";
import { _KubernetesAgentSandboxClaimAuthority, _KubernetesAgentSandboxClaimObservationReader, _KubernetesAgentSandboxRuntimePodReader } from "@opencrane/backend/server/infra/agent-sandbox-claims";
import { MountedConversationPayloadCipher } from "@opencrane/backend/server/infra/conversation-payloads";
import { ___BindConsole } from "@opencrane/backend/observability";

import { _ReadProcessConfig } from "./app/config";
import { _CreateConversationComputerActivationProfileResolver, _StartConversationComputerActivationWorker } from "./app/conversation-computer-activation-composition";
import { _CreateHistoryAnchoredConversationCreationAuthority } from "./app/conversation-history-creation-composition";
import type { OpenCraneConversationComputerActivationWorker } from "./app/conversation-computer-activation-composition.types";
import { _StartConversationComputerSandboxReconciliationWorker } from "./app/conversation-computer-sandbox-reconciliation-composition";
import type { OpenCraneConversationComputerSandboxReconciliationWorker } from "./app/conversation-computer-sandbox-reconciliation-composition.types";
import { _ReconcileChannelTargetRoutes, _StartChannelTargetRouteReconciler } from "./app/channel-target-composition";
import { _CreateExternalActionWorker } from "./app/external-action-composition";
import { _CreateHistoryStoreComposition } from "./app/history-store-composition";
import { _CreateInternalApp } from "./app/internal-app";
import { _CreateMcpWorkflowComposition } from "./app/mcp-workflow-composition";
import { _CreateMcpRuntimeComposition } from "./app/mcp-runtime-composition";
import { _CreateKubernetesClients } from "./app/kubernetes-clients";
import { _StartProcessLifecycle } from "./app/lifecycle";
import { _log } from "./app/log";
import { _CreatePublicApp, _CreatePublicAuthentication } from "./app/public-app";
import { _CreateRunCancellationAuthority } from "./app/run-cancellation-composition";
import { _CreateConversationSocketAuthenticator } from "./app/conversation-socket-authenticator";
import { _RequireExecutionSubjectComposition } from "./app/execution-subject-composition";
import { _ProcessShutdownSignal } from "./app/process-shutdown";
import { _CreateArtifactUploadGateway } from "./infra/artifacts/artifact-upload.factory";
import { ___CreatePrismaClient } from "./infra/db/db";
import { ___CreatePublicHealthReportReader } from "./infra/health/public-health";
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
	const prisma: PrismaClient = ___CreatePrismaClient(_log);
	const kubernetes = _CreateKubernetesClients();
	const historyStore = _CreateHistoryStoreComposition(config.historyStore);
	const workflows = _CreateMcpWorkflowComposition(prisma, config.workflows);
	await _ReconcileChannelTargetRoutes(prisma, config.runtime.channelTargets);

	// 3. Require the complete target evidence adapter before exposing either initial admission or retry.
	const executionSubjects = _RequireExecutionSubjectComposition(historyStore.historyStore);
	const runAdmissionCapacityGate = _CreateRunAdmissionCapacityGate(__ReadRunAdmissionConcurrencyPolicy());
	const managedRunAdmission = __CreateManagedRunAdmissionPort(prisma, workflows.execution, runAdmissionCapacityGate, executionSubjects.admissionAuthority);
	const personalRunAdmission = __CreatePersonalRunAdmissionPort(prisma, workflows.execution, runAdmissionCapacityGate, executionSubjects.admissionAuthority);
	const runCancellation = _CreateRunCancellationAuthority(prisma);
	const conversationCreation = _CreateHistoryAnchoredConversationCreationAuthority(prisma, historyStore.historyStore, config.runtime.conversationComputerActivation, config.runtime.siloId);

	// 4. Compose the class-specific MCP authority before the generic external-action worker.
	const channelTargetRoutes = _StartChannelTargetRouteReconciler(prisma, config.runtime.channelTargets);
	const mcpRuntime = _CreateMcpRuntimeComposition(prisma, kubernetes.authApi, config.runtime, workflows);
	const externalActions = _CreateExternalActionWorker(prisma, mcpRuntime.authority, _log);
	const providerEffects = _CreateProviderEffectCommandExecutor(prisma, kubernetes.coreApi, config.runtime.serverNamespace, _log);
	let conversationComputerActivationAuthority: ConversationComputerActivationAuthority | null = null;
	let conversationComputerSandboxReconciliationAuthority: ConversationComputerSandboxReconciliationAuthority | null = null;
	let conversationComputerExecutionAuthority: ConversationComputerExecutionAuthority | null = null;
	let conversationComputerParticipantInputDispatchAuthority: ConversationComputerParticipantInputDispatchAuthority | null = null;
	let conversationComputerParticipantInputs: ConversationComputerParticipantInputAdmission | null = null;
	if (config.runtime.conversationComputerActivation !== null)
	{
		const profiles = _CreateConversationComputerActivationProfileResolver(config.runtime.conversationComputerActivation, config.runtime.siloId);
		conversationComputerActivationAuthority = new ConversationComputerActivationClaimAuthority({
			history: new ConversationComputerHistory(historyStore.historyStore),
			profiles,
			claims: new _KubernetesAgentSandboxClaimAuthority(kubernetes.customApi),
			clock: { now: function _Now() { return new Date(); } },
		});
		conversationComputerSandboxReconciliationAuthority = new ConversationComputerSandboxReconciliationAuthority({
			history: new ConversationComputerHistory(historyStore.historyStore),
			profiles,
			observations: new _KubernetesAgentSandboxClaimObservationReader(kubernetes.customApi),
			runtimePods: new _KubernetesAgentSandboxRuntimePodReader(kubernetes.customApi, kubernetes.coreApi),
			clock: { now: function _Now() { return new Date(); } },
		});
		conversationComputerExecutionAuthority = new ConversationComputerExecutionAuthority(new ConversationComputerHistory(historyStore.historyStore), { now: function _Now() { return new Date(); } });
		const conversationPayloads = new PrismaConversationPrivatePayloadStoreUnitOfWork(prisma, new MountedConversationPayloadCipher(config.runtime.conversationPayloadKeyringPath!));
		const participantInputs = new ConversationComputerParticipantInputAuthority({
			history: historyStore.historyStore,
			conversations: new ConversationHistoryReader(historyStore.historyStore),
			payloads: conversationPayloads,
			clock: { now: function _Now() { return new Date(); } },
		});
		conversationComputerParticipantInputs = new ConversationComputerParticipantInputAdmission(new PrismaConversationComputerParticipantInputAuthorizerUnitOfWork(prisma), participantInputs);
		const commands = new ConversationComputerRuntimeCommandAuthority({ history: historyStore.historyStore, computers: new ConversationComputerHistory(historyStore.historyStore), clock: { now: function _Now() { return new Date(); } } });
		conversationComputerParticipantInputDispatchAuthority = new ConversationComputerParticipantInputDispatchAuthority({ conversations: new ConversationHistoryReader(historyStore.historyStore), commands });
	}

	// 5. Build separate HTTP listeners; only the internal app receives workload-only routes.
	const authentication = _CreatePublicAuthentication(prisma, kubernetes.customApi, config.standaloneFirstUserAdmission);
	const publicHealth = ___CreatePublicHealthReportReader(prisma, config, _log);
	const publicApp = _CreatePublicApp(prisma, managedRunAdmission, personalRunAdmission, runCancellation, executionSubjects.retryInputCompiler, conversationCreation, conversationComputerParticipantInputs, authentication, config.runtime.artifactScannerEnabled, publicHealth, workflows, mcpRuntime, providerEffects);
	publicApp.locals.artifactUploadGateway = _CreateArtifactUploadGateway(prisma, workflows.execution);
	const internalApp = _CreateInternalApp(prisma, kubernetes.authApi, config.runtime, authentication.sessionMiddleware, mcpRuntime, workflows.execution, historyStore.historyStore);
	const conversationSockets = _CreatePrismaSelfConversationSocketServer(prisma, personalRunAdmission, workflows.execution, executionSubjects.retryInputCompiler, _CreateConversationAttachmentAdmission, conversationCreation, conversationComputerParticipantInputs, _log, _CreateConversationSocketAuthenticator(authentication.sessionMiddleware, authentication.authMiddleware), { interrupts: _CreateElicitationInterruptReader(prisma), shutdownSignal: _ProcessShutdownSignal });
	const conversationComputerActivation: OpenCraneConversationComputerActivationWorker | null = conversationComputerActivationAuthority === null
		? null
		: await _StartConversationComputerActivationWorker(historyStore.historyStore, conversationComputerActivationAuthority, config.runtime.siloId);
	let conversationComputerSandboxReconciliation: OpenCraneConversationComputerSandboxReconciliationWorker | null = null;
	if (conversationComputerSandboxReconciliationAuthority !== null && conversationComputerExecutionAuthority !== null && conversationComputerParticipantInputDispatchAuthority !== null)
	{
		try
		{
			conversationComputerSandboxReconciliation = await _StartConversationComputerSandboxReconciliationWorker(historyStore.historyStore, conversationComputerSandboxReconciliationAuthority, conversationComputerExecutionAuthority, conversationComputerParticipantInputDispatchAuthority, config.runtime.siloId);
		}
		catch (error)
		{
			await conversationComputerActivation?.stop();
			throw error;
		}
	}

	// 6. Start listeners and workers under one drain order so shared dependencies close exactly once.
	await _StartProcessLifecycle(publicApp, internalApp, prisma, managedRunAdmission, config, channelTargetRoutes, conversationSockets, unbindConsole, externalActions, mcpRuntime.authority, workflows.runtime, providerEffects, historyStore, conversationComputerActivation, conversationComputerSandboxReconciliation);
}

void _Main().catch(function _fatalStartupError(err: unknown)
{
	_log.fatal({ err }, "opencrane control plane startup failed");
	process.exitCode = 1;
});
