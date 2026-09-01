import { randomUUID } from "node:crypto";

import { __AgentSandboxClaimName, AgentSandboxClaimObservationStates, AgentSandboxClaimReason } from "@opencrane/backend/server/infra/agent-sandbox-claims";
import { ComputerLeaseStates, ConversationComputerStates } from "@opencrane/contracts";

import type { ConversationComputerActivationCommand } from "./conversation-computer-activation.types";
import { ConversationComputerSandboxReconciliationOutcomes, type ConversationComputerSandboxReconciliationAuthorityDependencies, type ConversationComputerSandboxReconciliationOutcome } from "./conversation-computer-sandbox-reconciliation-authority.types";
import type { CurrentConversationComputer } from "./conversation-computers";

/**
 * Reconciles an exact durable claim dispatch with the Agent Sandbox status it produced.
 *
 * The authority does not drive Pods or write Sandbox status. It reloads history for every pass,
 * trusts only a matching immutable claim, and uses an expected revision to turn one ready claim
 * into the sole active lease or to compensate its expired fence. Its result is transient worker
 * control flow; the appended computer and lease snapshots remain the persisted authority.
 *
 * Called by: `_StartConversationComputerSandboxReconciliationWorker`.
 * @see ConversationComputerSandboxReconciliationOutcomes for the worker actions each result requires.
 */
export class ConversationComputerSandboxReconciliationAuthority
{
	/** Connects checked history, release profile resolution, claim observation, and server time. */
	public constructor(private readonly dependencies: ConversationComputerSandboxReconciliationAuthorityDependencies) {}

	/**
	 * Reconciles one activation-stream locator without accepting identity or profile from that event.
	 *
	 * @param command - Supplies the durable locator, whose history recheck supplies all other authority.
	 * @returns A transient worker result: retain pending, stop after a history append, or drop stale or blocked work.
	 * @throws {Error} Propagates unavailable history or claim-status I/O so the worker can retry later.
	 */
	public async reconcile(command: ConversationComputerActivationCommand): Promise<ConversationComputerSandboxReconciliationOutcome>
	{
		const current = await this._LoadCurrentComputer(command);
		if (_IsCurrentPendingGeneration(current, command))
			return this._ReconcilePendingDispatch(current, command);
		if (!_IsCurrentDispatchedGeneration(current, command))
			return ConversationComputerSandboxReconciliationOutcomes.Ignored;
		const profile = await this.dependencies.profiles.resolve({ siloId: command.siloId, profileRevisionId: current.computer.profileRevisionId });
		if (profile === null)
			return ConversationComputerSandboxReconciliationOutcomes.Blocked;
		const claimName = __AgentSandboxClaimName(command.computerId, command.generation);
		if (current.lease.sandboxClaimId !== claimName)
			return ConversationComputerSandboxReconciliationOutcomes.Blocked;
		const now = this.dependencies.clock.now();
		if (Date.parse(current.lease.expiresAt) <= now.getTime())
			return this._CompensateExpiredDispatch(current, now);
		const observation = await this.dependencies.observations.observe({
			namespace: profile.namespace,
			siloId: command.siloId,
			computerId: command.computerId,
			generation: command.generation,
			profile: profile.sandboxProfile,
			warmPoolName: profile.warmPoolName,
			reason: AgentSandboxClaimReason.ActivationRequested,
			shutdownTime: new Date(current.lease.expiresAt),
		});
		if (observation.state !== AgentSandboxClaimObservationStates.Ready)
			return ConversationComputerSandboxReconciliationOutcomes.Pending;
		const warmedAt = this.dependencies.clock.now();
		if (Date.parse(current.lease.expiresAt) <= warmedAt.getTime())
			return this._CompensateExpiredDispatch(current, warmedAt);
		await this.dependencies.history.append({
			expectedRevision: current.revision,
			eventId: randomUUID(),
			computer: { ...current.computer, state: ConversationComputerStates.Warm, updatedAt: warmedAt.toISOString() },
			lease: { ...current.lease, state: ComputerLeaseStates.Active, sandboxId: observation.sandboxId },
		});
		return ConversationComputerSandboxReconciliationOutcomes.Warmed;
	}

	/** Loads the latest history-only snapshot for this stream locator before every status decision. */
	private async _LoadCurrentComputer(command: ConversationComputerActivationCommand): Promise<CurrentConversationComputer | null>
	{
		return this.dependencies.history.loadForActivation({ siloId: command.siloId, computerId: command.computerId, conversationId: command.conversationId });
	}

	/** Keeps only an admitted, unexpired activation race eligible to become a dispatch fence. */
	private async _ReconcilePendingDispatch(current: CurrentConversationComputer & { readonly lease: NonNullable<CurrentConversationComputer["lease"]> }, command: ConversationComputerActivationCommand): Promise<ConversationComputerSandboxReconciliationOutcome>
	{
		if (Date.parse(current.lease.expiresAt) <= this.dependencies.clock.now().getTime())
			return ConversationComputerSandboxReconciliationOutcomes.Ignored;
		const profile = await this.dependencies.profiles.resolve({ siloId: command.siloId, profileRevisionId: current.computer.profileRevisionId });
		return profile === null ? ConversationComputerSandboxReconciliationOutcomes.Blocked : ConversationComputerSandboxReconciliationOutcomes.Pending;
	}

	/** Records one terminal lost lease when status cannot make this dispatched generation warm before expiry. */
	private async _CompensateExpiredDispatch(current: CurrentConversationComputer & { readonly lease: NonNullable<CurrentConversationComputer["lease"]> }, now: Date): Promise<ConversationComputerSandboxReconciliationOutcome>
	{
		await this.dependencies.history.append({
			expectedRevision: current.revision,
			eventId: randomUUID(),
			computer: { ...current.computer, state: ConversationComputerStates.RecoveryRequired, updatedAt: now.toISOString() },
			lease: { ...current.lease, state: ComputerLeaseStates.Lost, releasedAt: now.toISOString() },
		});
		return ConversationComputerSandboxReconciliationOutcomes.Compensated;
	}
}

/** Narrows one current `ClaimDispatched` lease to the exact generation that may reconcile. */
function _IsCurrentDispatchedGeneration(current: CurrentConversationComputer | null, command: ConversationComputerActivationCommand): current is CurrentConversationComputer & { readonly lease: NonNullable<CurrentConversationComputer["lease"]> }
{
	return current !== null
		&& current.computer.state === ConversationComputerStates.ClaimDispatched
		&& current.computer.leaseGeneration === command.generation
		&& current.lease !== null
		&& current.lease.state === ComputerLeaseStates.Claimed
		&& current.lease.generation === command.generation;
}

/** Keeps the replay locator while the activation consumer has not yet persisted its dispatch fence. */
function _IsCurrentPendingGeneration(current: CurrentConversationComputer | null, command: ConversationComputerActivationCommand): current is CurrentConversationComputer & { readonly lease: NonNullable<CurrentConversationComputer["lease"]> }
{
	return current !== null
		&& current.computer.state === ConversationComputerStates.ClaimPending
		&& current.computer.leaseGeneration === command.generation
		&& current.lease !== null
		&& current.lease.state === ComputerLeaseStates.Claimed
		&& current.lease.generation === command.generation;
}
