import { __AgentSandboxClaimName } from "@opencrane/backend/server/infra/agent-sandbox-claims";
import { ComputerLeaseStates, ConversationComputerStates } from "@opencrane/contracts";
import { ConversationModes } from "@opencrane/models/conversations";

import type { ConversationComputerCreationActivationAuthority as ConversationComputerCreationActivationAuthorityPort, ConversationComputerCreationActivationAuthorityDependencies } from "./conversation-computer-creation-activation-authority.types";
import type { ReservedConversationCreation } from "./conversation-creation-reservation.types";

/**
 * Establishes the frozen initial ConversationComputer generation after its conversation anchor exists.
 *
 * The authority appends the cold computer, first claimed lease, and silo activation event as one
 * history operation. It therefore owns lifecycle admission while the later activation worker owns
 * the Agent Sandbox claim; neither a browser nor the Sandbox can select replacement coordinates.
 * @implements ConversationComputerCreationActivationAuthority
 */
export class ConversationComputerCreationActivationAuthority implements ConversationComputerCreationActivationAuthorityPort
{
	/** Connects the creation boundary to the computer history authority. */
	public constructor(private readonly dependencies: ConversationComputerCreationActivationAuthorityDependencies) {}

	/**
	 * Writes or proves the reservation's exact initial claimed computer generation.
	 *
	 * The conversation anchor is already durable when this runs. Its reservation supplies every
	 * mutable-looking coordinate, allowing an idempotent recovery without selecting a new identity,
	 * profile, computer, event, or lease deadline.
	 *
	 * Called by: {@link HistoryAnchoredConversationCreationService} through its creation dependency.
	 * @param reservation - Supplies an admitted history-anchored or projected creation reservation.
	 * @returns Resolves when the first computer generation is stored, recovered, or unnecessary.
	 * @throws {Error} Rejects an incomplete Agent reservation or a conflicting computer history.
	 */
	public async ensure(reservation: ReservedConversationCreation): Promise<void>
	{
		if (reservation.mode !== ConversationModes.AgentSession)
		{
			if (reservation.agent !== null || reservation.agentBinding !== null)
				throw new Error("Non-agent conversation creation cannot activate a computer");
			return;
		}
		if (reservation.agent === null || reservation.agentBinding === null)
			throw new Error("Agent conversation creation requires frozen computer coordinates");
		const computer = {
			schemaVersion: 1 as const,
			id: reservation.agent.computerId,
			siloId: reservation.siloId,
			conversationId: reservation.conversationId,
			agentIdentityId: reservation.agentBinding.agentIdentityId,
			profileRevisionId: reservation.agentBinding.profileRevisionId,
			state: ConversationComputerStates.Cold,
			leaseGeneration: 0,
			workspaceCheckpoint: null,
			activeExecution: null,
			createdAt: reservation.createdAt,
			updatedAt: reservation.createdAt,
		};
		const leaseTimes = _InitialLeaseTimes(reservation.agent, this.dependencies.clock.now());
		const lease = {
			schemaVersion: 1 as const,
			id: `lease-${reservation.agent.computerId}-g1`,
			computerId: reservation.agent.computerId,
			generation: 1,
			sandboxClaimId: __AgentSandboxClaimName(reservation.agent.computerId, 1),
			sandboxId: null,
			runtimePod: null,
			state: ComputerLeaseStates.Claimed,
			claimedAt: leaseTimes.claimedAt,
			expiresAt: leaseTimes.expiresAt,
			releasedAt: null,
		};
		const command = { provisionEventId: reservation.agent.computerHistoryEventId, claimEventId: reservation.agent.computerClaimEventId, activationEventId: reservation.agent.computerActivationEventId, computer, lease };
		try
		{
			await this.dependencies.history.provisionAndRequestActivation(command);
		}
		catch (error)
		{
			const current = await this.dependencies.history.load({ siloId: reservation.siloId, computerId: computer.id, conversationId: computer.conversationId, agentIdentityId: computer.agentIdentityId, profileRevisionId: computer.profileRevisionId });
			if (_MatchesInitialGeneration(current, computer, lease))
				return;
			throw error;
		}
	}
}

/** Replaces an expired reserved lease window before the first history append can request an already-expired claim. */
function _InitialLeaseTimes(agent: { readonly computerLeaseClaimedAt: string; readonly computerLeaseExpiresAt: string }, now: Date): { readonly claimedAt: string; readonly expiresAt: string }
{
	const reservedClaimedAt = Date.parse(agent.computerLeaseClaimedAt);
	const reservedExpiresAt = Date.parse(agent.computerLeaseExpiresAt);
	if (!Number.isFinite(reservedClaimedAt) || !Number.isFinite(reservedExpiresAt) || reservedExpiresAt <= reservedClaimedAt)
		throw new Error("Agent conversation creation requires a valid initial lease window");
	if (reservedExpiresAt > now.getTime())
		return { claimedAt: agent.computerLeaseClaimedAt, expiresAt: agent.computerLeaseExpiresAt };
	const durationMilliseconds = reservedExpiresAt - reservedClaimedAt;
	return { claimedAt: now.toISOString(), expiresAt: new Date(now.getTime() + durationMilliseconds).toISOString() };
}

/** Proves the stored initial generation even when the activation worker has already advanced its state. */
function _MatchesInitialGeneration(current: Awaited<ReturnType<ConversationComputerCreationActivationAuthorityDependencies["history"]["load"]>>, computer: { readonly id: string; readonly createdAt: string; readonly conversationId: string; readonly siloId: string; readonly agentIdentityId: string; readonly profileRevisionId: string }, lease: { readonly id: string; readonly sandboxClaimId: string }): boolean
{
	return current !== null
		&& current.revision >= 1n
		&& current.computer.id === computer.id
		&& current.computer.siloId === computer.siloId
		&& current.computer.conversationId === computer.conversationId
		&& current.computer.agentIdentityId === computer.agentIdentityId
		&& current.computer.profileRevisionId === computer.profileRevisionId
		&& current.computer.leaseGeneration >= 1
		&& current.computer.createdAt === computer.createdAt
		&& current.lease !== null
		&& current.lease.id === lease.id
		&& current.lease.generation === 1
		&& current.lease.sandboxClaimId === lease.sandboxClaimId;
}
