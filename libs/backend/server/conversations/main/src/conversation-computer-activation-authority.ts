import { __AgentSandboxClaimName, AgentSandboxClaimReason } from "@opencrane/backend/server/infra/agent-sandbox-claims";
import { ComputerLeaseStates, ConversationComputerStates } from "@opencrane/contracts";

import type { ConversationComputerActivationCommand, ConversationComputerActivationOutcome } from "./conversation-computer-activation.types";
import type { ConversationComputerActivationAuthorityDependencies, ConversationComputerActivationAuthorityPort } from "./conversation-computer-activation-authority.types";

/**
 * Turns a checked ConversationComputer activation event into one deterministic Agent Sandbox claim.
 *
 * The computer history remains the lifecycle authority. This class reads that history before every
 * claim, derives the profile from it, and treats Kubernetes as an idempotent realization request.
 * A stale, terminal, missing, foreign, or expired generation is acknowledged as denied instead of
 * allowing an old queue delivery to create another computer lease.
 */
export class ConversationComputerActivationClaimAuthority implements ConversationComputerActivationAuthorityPort
{
	/** Connects checked history, release profile resolution, claim creation, and the server clock. */
	public constructor(private readonly dependencies: ConversationComputerActivationAuthorityDependencies) {}

	/**
	 * Requests the exact Agent Sandbox claim for the current pending computer generation.
	 *
	 * @param command - Supplies the stream-validated activation coordinates and expected generation.
	 * @returns An acknowledgement, parked configuration denial, or idempotent outcome for the listener.
	 * @throws {Error} Propagates unavailable history or Kubernetes I/O so the durable subscription retries.
	 */
	public async activate(command: ConversationComputerActivationCommand): Promise<ConversationComputerActivationOutcome>
	{
		// 1. Reload the computer because queue coordinates do not authorize a profile or identity.
		const current = await this.dependencies.history.loadForActivation({
			siloId: command.siloId,
			computerId: command.computerId,
			conversationId: command.conversationId,
		});
		if (current === null)
			return "denied";
		if (current.computer.leaseGeneration !== command.generation)
			return "denied";

		// 2. A current warm generation has already crossed this activation boundary.
		if (current.computer.state === ConversationComputerStates.Warm && current.lease?.state === ComputerLeaseStates.Active && current.lease.generation === command.generation)
			return "idempotent";

		// 3. Admit claims only from the matching pending history state before calling Kubernetes.
		if (current.computer.state !== ConversationComputerStates.ClaimPending || current.lease === null || current.lease.state !== ComputerLeaseStates.Claimed || current.lease.generation !== command.generation || Date.parse(current.lease.expiresAt) <= this.dependencies.clock.now().getTime())
			return "denied";
		const profile = await this.dependencies.profiles.resolve({ siloId: command.siloId, profileRevisionId: current.computer.profileRevisionId });
		if (profile === null)
			return { action: "park", reason: "computer profile is not admitted by this release" };

		// 4. Check the history claim before I/O, so a malformed snapshot cannot create a second lease.
		const expectedClaimName = __AgentSandboxClaimName(command.computerId, command.generation);
		if (expectedClaimName !== current.lease.sandboxClaimId)
			return { action: "park", reason: "sandbox claim does not match the recorded computer lease" };

		// 5. Create the deterministic claim after all history evidence has matched its lease coordinates.
		const receipt = await this.dependencies.claims.ensure({
			namespace: profile.namespace,
			siloId: command.siloId,
			computerId: command.computerId,
			generation: command.generation,
			profile: profile.sandboxProfile,
			warmPoolName: profile.warmPoolName,
			reason: AgentSandboxClaimReason.ActivationRequested,
			shutdownTime: new Date(current.lease.expiresAt),
		});
		if (receipt.namespace !== profile.namespace || receipt.claimName !== expectedClaimName)
			return { action: "park", reason: "sandbox claim does not match the recorded computer lease" };
		return "activated";
	}
}
