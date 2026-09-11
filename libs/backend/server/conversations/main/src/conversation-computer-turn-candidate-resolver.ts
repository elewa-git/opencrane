import { ComputerLeaseStates, ConversationComputerStates } from "@opencrane/contracts";

import { ConversationComputerHistory } from "./conversation-computers";
import type { ConversationComputerBootstrapCommand, ConversationComputerPendingTurnCompiler, ConversationComputerTurnCandidate, ConversationComputerTurnCandidateResolver, ConversationComputerTurnProjectionRepository, FrozenConversationComputerTurn } from "./conversation-computer-turn.types";
import type { ConversationComputerRealizer } from "./conversation-computer-realization.types";

/** Resolves a pending turn after checking its silo, lease, generation and realized process. */
export class ActiveConversationComputerTurnCandidateResolver implements ConversationComputerTurnCandidateResolver
{
	public constructor(private readonly siloId: string, private readonly projections: ConversationComputerTurnProjectionRepository, private readonly computers: ConversationComputerHistory, private readonly realizer: Pick<ConversationComputerRealizer, "bind">, private readonly compiler: ConversationComputerPendingTurnCompiler) {}

	/** Check the lease and process binding with the same rules as resolve while admitting no run. */
	public async admit(command: ConversationComputerBootstrapCommand): Promise<void>
	{
		await this._Admit(command);
	}

	/** Resolve one currently active generation and compile its pending input. */
	public async resolve(command: ConversationComputerBootstrapCommand): Promise<ConversationComputerTurnCandidate | null>
	{
		const { projection, current, lease } = await this._Admit(command);
		const candidate = await this.compiler.compile({ computer: { siloId: this.siloId, computerId: command.computerId, conversationId: projection.conversationId, agentIdentityId: projection.agentIdentityId }, profileRevisionId: projection.profileRevisionId, lease });
		if (candidate === null)
			return null;
		const expiresAt = Math.min(Date.parse(current.lease.expiresAt), Date.parse(candidate.credentialExpiresAt));
		const remainingLeaseSeconds = Math.floor((expiresAt - Date.now()) / 1_000);
		if (!Number.isFinite(expiresAt) || remainingLeaseSeconds < 1)
			throw new Error("Conversation computer bootstrap requires enough remaining lease time");
		return { ...candidate, credentialLifetimeSeconds: Math.min(candidate.credentialLifetimeSeconds, remainingLeaseSeconds), credentialExpiresAt: new Date(expiresAt).toISOString() };
	}

	/** Load the projection and current history, then require the active lease and its bound process. */
	private async _Admit(command: ConversationComputerBootstrapCommand)
	{
		const projection = await this.projections.resolve(this.siloId, command.computerId);
		if (projection === null)
			throw new Error("Conversation computer bootstrap cannot resolve a computer in the reviewed silo");
		const current = await this.computers.load({ computer: { siloId: this.siloId, computerId: command.computerId, conversationId: projection.conversationId, agentIdentityId: projection.agentIdentityId }, profileRevisionId: projection.profileRevisionId });
		if (current === null || current.computer.state !== ConversationComputerStates.Warm || current.lease?.state !== ComputerLeaseStates.Active || current.lease.id !== command.lease.leaseId || current.lease.generation !== command.lease.leaseGeneration || current.computer.leaseGeneration !== command.lease.leaseGeneration || Date.parse(current.lease.expiresAt) <= Date.now())
			throw new Error("Conversation computer bootstrap requires the current active lease generation");
		const lease = { leaseId: command.lease.leaseId, leaseGeneration: command.lease.leaseGeneration, realization: current.lease.realization };
		if (!await this.realizer.bind({ computerId: command.computerId, lease, process: command.process }))
			throw new Error("Conversation computer bootstrap process is not bound to the active realization");
		return { projection, current: { ...current, lease: current.lease }, lease };
	}

	/** Recheck the lease, generation, process binding and conversation revision before output. */
	public async assertCurrent(turn: FrozenConversationComputerTurn, process: ConversationComputerBootstrapCommand["process"]): Promise<ConversationComputerTurnCandidate>
	{
		if (turn.siloId !== this.siloId)
			throw new Error("Conversation computer output crossed its admitted silo");
		const candidate = await this.resolve({ computerId: turn.computerId, lease: turn.lease, process });
		if (candidate === null || candidate.binding.expectedRevision !== turn.binding.expectedRevision || candidate.latestPendingEntryId !== turn.latestPendingEntryId || candidate.compiledInput.digest !== turn.compile.digest || candidate.modelAlias !== turn.modelAlias)
			throw new Error("Conversation computer output requires rebootstrap after conversation history changed");
		return candidate;
	}
}
