import type { PrismaClient } from "@prisma/client";

import { PrismaUpgradeSessionProposalRepository } from "@opencrane/backend/agents/personal/configuration";
import { PrismaIntegrationAuthorityRepository, __SystemIntegrationAuthorityClock } from "@opencrane/backend/server/gateways/integrations";
import { PrismaToolInvocationRepository, __OpenDeferredToolApproval } from "@opencrane/backend/server/iam/authorization";
import type { OpenDeferredToolApprovalCommand } from "@opencrane/backend/server/iam/authorization";
import type { Logger } from "@opencrane/observability";
import { __UnavailableMemoryGatewayClient } from "@opencrane/server/_infra/memory-gateway-client";
import { __UnavailableObotMcpInvocationAdapter } from "@opencrane/server/_infra/obot-custody";
import { __UnavailableSandboxJobExecutor } from "@opencrane/server/_infra/sandbox-execution";

import type { RuntimeExternalActionRunner } from "./prisma-runtime-dispatch-authority.types.js";
import { _CreateProductionExternalActionRunnerWithDependencies } from "./production-external-action-runner.js";
import type { ProductionDeferredApprovalOpener, ProductionExternalActionClock } from "./production-external-action-runner.types.js";

/** System clock used by the production composition. */
class _ProductionExternalActionClock implements ProductionExternalActionClock
{
	/** Returns the current server wall-clock instant. */
	now(): Date
	{
		return new Date();
	}
}

/** Binds the functional deferred-approval authority to process-owned persistence and logging. */
class _PrismaDeferredApprovalOpener implements ProductionDeferredApprovalOpener
{
	/** Canonical product-authority persistence client. */
	private readonly prisma: PrismaClient;
	/** Structured evidence sink for atomic approval-opening failures. */
	private readonly log: Logger;

	/** Creates an approval opener over process-owned dependencies. */
	constructor(prisma: PrismaClient, log: Logger)
	{
		this.prisma = prisma;
		this.log = log;
	}

	/** Opens one approval without exposing Prisma to the runner orchestration. */
	async open(command: OpenDeferredToolApprovalCommand): Promise<boolean>
	{
		return __OpenDeferredToolApproval(this.prisma, command, this.log);
	}
}

/** Compose the production external-action runner from durable authorities and fail-closed transports. */
export function _CreateProductionExternalActionRunner(prisma: PrismaClient, log: Logger): RuntimeExternalActionRunner
{
	return _CreateProductionExternalActionRunnerWithDependencies({
		invocations: new PrismaToolInvocationRepository(prisma),
		personalConfiguration: new PrismaUpgradeSessionProposalRepository(prisma),
		transports: {
			integrations: new PrismaIntegrationAuthorityRepository(prisma, new __SystemIntegrationAuthorityClock()),
			obotMcpInvocation: new __UnavailableObotMcpInvocationAdapter(),
			sandboxExecutor: new __UnavailableSandboxJobExecutor(),
			memoryGateway: new __UnavailableMemoryGatewayClient(),
		},
		approvals: new _PrismaDeferredApprovalOpener(prisma, log),
		clock: new _ProductionExternalActionClock(),
		log,
	});
}
