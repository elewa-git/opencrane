import { ConversationComputerHistory } from "@opencrane/backend/server/conversations/computers";
import type { Prisma, PrismaClient } from "@prisma/client";

import { MCP_EXECUTOR_PROFILE_NAME, MCP_EXECUTOR_SERVICE_ACCOUNT_NAME } from "@opencrane/contracts";
import { PrismaToolInvocationLifecycleEventUnitOfWork, PrismaToolInvocationRunRecoveryAuthority, PrismaToolRecoveryEventReporter } from "@opencrane/backend/agents/execution/runs";
import { _CreateConversationGeneratedFileResultParticipant } from "@opencrane/backend/server/conversation-assets";
import { AesGcmConversationPrivatePayloadCipher, _ReadConversationPrivatePayloadKeyring } from "@opencrane/backend/server/conversations/history";
import { _CreateMcpServerWorkloadIdentityReader, McpInvocationDispatchOutcomes, McpInvocationOwnerKinds, PrismaMcpConnectionExecutionSettlementUnitOfWork, PrismaRemoteMcpDispatchUnitOfWork, RemoteMcpInvocationExecutor, _CreateMcpToolInvocationAdmission, _ResolveMcpOciServerPromotionCaller, __CreateMcpOciServerPromotionRouter, __CreateMcpRuntimeCompanionRouter, __CreateMcpRuntimeControllerRouter, __CreateMcpTaskWorkflow, PrismaMcpRuntimeUnitOfWork, PrismaRuntimeMcpEffectEligibilityAuthority, type McpInvocationExecutor } from "@opencrane/backend/server/gateways/mcp";
import { ManagedExecutionEvidenceAuthority, PersonalExecutionEvidenceAuthority, PrismaManagedExecutionEvidenceRepository, PrismaPersonalExecutionEvidenceRepository } from "@opencrane/backend/server/agents/agent-services";
import { PrismaConversationComputerTurnWorkflowEventRepository, PrismaConversationToolDispatchAuthority, type ConversationComputerToolInvocationDispatch, type ConversationToolDispatchDependencies } from "@opencrane/backend/server/conversations";
import { AgentIdentityHistory } from "@opencrane/backend/server/iam/identity";
import { __HumanMembershipRevision, _CreateHumanMembershipEvidenceConfig, type HumanMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { __CreatePrismaMcpToolInvocationParticipantFactory } from "@opencrane/backend/server/iam/authorization";
import { _CreateMcpServerTokenReviewer, _CreateAgentControllerTokenReviewer, _CreateMcpExecutorTokenReviewer, _ValidateIsolatedWorkloadNamespace } from "@opencrane/backend/server/infra/workload-identity";

import type { OpenCraneProcessConfig } from "../configuration/config.types";
import { _log } from "../process/log";
import type { OpenCraneKubernetesClients } from "../process/kubernetes-clients.types";
import { _CreateMcpConnectionComposition } from "./mcp-connection-composition";
import type { McpRuntimeComposition } from "./mcp-runtime-composition.types";
import type { McpWorkflowComposition } from "./mcp-workflow-composition.types";

/** Polling cadence for durable public task completion after runtime admission. */
const _MCP_TASK_STATUS_POLL_MILLISECONDS = 250;

/** Connects OCI and remote MCP execution to the same ToolInvocation authority and Absurd engine. */
export function _CreateMcpRuntimeComposition(prisma: PrismaClient, kubernetes: Pick<OpenCraneKubernetesClients, "authApi" | "coreApi">, processConfig: Pick<OpenCraneProcessConfig, "runtime" | "mcpConnections" | "workflows" | "conversationPrivatePayloadKeyringPath">, workflows: McpWorkflowComposition, history: HistoryStore): McpRuntimeComposition
{
	const { runtime: config, mcpConnections } = processConfig;
	const { authApi, coreApi } = kubernetes;
	const executorNamespace = _ValidateIsolatedWorkloadNamespace(config.mcpExecutorNamespace, config.serverNamespace);
	const dispatchDependencies = _CreateConversationToolDispatchDependencies(history, _CreateHumanMembershipEvidenceConfig());
	const cipher = AesGcmConversationPrivatePayloadCipher.fromDocument(_ReadConversationPrivatePayloadKeyring(processConfig.conversationPrivatePayloadKeyringPath));
	const participantFactory = __CreatePrismaMcpToolInvocationParticipantFactory(
		new PrismaToolInvocationLifecycleEventUnitOfWork(prisma, async function _EmitTurnEvent(transaction, event)
		{
			await new PrismaConversationComputerTurnWorkflowEventRepository(transaction, workflows.execution).emit(event);
		}),
		new PrismaToolRecoveryEventReporter(),
		new PrismaToolInvocationRunRecoveryAuthority(),
		{
			async admitUntilInTransaction(transaction, invocation, now, workload)
			{
				const authority = new PrismaConversationToolDispatchAuthority(transaction as Prisma.TransactionClient, dispatchDependencies);
				return authority.admitUntil(invocation, now, workload);
			},
		},
	);
	const options = {
		siloId: config.siloId,
		executorNamespace,
		executorServiceAccountName: MCP_EXECUTOR_SERVICE_ACCOUNT_NAME,
		profileName: MCP_EXECUTOR_PROFILE_NAME,
		controllerClaimLeaseMilliseconds: config.mcpControllerClaimLeaseMilliseconds,
		companionClaimLeaseMilliseconds: config.mcpCompanionClaimLeaseMilliseconds,
		log: _log,
	};
	const invocationResults = { __ForTransaction: function _Results(transactionValue: unknown)
	{
		const transaction = transactionValue as Prisma.TransactionClient;
		const dispatch = new PrismaConversationToolDispatchAuthority(transaction, dispatchDependencies);
		return _CreateConversationGeneratedFileResultParticipant(transaction, cipher, workflows.execution, dispatch, config.artifactScannerEnabled);
	} };
	const authority = new PrismaMcpRuntimeUnitOfWork(prisma, { toolInvocations: participantFactory, invocationResults, options });
	const settlement = new PrismaMcpConnectionExecutionSettlementUnitOfWork(prisma, participantFactory);
	const connections = _CreateMcpConnectionComposition(prisma, { coreApi, config: mcpConnections, workflows, settlement });
	const serverIdentity = _CreateMcpServerWorkloadIdentityReader({ tokenPath: mcpConnections.tokenPath, expectedPodUid: mcpConnections.serverPodUid, reviewer: _CreateMcpServerTokenReviewer(authApi, mcpConnections.serverNamespace, mcpConnections.serverServiceAccountName) });
	const remoteAuthority = new PrismaRemoteMcpDispatchUnitOfWork(prisma, participantFactory, invocationResults, processConfig.workflows.mcpRemoteTimeoutMilliseconds);
	const invocationExecutor = new RemoteMcpInvocationExecutor({ authority: remoteAuthority, serverIdentity, credentials: connections.credentials, client: workflows.remoteClient, timeoutMilliseconds: processConfig.workflows.mcpRemoteTimeoutMilliseconds });
	const taskWorkflow = __CreateMcpTaskWorkflow({ invocationExecutor, execution: workflows.execution, unitOfWork: workflows.unitOfWork, runtime: authority, statusPollMilliseconds: _MCP_TASK_STATUS_POLL_MILLISECONDS });
	return {
		authority,
		connections: connections.authority,
		toolDispatch: _CreateConversationMcpToolDispatch(invocationExecutor),
		invocationParticipants: participantFactory,
		admitToolInvocationInTransaction: _CreateMcpToolInvocationAdmission(participantFactory, options),
		taskWorkflow,
		promotion: __CreateMcpOciServerPromotionRouter({
			authority,
			resolveCaller: _ResolveMcpOciServerPromotionCaller,
			logger: _log,
		}),
		controller: __CreateMcpRuntimeControllerRouter({ authority, tokenReviewer: _CreateAgentControllerTokenReviewer(authApi, config.serverNamespace), serverNamespace: config.serverNamespace, logger: _log }),
		companion: __CreateMcpRuntimeCompanionRouter({ authority, tokenReviewer: _CreateMcpExecutorTokenReviewer(authApi, executorNamespace), logger: _log }),
	};
}

/** Keeps the turn's saved owner coordinates when handing a public invocation ID to MCP. */
export function _CreateConversationMcpToolDispatch(invocationExecutor: McpInvocationExecutor): ConversationComputerToolInvocationDispatch
{
	return {
		async tryExecute(command)
		{
			return await invocationExecutor.execute({ ownerKind: McpInvocationOwnerKinds.Run, ...command }) !== McpInvocationDispatchOutcomes.AwaitingOciCompanion;
		},
		async settleExhausted(command)
		{
			return invocationExecutor.settleExhausted({ ownerKind: McpInvocationOwnerKinds.Run, ...command });
		},
	};
}

/** Bind current execution and assignment readers without moving their domain decisions into the app. */
export function _CreateConversationToolDispatchDependencies(history: HistoryStore, membership: HumanMembershipEvidenceConfig): ConversationToolDispatchDependencies
{
	return {
		identities: new AgentIdentityHistory(history),
		computers: new ConversationComputerHistory(history),
		membershipRevision: __HumanMembershipRevision,
		executionEvidence: function _Evidence(transactionValue)
		{
			const transaction = transactionValue as Prisma.TransactionClient;
			const personal = new PersonalExecutionEvidenceAuthority(new PrismaPersonalExecutionEvidenceRepository(transaction, membership));
			const managed = new ManagedExecutionEvidenceAuthority(new PrismaManagedExecutionEvidenceRepository(transaction, membership));
			return { loadPersonal: personal.load.bind(personal), loadManaged: managed.load.bind(managed) };
		},
		toolEligibility: function _Eligibility(transaction) { return new PrismaRuntimeMcpEffectEligibilityAuthority(transaction as Prisma.TransactionClient); },
	};
}
