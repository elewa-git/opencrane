import type { PrismaClient } from "@prisma/client";

import type { ExternalActionWorker } from "@opencrane/backend/agents/execution/protocol";
import type { ManagedRunAdmissionPort } from "@opencrane/backend/server/agents/agent-services";
import type { McpRuntimeAuthority } from "@opencrane/backend/server/gateways/mcp";
import type { ProviderEffectCommandExecutor } from "@opencrane/backend/server/gateways/providers";
import { _CreateScheduleTicker, PrismaScheduleTickerUnitOfWork } from "@opencrane/backend/server/agents/scheduling";
import type { IWorkflowWorkerRuntime } from "@opencrane/backend/server/infra/workflows/contract";

import type { OpenCraneBackgroundWorkers } from "./background-workers.types";
import type { OpenCraneProcessConfig } from "./config.types";
import { _log } from "./log";

/** Delay between bounded durable external-action passes. */
const _EXTERNAL_ACTION_INTERVAL_MILLISECONDS = 1_000;

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
export async function _StartBackgroundWorkers(prisma: PrismaClient, managedRunAdmission: ManagedRunAdmissionPort, config: OpenCraneProcessConfig, externalActions: ExternalActionWorker, mcpRuntime: McpRuntimeAuthority, workflowRuntime: IWorkflowWorkerRuntime, providerEffects: ProviderEffectCommandExecutor | null = null): Promise<OpenCraneBackgroundWorkers>
{
	// 1. Prepare optional schedule admission through the same capacity port used by run-now requests.
	const scheduleTicker = _CreateScheduleTicker(new PrismaScheduleTickerUnitOfWork(prisma), managedRunAdmission, _log);

	// 2. Start the durable worker after application composition has registered every task handler.
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

	// 3. Start process-owned intervals only after the durable worker is ready.
	const schedulerHandle = config.schedulerEnabled
		? setInterval(function _tick() { void scheduleTicker.runOnce(new Date()).catch(function _onError(error: unknown) { _log.error({ err: error }, "managed-agent schedule tick failed"); }); }, config.schedulerIntervalMilliseconds)
		: null;
	schedulerHandle?.unref();

	// 4. Poll at most one durable action per pass; the worker itself prevents overlapping provider I/O.
	const externalActionHandle = setInterval(function _externalAction() { void externalActions.runOnce().catch(function _onError(error: unknown) { _log.error({ err: error }, "external action worker pass failed"); }); }, _EXTERNAL_ACTION_INTERVAL_MILLISECONDS);
	externalActionHandle.unref();
	const mcpRecoveryHandle = setInterval(function _recoverMcpInvocation() { void mcpRuntime.recoverExpiredInvocation().catch(function _onError(error: unknown) { _log.error({ err: error }, "MCP invocation recovery pass failed"); }); }, _MCP_INVOCATION_RECOVERY_INTERVAL_MILLISECONDS);
	mcpRecoveryHandle.unref();
	const providerEffectHandle = providerEffects === null
		? null
		: setInterval(function _reconcileProviderEffect() { void providerEffects.reconcileNext().catch(function _onError(error: unknown) { _log.error({ err: error }, "provider effect reconciliation pass failed"); }); }, _PROVIDER_EFFECT_INTERVAL_MILLISECONDS);
	providerEffectHandle?.unref();

	return {
		async stop(): Promise<void>
		{
			if (schedulerHandle !== null)
				clearInterval(schedulerHandle);
			clearInterval(externalActionHandle);
			clearInterval(mcpRecoveryHandle);
			if (providerEffectHandle !== null)
				clearInterval(providerEffectHandle);
			await Promise.all([externalActions.drain(), workflowRuntime.close()]);
		},
	};
}
