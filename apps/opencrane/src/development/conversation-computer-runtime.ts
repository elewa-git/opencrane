import type { DevelopmentConversationComputerSupervisor, DevelopmentWorkerHandle } from "./composition.types";
import type { HostDevelopmentConversationComputerSupervisor } from "./conversation-computer-host-supervisor";
import { _RethrowAfterDevelopmentCleanup, _RunDevelopmentCleanup } from "./cleanup";

/** Starts retained-state convergence, activation, and the private listener in authority order. */
export class DevelopmentConversationComputerRuntime implements DevelopmentConversationComputerSupervisor
{
	/** Compose replaceable start boundaries so ordering and failure cleanup remain directly testable. */
	public constructor(private readonly startLifecycle: () => Promise<DevelopmentWorkerHandle>, private readonly startActivations: () => Promise<DevelopmentWorkerHandle>, private readonly privateListener: Pick<HostDevelopmentConversationComputerSupervisor, "start" | "stop">) {}

	/** Reconcile retained leases before subscribing to activation and accepting private traffic. */
	public async start(): Promise<DevelopmentWorkerHandle>
	{
		let lifecycle: DevelopmentWorkerHandle | null = null;
		let activations: DevelopmentWorkerHandle | null = null;
		try
		{
			lifecycle = await this.startLifecycle();
			activations = await this.startActivations();
			await this.privateListener.start();
		}
		catch (error)
		{
			return _RethrowAfterDevelopmentCleanup(error, [
				[
					function _StopActivations(): Promise<void> { return activations?.stop() ?? Promise.resolve(); },
					function _StopLifecycle(): Promise<void> { return lifecycle?.stop() ?? Promise.resolve(); },
				],
				[this.privateListener.stop.bind(this.privateListener)],
			], "Tier 2 conversation-computer startup cleanup failed");
		}
		const lifecycleWorker = lifecycle;
		const activationWorker = activations;
		const listener = this.privateListener;
		let stopped = false;
		function _StopLifecycle(): Promise<void> { return lifecycleWorker.stop(); }
		function _StopActivations(): Promise<void> { return activationWorker.stop(); }

		/** Stop every runtime worker once, in the reverse order of startup authority. */
		async function _Stop(): Promise<void>
		{
			if (stopped)
			{
				return;
			}
			stopped = true;
			await _RunDevelopmentCleanup([
				[_StopActivations, _StopLifecycle],
				[listener.stop.bind(listener)],
			], "Tier 2 conversation-computer runtime cleanup failed");
		}

		return { stop: _Stop };
	}
}
