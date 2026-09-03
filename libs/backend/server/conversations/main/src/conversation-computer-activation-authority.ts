import { randomUUID } from "node:crypto";

import { __AgentSandboxClaimName, AgentSandboxClaimReason } from "@opencrane/backend/server/infra/agent-sandbox-claims";
import { ComputerLeaseStates, ConversationComputerStates } from "@opencrane/contracts";

import type { ConversationComputerActivationAuthority, ConversationComputerActivationCommand, ConversationComputerActivationOutcome } from "./conversation-computer-activation.types";
import type { ConversationComputerActivationAuthorityDependencies } from "./conversation-computer-activation-authority.types";
import type { CurrentConversationComputer } from "./conversation-computers";

/**
 * Turns a checked ConversationComputer activation event into one deterministic Agent Sandbox claim.
 *
 * The computer history remains the lifecycle authority. This class first admits the history-bound
 * profile, then records `ClaimDispatched` before it asks Kubernetes to create the idempotent claim.
 * That state prevents a terminal transition from winning while external I/O is in progress. A stale,
 * terminal, missing, foreign, or expired generation is acknowledged as denied instead of allowing an
 * old queue delivery to create another computer lease.
 *
 * Called by: `__RunConversationComputerActivationListener`.
 * @see ConversationComputerStates for the persisted dispatch fence and its allowed transitions.
 */
export class ConversationComputerActivationClaimAuthority implements ConversationComputerActivationAuthority
{
	/** Connects checked history, release profile resolution, claim creation, and the server clock. */
	public constructor(private readonly dependencies: ConversationComputerActivationAuthorityDependencies) {}

	/**
	 * Requests the exact Agent Sandbox claim for the current pending computer generation.
	 *
	 * @param command - Supplies the stream-validated activation coordinates and expected generation.
	 * @returns `activated` after submitting the claim, `idempotent` for an already warm generation,
	 * `denied` for stale history, or `park` when release admission or claim evidence is inconsistent.
	 * @throws {Error} Propagates unavailable history or Kubernetes I/O so the durable subscription retries.
	 * @see ConversationComputerActivationProfileResolver for the release admission that happens before dispatch.
	 */
	public async activate(command: ConversationComputerActivationCommand): Promise<ConversationComputerActivationOutcome>
	{
		// 1. Admit a pending profile before writing a durable dispatch state that must remain realizable.
		const preliminary = await this._LoadCurrentComputer(command);
		if (_IsCurrentPendingGeneration(preliminary, command, this.dependencies.clock.now()))
		{
			const admittedProfile = await this.dependencies.profiles.resolve({ siloId: command.siloId, profileRevisionId: preliminary.computer.profileRevisionId });
			if (admittedProfile === null)
				return { action: "park", reason: "computer profile is not admitted by this release" };
		}

		// 2. Persist the dispatch fence before external I/O so a terminal transition cannot race a created claim.
		const current = await this._LoadDispatchedComputer(command);
		if (current === null)
			return "denied";
		if (current.computer.leaseGeneration !== command.generation)
			return "denied";

		// 3. A current warm generation has already crossed this activation boundary.
		if (current.computer.state === ConversationComputerStates.Warm && current.lease?.state === ComputerLeaseStates.Active && current.lease.generation === command.generation)
			return "idempotent";

		// 4. Admit claims only from the durable dispatch state before calling Kubernetes.
		if (current.computer.state !== ConversationComputerStates.ClaimDispatched || current.lease === null || current.lease.state !== ComputerLeaseStates.Claimed || current.lease.generation !== command.generation || Date.parse(current.lease.expiresAt) <= this.dependencies.clock.now().getTime())
			return "denied";
		const profile = await this.dependencies.profiles.resolve({ siloId: command.siloId, profileRevisionId: current.computer.profileRevisionId });
		if (profile === null)
			return { action: "park", reason: "computer profile is not admitted by this release" };

		// 5. Check the history claim before I/O, so a malformed snapshot cannot create a second lease.
		const expectedClaimName = __AgentSandboxClaimName(command.computerId, command.generation);
		if (expectedClaimName !== current.lease.sandboxClaimId)
			return { action: "park", reason: "sandbox claim does not match the recorded computer lease" };

		// 6. Create the deterministic claim after all history evidence has matched its lease coordinates.
		const receipt = await this.dependencies.claims.ensure({
			namespace: profile.namespace,
			siloId: command.siloId,
			computerId: command.computerId,
			generation: command.generation,
			profile: profile.sandboxProfile,
			warmPoolName: profile.warmPoolName,
			podLabels: profile.podLabels,
			reason: AgentSandboxClaimReason.ActivationRequested,
			shutdownTime: new Date(current.lease.expiresAt),
		});
		if (receipt.namespace !== profile.namespace || receipt.claimName !== expectedClaimName)
			return { action: "park", reason: "sandbox claim does not match the recorded computer lease" };
		return "activated";
	}

	/** Moves a current pending generation to `ClaimDispatched` before its claim can reach Kubernetes. */
	private async _LoadDispatchedComputer(command: ConversationComputerActivationCommand): Promise<CurrentConversationComputer | null>
	{
		const current = await this._LoadCurrentComputer(command);
		if (!_IsCurrentPendingGeneration(current, command, this.dependencies.clock.now()))
			return current;
		const dispatchedAt = this.dependencies.clock.now();
		await this.dependencies.history.append({
			expectedRevision: current.revision,
			eventId: randomUUID(),
			computer: { ...current.computer, state: ConversationComputerStates.ClaimDispatched, updatedAt: dispatchedAt.toISOString() },
			lease: current.lease,
		});
		return this._LoadCurrentComputer(command);
	}

	/** Loads the current checked computer before profile admission or dispatch persistence. */
	private async _LoadCurrentComputer(command: ConversationComputerActivationCommand): Promise<CurrentConversationComputer | null>
	{
		return this.dependencies.history.loadForActivation({
			siloId: command.siloId,
			computerId: command.computerId,
			conversationId: command.conversationId,
		});
	}
}

/** Returns whether one checked pending snapshot can atomically fence this exact activation generation. */
function _IsCurrentPendingGeneration(current: CurrentConversationComputer | null, command: ConversationComputerActivationCommand, now: Date): current is CurrentConversationComputer & { readonly lease: NonNullable<CurrentConversationComputer["lease"]> }
{
	return current !== null
		&& current.computer.leaseGeneration === command.generation
		&& current.computer.state === ConversationComputerStates.ClaimPending
		&& current.lease !== null
		&& current.lease.state === ComputerLeaseStates.Claimed
		&& current.lease.generation === command.generation
		&& Date.parse(current.lease.expiresAt) > now.getTime();
}
