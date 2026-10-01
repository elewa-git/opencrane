import type { DevelopmentConversationComputerSupervisor, DevelopmentWorkerHandle } from "./composition.types";
import { _RethrowAfterDevelopmentCleanup, _RunDevelopmentCleanup } from "./cleanup";

/** Starts retained-state convergence and activation before host processes may be claimed. */
export class DevelopmentConversationComputerRuntime implements DevelopmentConversationComputerSupervisor
{
	/** Compose replaceable start boundaries so ordering and failure cleanup remain directly testable. */
	public constructor(private readonly startLifecycle: () => Promise<DevelopmentWorkerHandle>, private readonly startActivations: () => Promise<DevelopmentWorkerHandle>, private readonly processes: { readonly stop: () => Promise<void> }) {}

	/** Reconcile retained leases before subscribing to activation. */
	public async start(): Promise<DevelopmentWorkerHandle>
	{
		let lifecycle: DevelopmentWorkerHandle | null = null;
		let activations: DevelopmentWorkerHandle | null = null;
		try
		{
			lifecycle = await this.startLifecycle();
			activations = await this.startActivations();
		}
		catch (error)
		{
			return _RethrowAfterDevelopmentCleanup(error, [
				[
					function _StopActivations(): Promise<void> { return activations?.stop() ?? Promise.resolve(); },
					function _StopLifecycle(): Promise<void> { return lifecycle?.stop() ?? Promise.resolve(); },
				],
				[this.processes.stop],
			], "Tier 2 conversation-computer startup cleanup failed");
		}
		const lifecycleWorker = lifecycle;
		const activationWorker = activations;
		const processes = this.processes;
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
				[processes.stop],
			], "Tier 2 conversation-computer runtime cleanup failed");
		}

		return { stop: _Stop };
	}
}
