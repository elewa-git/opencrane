import { AgentServiceKind, type Prisma, type PrismaClient } from "@prisma/client";

import { __AppendCompiledTool } from "@opencrane/backend/agents/execution/inputs";
import { PrismaRuntimeTerminalReporter } from "@opencrane/backend/agents/execution/runs";
import { __IsUpgradeSessionAvailable, PrismaPersonalConfigurationChangeRepository, UPGRADE_SESSION_TOOL, UPGRADE_SESSION_TOOL_REVISION } from "@opencrane/backend/agents/personal/configuration";
import { PrismaIntegrationAuthorityRepository, __SystemIntegrationAuthorityClock } from "@opencrane/backend/server/gateways/integrations";
import { PrismaToolInvocationRepository, __OpenDeferredToolApproval } from "@opencrane/backend/server/iam/authorization";
import type { RunInputSnapshot } from "@opencrane/contracts";
import { __UnavailableMemoryGatewayClient } from "@opencrane/server/_infra/memory-gateway-client";
import { __UnavailableObotMcpInvocationAdapter } from "@opencrane/server/_infra/obot-custody";
import { __UnavailableSandboxJobExecutor } from "@opencrane/server/_infra/sandbox-execution";
import type { Logger } from "@opencrane/observability";

import { __ExecuteExternalAction } from "./external-action-authority.js";
import { __CreateExternalActionExecutor, __PersonalMemoryDatasetId } from "./external-action-executor.js";
import { __CreatePrismaRunInputCompiler } from "./prisma-run-input-compiler.js";
import { PrismaRuntimeDispatchAuthority } from "./prisma-runtime-dispatch-authority.js";
import type { RunInputCompiler, RuntimeDispatchAuthorityConfig, RuntimeExternalActionRunner } from "./prisma-runtime-dispatch-authority.types.js";

/** Bounded lifetime of a pending deferred-tool approval before it is no longer actionable. */
const _DEFERRED_APPROVAL_TTL_MILLISECONDS = 24 * 60 * 60 * 1000;

/** Compile ordinary grants, then append the sealed first-party upgrade intent to proven personal services. */
function _CreateProductionRunInputCompiler(): RunInputCompiler
{
	const compile = __CreatePrismaRunInputCompiler();
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

/** Build the production external-action runner from its durable authorities and credential-free ports. */
function _CreateProductionExternalActionRunner(prisma: PrismaClient, log: Logger): RuntimeExternalActionRunner
{
	const repository = new PrismaToolInvocationRepository(prisma);
	const personalConfiguration = new PrismaPersonalConfigurationChangeRepository(prisma);
	const integrations = new PrismaIntegrationAuthorityRepository(prisma, new __SystemIntegrationAuthorityClock());
	const obotMcpInvocation = new __UnavailableObotMcpInvocationAdapter();
	const sandboxExecutor = new __UnavailableSandboxJobExecutor();
	const memoryGateway = new __UnavailableMemoryGatewayClient();
	return {
		async run(candidate, snapshot, compiledTools)
		{
			// 1. Derive approval and first-party policy only from the server-compiled tool descriptor.
			const tool = compiledTools.find(function _match(definition) { return definition.toolRevisionId === candidate.toolRevisionId; });
			const approvalRequired = tool?.requiresApproval ?? false;
			let executor;
			try
			{
				if (candidate.toolRevisionId === UPGRADE_SESSION_TOOL_REVISION && snapshot.identitySnapshot.kind !== "user") return { outcome: "denied" as const };
				executor = candidate.toolRevisionId === UPGRADE_SESSION_TOOL_REVISION
					? { execute: function _proposeUpgradeSession() { return personalConfiguration.proposeUpgradeSession(candidate, snapshot, new Date().toISOString()); } }
					: __CreateExternalActionExecutor(candidate, { siloId: snapshot.siloId, subjectId: snapshot.identitySnapshot.executionSubjectId, cogneeDatasetId: __PersonalMemoryDatasetId(snapshot), agentRevisionId: snapshot.agentRevisionId, integrations, obotMcpInvocation, sandboxExecutor, memoryGateway });
			}
			catch (error)
			{
				return { outcome: "retryable" as const, error };
			}

			// 2. Reserve before I/O; only proven terminal post-reservation outcomes become denials.
			const result = await __ExecuteExternalAction(repository, { candidate, snapshot, compiledTools, approvalRequired }, executor, log);
			if (result.outcome === "denied") return { outcome: "denied" as const };

			// 3. Atomically open approval for a deferred reservation or terminalise it without replay.
			if (result.outcome === "deferred")
			{
				const now = new Date();
				const deferred = await __OpenDeferredToolApproval(prisma, { runId: candidate.runId, attempt: candidate.attempt, toolInvocationId: candidate.toolInvocationId, toolRevisionId: candidate.toolRevisionId, argumentsDigest: candidate.argumentsDigest, capabilitySetDigest: snapshot.capabilitySetDigest, reservationId: result.reservationId, now, expiresAt: new Date(now.getTime() + _DEFERRED_APPROVAL_TTL_MILLISECONDS) }, log);
				return { outcome: deferred ? "completed" as const : "denied" as const };
			}
			return { outcome: "completed" as const };
		},
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
 * @returns One production dispatch authority ready for the runtime stream transport.
 */
export function __CreateProductionRuntimeDispatchAuthority(prisma: PrismaClient, config: RuntimeDispatchAuthorityConfig, log: Logger): PrismaRuntimeDispatchAuthority
{
	return new PrismaRuntimeDispatchAuthority(prisma, config, _CreateProductionRunInputCompiler(), _CreateProductionExternalActionRunner(prisma, log), new PrismaRuntimeTerminalReporter());
}
