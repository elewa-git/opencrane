import { ComputerLeaseStates, ConversationComputerStates, type ComputerLease, type ConversationComputer } from "@opencrane/contracts";

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
		if (current.lease !== null && current.computer.state === ConversationComputerStates.Cooling && current.lease.state === ComputerLeaseStates.Released)
		{
			if (!await this.attempts.clearActiveLease(_LeaseProjectionCommand(current.computer, current.lease)))
				throw new Error("Conversation computer active lease projection changed before release completion");
			await this.claims.release({ namespace: this.namespace, claimId: current.lease.sandboxClaimId, computerId: current.computer.id, leaseId: current.lease.id, generation: current.lease.generation });
			await this.computers.append({ expectedRevision: current.revision, eventId: _CompletionEventId(command.eventId), computer: { ...current.computer, state: ConversationComputerStates.Cold, updatedAt: command.now.toISOString() }, lease: current.lease });
			return "retired_to_checkpoint";
		}
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
		const checkpoint = await this.checkpoints.capture(current.computer, current.lease);
		const releasedAt = command.now.toISOString();
		if (!await this.attempts.clearActiveLease(_LeaseProjectionCommand(current.computer, current.lease)))
			return "active_attempt";
		await this.computers.append({ expectedRevision: current.revision, eventId: command.eventId, computer: { ...current.computer, workspaceCheckpoint: checkpoint }, lease: { ...current.lease, state: ComputerLeaseStates.Released, releasedAt } });
		const released = await this.computers.load(command);
		if (released === null || released.lease?.state !== ComputerLeaseStates.Released)
			throw new Error("Conversation computer checkpoint release history is unavailable");
		await this.claims.release({ namespace: this.namespace, claimId: released.lease.sandboxClaimId, computerId: released.computer.id, leaseId: released.lease.id, generation: released.lease.generation });
		await this.computers.append({ expectedRevision: released.revision, eventId: _CompletionEventId(command.eventId), computer: { ...released.computer, state: ConversationComputerStates.Cold, updatedAt: releasedAt }, lease: released.lease });
		return "retired_to_checkpoint";
	}
}

/** Bind a projection clear to every canonical computer and lease coordinate. */
function _LeaseProjectionCommand(computer: ConversationComputer, lease: ComputerLease): Parameters<ConversationComputerAttemptActivity["clearActiveLease"]>[0]
{
	return { siloId: computer.siloId, conversationId: computer.conversationId, computerId: computer.id, agentIdentityId: computer.agentIdentityId, leaseId: lease.id, leaseGeneration: lease.generation };
}

/** Derive a distinct deterministic completion event after the release intent is durable. */
function _CompletionEventId(eventId: string): string
{
	const chars = eventId.replaceAll("-", "").split("");
	chars[31] = chars[31] === "0" ? "1" : "0";
	const hex = chars.join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
