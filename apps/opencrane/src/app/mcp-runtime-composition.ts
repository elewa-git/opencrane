import type * as k8s from "@kubernetes/client-node";
import type { Prisma, PrismaClient } from "@prisma/client";

import { MCP_EXECUTOR_PROFILE_NAME, MCP_EXECUTOR_SERVICE_ACCOUNT_NAME } from "@opencrane/contracts";
import { PrismaToolInvocationLifecycleEventUnitOfWork, PrismaToolInvocationRunRecoveryAuthority, PrismaToolRecoveryEventReporter } from "@opencrane/backend/agents/execution/runs";
import { __CreateMcpOciServerPromotionRouter, __CreateMcpRuntimeCompanionRouter, __CreateMcpRuntimeControllerRouter, __CreateMcpTaskWorkflow, PrismaMcpRuntimeUnitOfWork, PrismaRuntimeMcpEffectEligibilityAuthority } from "@opencrane/backend/server/gateways/mcp";
import { ManagedExecutionEvidenceAuthority, PersonalExecutionEvidenceAuthority, PrismaManagedExecutionEvidenceRepository, PrismaPersonalExecutionEvidenceRepository } from "@opencrane/backend/server/agents/agent-services";
import { ConversationComputerHistory, PrismaConversationToolDispatchAuthority, type ConversationToolDispatchDependencies } from "@opencrane/backend/server/conversations";
import { AgentIdentityHistory } from "@opencrane/backend/server/iam/identity";
import { __HumanMembershipRevision, _CreateHumanMembershipEvidenceConfig, type HumanMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { __CreatePrismaMcpToolInvocationParticipantFactory } from "@opencrane/backend/server/iam/authorization";
import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";
import { _CreateAgentControllerTokenReviewer, _CreateMcpExecutorTokenReviewer, _ValidateIsolatedWorkloadNamespace } from "@opencrane/backend/server/infra/workload-identity";

import type { InternalRuntimeConfig } from "./config.types";
import { _log } from "./log";
import type { McpRuntimeComposition } from "./mcp-runtime-composition.types";
import type { McpWorkflowComposition } from "./mcp-workflow-composition.types";

/** Polling cadence for durable public task completion after runtime admission. */
const _MCP_TASK_STATUS_POLL_MILLISECONDS = 250;

/** Compose the sole database and HTTP authority for OCI-backed MCP execution. */
export function _CreateMcpRuntimeComposition(prisma: PrismaClient, authApi: k8s.AuthenticationV1Api, config: InternalRuntimeConfig, workflows: McpWorkflowComposition, history: HistoryStore): McpRuntimeComposition
{
	const executorNamespace = _ValidateIsolatedWorkloadNamespace(config.mcpExecutorNamespace, config.serverNamespace);
	const dispatchDependencies = _CreateConversationToolDispatchDependencies(history, _CreateHumanMembershipEvidenceConfig());
	const participantFactory = __CreatePrismaMcpToolInvocationParticipantFactory(
		new PrismaToolInvocationLifecycleEventUnitOfWork(prisma),
		new PrismaToolRecoveryEventReporter(),
		new PrismaToolInvocationRunRecoveryAuthority(),
		{
			async isCurrentlyEligibleInTransaction(transaction, invocation, now)
			{
				const authority = new PrismaConversationToolDispatchAuthority(transaction as Prisma.TransactionClient, dispatchDependencies);
				return authority.isCurrentlyEligible(invocation, now);
			},
		},
	);
	const authority = new PrismaMcpRuntimeUnitOfWork(prisma, {
		toolInvocations: participantFactory,
		options: {
			siloId: config.siloId,
			executorNamespace,
			executorServiceAccountName: MCP_EXECUTOR_SERVICE_ACCOUNT_NAME,
			profileName: MCP_EXECUTOR_PROFILE_NAME,
			controllerClaimLeaseMilliseconds: config.mcpControllerClaimLeaseMilliseconds,
			companionClaimLeaseMilliseconds: config.mcpCompanionClaimLeaseMilliseconds,
			log: _log,
		},
	});
	const taskWorkflow = __CreateMcpTaskWorkflow({ execution: workflows.execution, unitOfWork: workflows.unitOfWork, runtime: authority, statusPollMilliseconds: _MCP_TASK_STATUS_POLL_MILLISECONDS });
	return {
		authority,
		taskWorkflow,
		promotion: __CreateMcpOciServerPromotionRouter({
			authority,
			resolveCaller: async function _ResolveCaller(request)
			{
				const principal = _ResolveRequestPrincipal(request);
				return principal === null ? null : { siloId: principal.siloId, principalId: principal.principalId };
			},
			logger: _log,
		}),
		controller: __CreateMcpRuntimeControllerRouter({ authority, tokenReviewer: _CreateAgentControllerTokenReviewer(authApi, config.serverNamespace), serverNamespace: config.serverNamespace, logger: _log }),
		companion: __CreateMcpRuntimeCompanionRouter({ authority, tokenReviewer: _CreateMcpExecutorTokenReviewer(authApi, executorNamespace), logger: _log }),
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
