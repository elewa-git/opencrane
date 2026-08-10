import { AgentServiceKind, type Prisma, type PrismaClient } from "@prisma/client";

import { __AppendCompiledTool } from "@opencrane/backend/agents/execution/inputs";
import { PrismaRuntimeTerminalReporter } from "@opencrane/backend/agents/execution/runs";
import { __IsUpgradeSessionAvailable, UPGRADE_SESSION_TOOL } from "@opencrane/backend/agents/personal/configuration";
import type { IntegrationAuthorityRepository } from "@opencrane/backend/server/gateways/integrations";
import type { RunInputSnapshot } from "@opencrane/contracts";
import type { Logger } from "@opencrane/backend/observability";
import type { MemoryGatewayClient } from "@opencrane/backend/server/infra/memory-gateway-client";

import { __CreatePrismaRunInputCompiler } from "./prisma-run-input-compiler.js";
import { PrismaRuntimeDispatchAuthority } from "./prisma-runtime-dispatch-authority.js";
import type { RunInputCompiler, RuntimeDispatchAuthorityConfig } from "./prisma-runtime-dispatch-authority.types.js";
import { _CreateProductionExternalActionRunner } from "./production-external-action-runner.composition.js";

/** Compile ordinary grants, then append the sealed first-party upgrade intent to proven personal services. */
function _CreateProductionRunInputCompiler(memoryGateway: MemoryGatewayClient, integrationAuthority: IntegrationAuthorityRepository | null): RunInputCompiler
{
	const compile = __CreatePrismaRunInputCompiler(memoryGateway, integrationAuthority);
	return async function _compileRunInput(snapshot: RunInputSnapshot, transaction: Prisma.TransactionClient)
	{
		// 1. Compile the immutable snapshot before considering any first-party descriptor.
		const input = await compile(snapshot, transaction);

		// 2. Exclude non-conversation and non-persona snapshots without inferring a personal service.
		if (!__IsUpgradeSessionAvailable(snapshot)) return input;

		// 3. Prove the service kind in the same compiler transaction and re-seal only that descriptor.
		const service = await transaction.agentService.findFirst({ where: { id: snapshot.agentServiceId, siloId: snapshot.siloId, kind: AgentServiceKind.Personal }, select: { id: true } });
		return service === null ? input : __AppendCompiledTool(input, UPGRADE_SESSION_TOOL);
	};
}

/**
 * Construct the production runtime dispatch authority behind the workload stream.
 *
 * This factory is the sole concrete policy composition for compiled input, external actions,
 * deferred approvals, terminal reporting, and transport ports. The app supplies process-owned
 * Prisma, configuration, and logging only; it does not reimplement execution decisions.
 *
 * @param prisma - Canonical product-authority persistence client.
 * @param config - Deployment-fixed namespaces, command lifetime, and retry bounds.
 * @param log - Structured process logger used for bounded execution evidence.
 * @param memoryGateway - One authenticated memory-gateway client shared by the compiler and the runner transport.
 * @param integrationAuthority - App-constructed live custody resolver used to compile per-tool Obot
 *   addressing, or null to compile integration tools without a direct-invocation address.
 * @returns One production dispatch authority ready for the runtime stream transport.
 */
export function __CreateProductionRuntimeDispatchAuthority(prisma: PrismaClient, config: RuntimeDispatchAuthorityConfig, log: Logger, memoryGateway: MemoryGatewayClient, integrationAuthority: IntegrationAuthorityRepository | null = null): PrismaRuntimeDispatchAuthority
{
	return new PrismaRuntimeDispatchAuthority(prisma, config, _CreateProductionRunInputCompiler(memoryGateway, integrationAuthority), _CreateProductionExternalActionRunner(prisma, log, memoryGateway), new PrismaRuntimeTerminalReporter());
}
