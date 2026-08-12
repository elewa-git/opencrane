import type { PrismaClient } from "@prisma/client";

import { PrismaExternalActionExecutionContextUnitOfWork, __CreateProductionExternalActionApprovalOpener, __CreateProductionExternalActionWorker, type ExternalActionWorker } from "@opencrane/backend/agents/execution/protocol";
import { PrismaToolInvocationLifecycleEventUnitOfWork, PrismaToolInvocationRunRecoveryAuthority, PrismaToolRecoveryEventReporter } from "@opencrane/backend/agents/execution/runs";
import { PrismaUpgradeSessionProposalUnitOfWork } from "@opencrane/backend/agents/personal/configuration";
import type { Logger } from "@opencrane/backend/observability";
import { PrismaToolInvocationUnitOfWork } from "@opencrane/backend/server/iam/authorization";
import { PrismaIntegrationAuthorityRepository, __SystemIntegrationAuthorityClock } from "@opencrane/backend/server/gateways/integrations";
import type { MemoryGatewayClient } from "@opencrane/backend/server/infra/memory-gateway-client";
import type { ObotMcpInvocationPort } from "@opencrane/backend/server/infra/obot-custody";
import { __UnavailableSandboxJobExecutor } from "@opencrane/backend/server/infra/sandbox-execution";

/** Compose the external-action worker, its approval authority, and its provider transports together. */
export function _CreateExternalActionWorker(prisma: PrismaClient, memoryGateway: MemoryGatewayClient, obotInvocation: ObotMcpInvocationPort, log: Logger): ExternalActionWorker
{
	const lifecycleEvents = new PrismaToolInvocationLifecycleEventUnitOfWork(prisma);
	return __CreateProductionExternalActionWorker({
		invocations: new PrismaToolInvocationUnitOfWork(prisma, lifecycleEvents, new PrismaToolRecoveryEventReporter(), new PrismaToolInvocationRunRecoveryAuthority()),
		contexts: new PrismaExternalActionExecutionContextUnitOfWork(prisma),
		events: lifecycleEvents,
		approvals: __CreateProductionExternalActionApprovalOpener(prisma, log),
		transports: {
			integrations: new PrismaIntegrationAuthorityRepository(prisma, new __SystemIntegrationAuthorityClock()),
			obotMcpInvocation: obotInvocation,
			sandboxExecutor: new __UnavailableSandboxJobExecutor(),
			memoryGateway,
		},
		personalConfiguration: new PrismaUpgradeSessionProposalUnitOfWork(prisma, log),
		log,
	});
}
