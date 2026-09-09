import { ComputerLeaseStates, ConversationComputerStates } from "@opencrane/contracts";
import type { AgentSandboxPodBinding } from "@opencrane/backend/server/infra/agent-sandbox";

import { ConversationComputerHistory } from "@opencrane/backend/server/conversations/computers";
import type { ConversationComputerBootstrapCommand, ConversationComputerPendingTurnCompiler, ConversationComputerTurnCandidate, ConversationComputerTurnCandidateResolver, ConversationComputerTurnProjectionRepository, FrozenConversationComputerTurn } from "./conversation-computer-turn.types";

/** Resolves a pending turn only after exact silo, lease, generation, claim and Pod checks. */
export class ActiveConversationComputerTurnCandidateResolver implements ConversationComputerTurnCandidateResolver
{
	public constructor(private readonly siloId: string, private readonly projections: ConversationComputerTurnProjectionRepository, private readonly computers: ConversationComputerHistory, private readonly pods: AgentSandboxPodBinding, private readonly compiler: ConversationComputerPendingTurnCompiler) {}

	/** Check the lease and Pod binding with the same rules as resolve while admitting no run. */
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

	/** Load the projection and current history, then require the exact active lease and its bound Pod. */
	private async _Admit(command: ConversationComputerBootstrapCommand)
	{
		const projection = await this.projections.resolve(this.siloId, command.computerId);
		if (projection === null)
			throw new Error("Conversation computer bootstrap cannot resolve a computer in the reviewed silo");
		const current = await this.computers.load({ computer: { siloId: this.siloId, computerId: command.computerId, conversationId: projection.conversationId, agentIdentityId: projection.agentIdentityId }, profileRevisionId: projection.profileRevisionId });
		if (current === null || current.computer.state !== ConversationComputerStates.Warm || current.lease?.state !== ComputerLeaseStates.Active || current.lease.id !== command.lease.leaseId || current.lease.generation !== command.lease.leaseGeneration || current.computer.leaseGeneration !== command.lease.leaseGeneration || current.lease.sandboxId === null || Date.parse(current.lease.expiresAt) <= Date.now())
			throw new Error("Conversation computer bootstrap requires the current active lease generation");
		const lease = { leaseId: command.lease.leaseId, leaseGeneration: command.lease.leaseGeneration, sandboxClaimId: `${command.computerId}-g${command.lease.leaseGeneration}` };
		if (!await this.pods.verify({ computerId: command.computerId, lease, workload: command.workload }))
			throw new Error("Conversation computer bootstrap workload is not the lease-bound Sandbox Pod");
		return { projection, current: { ...current, lease: current.lease }, lease };
	}

	/** Recheck lease, generation, Pod binding and the exact conversation revision before output. */
	public async assertCurrent(turn: FrozenConversationComputerTurn, workload: ConversationComputerBootstrapCommand["workload"]): Promise<ConversationComputerTurnCandidate>
	{
		if (turn.siloId !== this.siloId)
			throw new Error("Conversation computer output crossed its admitted silo");
		const candidate = await this.resolve({ computerId: turn.computerId, lease: turn.lease, workload });
		if (candidate === null || candidate.binding.expectedRevision !== turn.binding.expectedRevision || candidate.latestPendingEntryId !== turn.latestPendingEntryId || candidate.compiledInput.digest !== turn.compile.digest || candidate.modelAlias !== turn.modelAlias)
			throw new Error("Conversation computer output requires rebootstrap after conversation history changed");
		return candidate;
	}
}
