import type { PrismaClient } from "@prisma/client";

import { PrismaElicitationUnitOfWork } from "@opencrane/backend/agents/execution/elicitation";
import { PrismaExternalActionExecutionContextUnitOfWork, __CreateProductionExternalActionApprovalOpener, __CreateProductionExternalActionWorker, type ExternalActionClassAdmission, type ExternalActionWorker } from "@opencrane/backend/agents/execution/protocol";
import { PrismaToolInvocationLifecycleEventUnitOfWork, PrismaToolInvocationRunRecoveryAuthority, PrismaToolRecoveryEventReporter } from "@opencrane/backend/agents/execution/runs";
import { PrismaUpgradeSessionProposalUnitOfWork } from "@opencrane/backend/agents/personal/configuration";
import type { Logger } from "@opencrane/backend/observability";
import { PrismaToolInvocationUnitOfWork } from "@opencrane/backend/server/iam/authorization";
import { PrismaIntegrationAuthorityRepository, __SystemIntegrationAuthorityClock } from "@opencrane/backend/server/gateways/integrations";
import type { ObotMcpInvocationPort } from "@opencrane/backend/server/infra/obot-custody";
import { __UnavailableSandboxJobExecutor } from "@opencrane/backend/server/infra/sandbox-execution";

/** Compose the process-owned worker, approval authority, and provider transports as one unit. */
export function _CreateExternalActionWorker(prisma: PrismaClient, obotInvocation: ObotMcpInvocationPort, classAdmission: ExternalActionClassAdmission, log: Logger): ExternalActionWorker
{
	const lifecycleEvents = new PrismaToolInvocationLifecycleEventUnitOfWork(prisma);
	const personalMemoryPermissions = new PrismaElicitationUnitOfWork(prisma);
	return __CreateProductionExternalActionWorker({
		classAdmission,
		invocations: new PrismaToolInvocationUnitOfWork(prisma, lifecycleEvents, new PrismaToolRecoveryEventReporter(), new PrismaToolInvocationRunRecoveryAuthority()),
		contexts: new PrismaExternalActionExecutionContextUnitOfWork(prisma),
		events: lifecycleEvents,
		approvals: __CreateProductionExternalActionApprovalOpener(prisma, log),
		personalMemoryPermissions,
		transports: {
			integrations: new PrismaIntegrationAuthorityRepository(prisma, new __SystemIntegrationAuthorityClock()),
			obotMcpInvocation: obotInvocation,
			sandboxExecutor: new __UnavailableSandboxJobExecutor(),
		},
		personalConfiguration: new PrismaUpgradeSessionProposalUnitOfWork(prisma, log),
		log,
	});
}
