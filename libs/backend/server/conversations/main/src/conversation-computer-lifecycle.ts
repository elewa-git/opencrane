import { ComputerLeaseStates, ConversationComputerStates } from "@opencrane/contracts";

import type { ConversationComputerAttemptActivity, ConversationComputerCheckpointStore, ConversationComputerClaimReleaser, ConversationComputerIdlePolicy, ConversationComputerLifecycleCommand, ConversationComputerLifecycleOutcome } from "./conversation-computer-lifecycle.types";
import { ConversationComputerHistory } from "./conversation-computers";

/** Reconstructs cooling from Kurrent timestamps and checkpoints before releasing Agent Sandbox. */
export class ConversationComputerLifecycleAuthority
{
	public constructor(private readonly computers: ConversationComputerHistory, private readonly checkpoints: ConversationComputerCheckpointStore, private readonly attempts: ConversationComputerAttemptActivity, private readonly claims: ConversationComputerClaimReleaser, private readonly namespace: string, private readonly policy: ConversationComputerIdlePolicy)
	{
		if (!Number.isSafeInteger(policy.staleAfterMilliseconds) || !Number.isSafeInteger(policy.retireAfterMilliseconds) || policy.staleAfterMilliseconds <= 0 || policy.retireAfterMilliseconds <= policy.staleAfterMilliseconds)
			throw new Error("Conversation computer idle policy requires increasing positive deadlines");
	}

	/** Applies the five-minute stale and twenty-minute checkpoint-and-release boundaries. */
	public async reconcile(command: ConversationComputerLifecycleCommand): Promise<ConversationComputerLifecycleOutcome>
	{
		if (Number.isNaN(command.now.getTime()))
			throw new Error("Conversation computer lifecycle requires a valid server time");
		const current = await this.computers.load(command);
		if (current === null || current.computer.state === ConversationComputerStates.Cold || current.computer.state === ConversationComputerStates.RecoveryRequired || current.computer.state === ConversationComputerStates.Retired)
			return "terminal";
		if (current.lease === null || current.lease.state !== ComputerLeaseStates.Active)
			return "current";
		const idleMilliseconds = command.now.getTime() - Date.parse(current.computer.updatedAt);
		if (idleMilliseconds < this.policy.staleAfterMilliseconds)
			return "current";
		if (current.computer.state === ConversationComputerStates.Warm)
		{
			await this.computers.append({ expectedRevision: current.revision, eventId: command.eventId, computer: { ...current.computer, state: ConversationComputerStates.Cooling }, lease: current.lease });
			return "cooling";
		}
		if (idleMilliseconds < this.policy.retireAfterMilliseconds)
			return "cooling";
		if (await this.attempts.hasActiveAttempt(current.computer.id, current.lease.id))
			return "active_attempt";
		const checkpoint = await this.checkpoints.capture(current.computer, current.lease);
		await this.claims.release({ namespace: this.namespace, claimId: current.lease.sandboxClaimId, computerId: current.computer.id, leaseId: current.lease.id, generation: current.lease.generation });
		const releasedAt = command.now.toISOString();
		await this.computers.append({ expectedRevision: current.revision, eventId: command.eventId, computer: { ...current.computer, state: ConversationComputerStates.Cold, workspaceCheckpoint: checkpoint, updatedAt: releasedAt }, lease: { ...current.lease, state: ComputerLeaseStates.Released, releasedAt } });
		return "retired_to_checkpoint";
	}
}
