import { AgentServiceKind, type Prisma, type PrismaClient } from "@prisma/client";

import { __AppendCompiledTool } from "@opencrane/backend/agents/execution/inputs";
import { PrismaRuntimeEventReporter } from "@opencrane/backend/agents/execution/runs";
import { __IsUpgradeSessionAvailable, UPGRADE_SESSION_TOOL } from "@opencrane/backend/agents/personal/configuration";
import { __ExpireDeferredToolApprovalBatch } from "@opencrane/backend/server/iam/authorization";
import type { RunInputSnapshot } from "@opencrane/contracts";
import type { MemoryGatewayClient } from "@opencrane/backend/server/infra/memory-gateway-client";

import { __CreatePrismaRunInputCompiler } from "./prisma-run-input-compiler.js";
import { PrismaRuntimeDispatchAuthority } from "./prisma-runtime-dispatch-authority.js";
import type { RunInputCompiler, RuntimeApprovalExpiry, RuntimeDispatchAuthorityConfig } from "./prisma-runtime-dispatch-authority.types.js";

/** Compile the snapshot's tools, then add the built-in upgrade-session tool for runs whose service really is Personal. */
function _CreateProductionRunInputCompiler(memoryGateway: MemoryGatewayClient): RunInputCompiler
{
	const compile = __CreatePrismaRunInputCompiler(memoryGateway);
	return async function _compileRunInput(snapshot: RunInputSnapshot, transaction: Prisma.TransactionClient)
	{
		// 1. Compile the snapshot first, before considering the built-in tool.
		const input = await compile(snapshot, transaction);

		// 2. Skip snapshots that have no conversation or no persona, without guessing the service kind.
		if (!__IsUpgradeSessionAvailable(snapshot)) return input;

		// 3. Confirm the service is Personal in the same transaction, and add only that one tool.
		const service = await transaction.agentService.findFirst({ where: { id: snapshot.agentServiceId, siloId: snapshot.siloId, kind: AgentServiceKind.Personal }, select: { id: true } });
		return service === null ? input : __AppendCompiledTool(input, UPGRADE_SESSION_TOOL);
	};
}

/** Wire command polling to `__ExpireDeferredToolApprovalBatch`. */
function _CreateProductionApprovalExpiry(): RuntimeApprovalExpiry
{
	return { expireInTransaction: __ExpireDeferredToolApprovalBatch };
}

/**
 * Construct the production runtime dispatch authority behind the workload stream.
 *
 * This factory is the sole concrete policy composition for compiled input, durable external-action
 * admission, deferred approvals, and canonical runtime event reporting. Provider execution belongs
 * to the separate server worker and never enters runtime-stream composition.
 *
 * @param prisma - Canonical product-authority persistence client.
 * @param config - Deployment-fixed namespaces, command lifetime, and retry bounds.
 * @param memoryGateway - One authenticated memory-gateway client used by the input compiler.
 * @returns One production dispatch authority ready for the runtime stream transport.
 */
export function __CreateProductionRuntimeDispatchAuthority(prisma: PrismaClient, config: RuntimeDispatchAuthorityConfig, memoryGateway: MemoryGatewayClient): PrismaRuntimeDispatchAuthority
{
	return new PrismaRuntimeDispatchAuthority(prisma, config, _CreateProductionRunInputCompiler(memoryGateway), new PrismaRuntimeEventReporter(), undefined, _CreateProductionApprovalExpiry());
}
