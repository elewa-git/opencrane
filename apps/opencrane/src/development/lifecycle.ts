import type { Server } from "node:http";

import { _log } from "../app/log";
import { _RethrowAfterDevelopmentCleanup, _RunDevelopmentCleanup } from "./cleanup";
import type { DevelopmentServerComposition, DevelopmentServerHandle } from "./composition.types";

/** Delay between current provider-effect reconciliation passes in local development. */
const _PROVIDER_EFFECT_INTERVAL_MILLISECONDS = 1_000;

/** Close one listener after it stops accepting new connections. */
function _CloseServer(server: Server): Promise<void>
{
	return new Promise<void>(function _Closed(resolve, reject)
	{
		server.close(function _AfterClose(error)
		{
			if (error)
			{
				reject(error);
			}
			else
			{
				resolve();
			}
		});
	});
}

/** Bind the current product app only to IPv4 loopback. */
function _Listen(composition: DevelopmentServerComposition, port: number): Promise<Server>
{
	return new Promise<Server>(function _Start(resolve, reject)
	{
		const server = composition.app.listen(port, "127.0.0.1");
		server.once("error", reject);
		server.once("listening", function _Listening()
		{
			server.removeListener("error", reject);
			resolve(server);
		});
	});
}

/**
 * Start current workflow/recovery authorities and the loopback public listener.
 *
 * Called by: the Tier 2 development entrypoint after it composes the resources labelled for this checkout.
 */
export async function _StartDevelopmentServer(composition: DevelopmentServerComposition, port: number): Promise<DevelopmentServerHandle>
{
	let computerHandle: { readonly stop: () => Promise<void> } | null = null;
	let server: Server | null = null;
	try
	{
		await composition.workflowRuntime.startWorkers({ workerName: "opencrane-tier2-control-plane" });
		if (composition.conversationComputer)
		{
			computerHandle = await composition.conversationComputer.start();
		}
		server = await _Listen(composition, port);
	}
	catch (error)
	{
		return _RethrowAfterDevelopmentCleanup(error, [
			[
				function _StopComputer(): Promise<void> { return computerHandle?.stop() ?? Promise.resolve(); },
				composition.workflowRuntime.close.bind(composition.workflowRuntime),
			],
			[composition.historyStore.close, composition.prisma.$disconnect.bind(composition.prisma)],
		], "Tier 2 product-server startup cleanup failed");
	}

	_log.info({ host: "127.0.0.1", port }, "Tier 2 product server listening");
	let providerPass: Promise<void> | null = null;
	let providerRecoveryStopped = false;

	/** Run one provider pass and release its process-local admission fence after settlement. */
	async function _ReconcileProvider(): Promise<void>
	{
		try
		{
			await composition.providerEffects.reconcileNext();
		}
		catch (error)
		{
			_log.error({ err: error }, "Tier 2 provider reconciliation pass failed");
		}
		finally
		{
			providerPass = null;
		}
	}

	/** Admit a provider pass only when the previous pass has settled and shutdown has not started. */
	function _RecoverProvider(): void
	{
		if (providerRecoveryStopped || providerPass)
			return;
		providerPass = Promise.resolve().then(_ReconcileProvider);
	}

	const providerRecovery = setInterval(_RecoverProvider, _PROVIDER_EFFECT_INTERVAL_MILLISECONDS);
	providerRecovery.unref();
	const activeServer = server;
	let stopping: Promise<void> | null = null;

	/** Stop the listener and background workers once, preserving every cleanup failure. */
	function _Stop(): Promise<void>
	{
		if (stopping)
			return stopping;
		providerRecoveryStopped = true;
		clearInterval(providerRecovery);
		const drainingProviderPass = providerPass;
		stopping = _RunDevelopmentCleanup([
			[function _DrainProviderPass(): Promise<void> { return drainingProviderPass ?? Promise.resolve(); }],
			[
				function _StopComputer(): Promise<void> { return computerHandle?.stop() ?? Promise.resolve(); },
				function _StopServer(): Promise<void> { return _CloseServer(activeServer); },
				composition.workflowRuntime.close.bind(composition.workflowRuntime),
			],
			[composition.historyStore.close, composition.prisma.$disconnect.bind(composition.prisma)],
		], "Tier 2 product-server cleanup failed");
		return stopping;
	}

	return { stop: _Stop };
}
