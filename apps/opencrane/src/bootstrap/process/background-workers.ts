import type { PrismaClient } from "@prisma/client";

import type { McpRuntimeAuthority } from "@opencrane/backend/server/gateways/mcp";
import type { ProviderEffectCommandExecutor } from "@opencrane/backend/server/gateways/providers";
import type { IWorkflowWorkerRuntime } from "@opencrane/backend/server/infra/workflows/contract";

import type { OpenCraneBackgroundWorkers } from "./background-workers.types";
import type { OpenCraneProcessConfig } from "../configuration/config.types";
import { _log } from "./log";

/** Delay between server-owned checks for a lost MCP invocation completion report. */
const _MCP_INVOCATION_RECOVERY_INTERVAL_MILLISECONDS = 1_000;

/** Delay between bounded provider-command reconciliation passes. */
const _PROVIDER_EFFECT_INTERVAL_MILLISECONDS = 1_000;

/**
 * Start all bounded workers that intentionally share the control-plane database and identity.
 *
 * The returned stop handle is the lifecycle boundary: every loop must be stopped before Prisma is
 * disconnected, and none may keep the Node process alive on its own.
 */
export async function _StartBackgroundWorkers(_prisma: PrismaClient, _config: OpenCraneProcessConfig, mcpRuntime: McpRuntimeAuthority, workflowRuntime: IWorkflowWorkerRuntime, providerEffects: ProviderEffectCommandExecutor): Promise<OpenCraneBackgroundWorkers>
{
	// 1. Start the durable worker after application composition has registered every task handler.
	try
	{
		await workflowRuntime.startWorkers({ workerName: "opencrane-control-plane" });
	}
	catch (error)
	{
		try { await workflowRuntime.close(); }
		catch (closeError) { _log.error({ err: closeError }, "durable workflow cleanup after startup failure failed"); }
		throw error;
	}

	// 2. Reconcile each retained process-owned authority on its own bounded cadence.
	const mcpRecoveryHandle = setInterval(function _recoverMcpInvocation() { void mcpRuntime.recoverExpiredInvocation().catch(function _onError(error: unknown) { _log.error({ err: error }, "MCP invocation recovery pass failed"); }); }, _MCP_INVOCATION_RECOVERY_INTERVAL_MILLISECONDS);
	mcpRecoveryHandle.unref();
	const providerEffectHandle = setInterval(function _reconcileProviderEffect() { void providerEffects.reconcileNext().catch(function _onError(error: unknown) { _log.error({ err: error }, "provider effect reconciliation pass failed"); }); }, _PROVIDER_EFFECT_INTERVAL_MILLISECONDS);
	providerEffectHandle.unref();

	return {
		async stop(): Promise<void>
		{
			clearInterval(mcpRecoveryHandle);
			clearInterval(providerEffectHandle);
			await workflowRuntime.close();
		},
	};
}
