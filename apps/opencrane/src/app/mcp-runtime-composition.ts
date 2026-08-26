import type * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";

import { MCP_EXECUTOR_PROFILE_NAME, MCP_EXECUTOR_SERVICE_ACCOUNT_NAME } from "@opencrane/contracts";
import { PrismaToolInvocationLifecycleEventUnitOfWork, PrismaToolInvocationRunRecoveryAuthority, PrismaToolRecoveryEventReporter } from "@opencrane/backend/agents/execution/runs";
import { __CreateMcpOciServerPromotionRouter, __CreateMcpRuntimeCompanionRouter, __CreateMcpRuntimeControllerRouter, PrismaMcpRuntimeUnitOfWork } from "@opencrane/backend/server/gateways/mcp";
import { __CreatePrismaMcpToolInvocationParticipantFactory } from "@opencrane/backend/server/iam/authorization";
import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";
import { _CreateAgentControllerTokenReviewer, _CreateMcpExecutorTokenReviewer, _ValidateIsolatedWorkloadNamespace } from "@opencrane/backend/server/infra/workload-identity";

import type { InternalRuntimeConfig } from "./config.types";
import { _log } from "./log";
import type { McpRuntimeComposition } from "./mcp-runtime-composition.types";

/** Compose the sole database and HTTP authority for OCI-backed MCP execution. */
export function _CreateMcpRuntimeComposition(prisma: PrismaClient, authApi: k8s.AuthenticationV1Api, config: InternalRuntimeConfig): McpRuntimeComposition
{
	const executorNamespace = _ValidateIsolatedWorkloadNamespace(config.mcpExecutorNamespace, config.serverNamespace);
	const participantFactory = __CreatePrismaMcpToolInvocationParticipantFactory(
		new PrismaToolInvocationLifecycleEventUnitOfWork(prisma),
		new PrismaToolRecoveryEventReporter(),
		new PrismaToolInvocationRunRecoveryAuthority(),
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
	return {
		authority,
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
