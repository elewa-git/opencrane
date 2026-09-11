import type { DevelopmentConversationComputerSupervisor } from "./composition.types";
import type { HostDevelopmentConversationComputerSupervisor } from "./conversation-computer-host-supervisor";
import { _RethrowAfterDevelopmentCleanup, _RunDevelopmentCleanup } from "./cleanup";

/** Handle shared by the lifecycle scheduler, activation subscriber, and private listener. */
type _DevelopmentWorkerHandle = { readonly stop: () => Promise<void> };

/** Starts retained-state convergence, activation, and the private listener in authority order. */
export class DevelopmentConversationComputerRuntime implements DevelopmentConversationComputerSupervisor
{
	/** Compose replaceable start boundaries so ordering and failure cleanup remain directly testable. */
	public constructor(private readonly startLifecycle: () => Promise<_DevelopmentWorkerHandle>, private readonly startActivations: () => Promise<_DevelopmentWorkerHandle>, private readonly privateListener: Pick<HostDevelopmentConversationComputerSupervisor, "start" | "stop">) {}

	/** Reconcile retained leases before subscribing to activation and accepting private traffic. */
	public async start(): Promise<_DevelopmentWorkerHandle>
	{
		let lifecycle: _DevelopmentWorkerHandle | null = null;
		let activations: _DevelopmentWorkerHandle | null = null;
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
		return { stop: async function _Stop(): Promise<void>
		{
			if (stopped)
			{
				return;
			}
			stopped = true;
			await _RunDevelopmentCleanup([
				[activationWorker.stop, lifecycleWorker.stop],
				[listener.stop.bind(listener)],
			], "Tier 2 conversation-computer runtime cleanup failed");
		} };
	}
}
