import { ComputerLeaseStates, ConversationComputerStates } from "@opencrane/contracts";

import { ConversationComputerHistory } from "./conversation-computers";
import type { ConversationComputerBootstrapCommand, ConversationComputerPendingTurnCompiler, ConversationComputerPodBindingVerifier, ConversationComputerTurnCandidate, ConversationComputerTurnCandidateResolver, ConversationComputerTurnProjectionRepository, FrozenConversationComputerTurn } from "./conversation-computer-turn.types";

/** Resolves a pending turn only after exact silo, lease, generation, claim and Pod checks. */
export class ActiveConversationComputerTurnCandidateResolver implements ConversationComputerTurnCandidateResolver
{
	public constructor(private readonly siloId: string, private readonly projections: ConversationComputerTurnProjectionRepository, private readonly computers: ConversationComputerHistory, private readonly pods: ConversationComputerPodBindingVerifier, private readonly compiler: ConversationComputerPendingTurnCompiler) {}

	/** Resolve one currently active generation and compile its pending input. */
	public async resolve(command: ConversationComputerBootstrapCommand): Promise<ConversationComputerTurnCandidate | null>
	{
		const projection = await this.projections.resolve(this.siloId, command.computerId);
		if (projection === null)
			throw new Error("Conversation computer bootstrap cannot resolve a computer in the reviewed silo");
		const current = await this.computers.load({ siloId: this.siloId, computerId: command.computerId, ...projection });
		if (current === null || current.computer.state !== ConversationComputerStates.Warm || current.lease?.state !== ComputerLeaseStates.Active || current.lease.id !== command.leaseId || current.lease.generation !== command.generation || current.computer.leaseGeneration !== command.generation || current.lease.sandboxId === null || Date.parse(current.lease.expiresAt) <= Date.now())
			throw new Error("Conversation computer bootstrap requires the current active lease generation");
		const sandboxClaimId = `${command.computerId}-g${command.generation}`;
		if (!await this.pods.verify({ computerId: command.computerId, generation: command.generation, leaseId: command.leaseId, sandboxClaimId, workload: command.workload }))
			throw new Error("Conversation computer bootstrap workload is not the lease-bound Sandbox Pod");
		const candidate = await this.compiler.compile({ siloId: this.siloId, computerId: command.computerId, generation: command.generation, leaseId: command.leaseId, sandboxClaimId, ...projection });
		if (candidate === null)
			return null;
		const remainingLeaseSeconds = Math.floor((Date.parse(current.lease.expiresAt) - Date.now()) / 1_000);
		if (remainingLeaseSeconds < 1)
			throw new Error("Conversation computer bootstrap requires enough remaining lease time");
		return { ...candidate, credentialLifetimeSeconds: Math.min(candidate.credentialLifetimeSeconds, remainingLeaseSeconds) };
	}

	/** Recheck lease, generation, Pod binding and the exact conversation revision before output. */
	public async assertCurrent(turn: FrozenConversationComputerTurn, workload: ConversationComputerBootstrapCommand["workload"]): Promise<void>
	{
		if (turn.siloId !== this.siloId)
			throw new Error("Conversation computer output crossed its admitted silo");
		const candidate = await this.resolve({ computerId: turn.computerId, generation: turn.generation, leaseId: turn.leaseId, workload });
		if (candidate === null || candidate.binding.expectedRevision !== turn.binding.expectedRevision || candidate.latestPendingEntryId !== turn.latestPendingEntryId || candidate.compiledInput.digest !== turn.compile.digest || candidate.modelAlias !== turn.modelAlias)
			throw new Error("Conversation computer output requires rebootstrap after conversation history changed");
	}
}
