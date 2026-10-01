import { ComputerLeaseStates, ConversationComputerStates } from "@opencrane/contracts";

import { ConversationComputerHistory } from "@opencrane/backend/server/conversations/computers";
import type { ConversationComputerPendingTurnCompiler, ConversationComputerProcessLeaseCommand, ConversationComputerTurnCandidate, ConversationComputerTurnCandidateResolver, ConversationComputerTurnExecution, ConversationComputerTurnHistoryAnchor, ConversationComputerTurnProjectionRepository, ConversationComputerTurnWorkflowCommand, FrozenConversationComputerTurn } from "./conversation-computer-turn.types";
import { _ConversationComputerTurnAuthorityEndedError } from "./conversation-computer-turn-errors";
import type { ConversationComputerProcessResolver, ConversationComputerRealizer } from "../../conversation-computer-realization.types";

/** Resolves a pending turn only after exact silo, lease, realization, and process checks. */
export class ActiveConversationComputerTurnCandidateResolver implements ConversationComputerTurnCandidateResolver
{
	/** Binds history and compilation to the process ports selected by app composition. */
	public constructor(private readonly siloId: string, private readonly projections: ConversationComputerTurnProjectionRepository, private readonly computers: ConversationComputerHistory, private readonly realizer: Pick<ConversationComputerRealizer, "bind">, private readonly processes: ConversationComputerProcessResolver, private readonly compiler: ConversationComputerPendingTurnCompiler) {}

	/** Check the lease and process binding with the same rules as resolve while admitting no run. */
	public async admit(command: ConversationComputerProcessLeaseCommand): Promise<void>
	{
		await this._Admit(command);
	}

	/** Resolve one currently active generation and compile its pending input. */
	public async resolve(command: ConversationComputerProcessLeaseCommand): Promise<ConversationComputerTurnCandidate | null>
	{
		const { projection, current, lease } = await this._Admit(command);
		return this._Compile(command.computerId, projection, current, lease);
	}

	/** Resolve the current process from the persisted realization instead of accepting a request as authority. */
	public async resolveForWorkflow(command: ConversationComputerTurnWorkflowCommand): Promise<ConversationComputerTurnExecution | null>
	{
		const { projection, current, lease } = await this._CurrentLease(command);
		const process = await this._ResolveProcess(command.computerId, lease);
		const candidate = await this._Compile(command.computerId, projection, current, lease);
		return candidate === null ? null : { candidate, process };
	}

	/** Compile the pending input after the caller has proved the current lease and Pod. */
	private async _Compile(computerId: string, projection: { readonly conversationId: string; readonly agentIdentityId: string; readonly profileRevisionId: string }, current: { readonly lease: { readonly expiresAt: string } }, lease: ConversationComputerTurnCandidate["lease"], anchor?: ConversationComputerTurnHistoryAnchor): Promise<ConversationComputerTurnCandidate | null>
	{
		const command = { computer: { siloId: this.siloId, computerId, conversationId: projection.conversationId, agentIdentityId: projection.agentIdentityId }, profileRevisionId: projection.profileRevisionId, lease };
		const candidate = anchor === undefined ? await this.compiler.compile(command) : await this.compiler.compile(command, anchor);
		if (candidate === null)
			return null;
		const expiresAt = Math.min(Date.parse(current.lease.expiresAt), Date.parse(candidate.credentialExpiresAt));
		const remainingLeaseSeconds = Math.floor((expiresAt - Date.now()) / 1_000);
		if (!Number.isFinite(expiresAt) || remainingLeaseSeconds < 1)
			throw new _ConversationComputerTurnAuthorityEndedError("Conversation computer turn requires enough remaining lease time");
		return { ...candidate, credentialLifetimeSeconds: Math.min(candidate.credentialLifetimeSeconds, remainingLeaseSeconds), credentialExpiresAt: new Date(expiresAt).toISOString() };
	}

	/** Load the projection and current history, then require the exact active lease and its bound process. */
	private async _Admit(command: ConversationComputerProcessLeaseCommand)
	{
		const { projection, current, lease } = await this._CurrentLease(command);
		if (!await this.realizer.bind({ computerId: command.computerId, lease, process: command.process }))
			throw new _ConversationComputerTurnAuthorityEndedError("Conversation computer review caller is not bound to the active realization");
		return { projection, current: { ...current, lease: current.lease }, lease };
	}

	/** Load the canonical active generation before either Pod or workflow identity is checked. */
	private async _CurrentLease(command: Pick<ConversationComputerTurnWorkflowCommand, "computerId" | "lease">)
	{
		const projection = await this.projections.resolve(this.siloId, command.computerId);
		if (projection === null)
			throw new _ConversationComputerTurnAuthorityEndedError("Conversation computer cannot resolve a computer in the server silo");
		const current = await this.computers.load({ computer: { siloId: this.siloId, computerId: command.computerId, conversationId: projection.conversationId, agentIdentityId: projection.agentIdentityId }, profileRevisionId: projection.profileRevisionId });
		if (current === null || current.computer.state !== ConversationComputerStates.Warm || current.lease?.state !== ComputerLeaseStates.Active || current.lease.id !== command.lease.leaseId || current.lease.generation !== command.lease.leaseGeneration || current.computer.leaseGeneration !== command.lease.leaseGeneration || Date.parse(current.lease.expiresAt) <= Date.now())
			throw new _ConversationComputerTurnAuthorityEndedError("Conversation computer requires the current active lease generation");
		const lease = { leaseId: command.lease.leaseId, leaseGeneration: command.lease.leaseGeneration, realization: current.lease.realization };
		return { projection, current: { ...current, lease: current.lease }, lease };
	}

	/** Recheck lease, generation, process binding and the exact conversation revision before output. */
	public async assertCurrent(turn: FrozenConversationComputerTurn, process: ConversationComputerProcessLeaseCommand["process"]): Promise<ConversationComputerTurnCandidate>
	{
		if (turn.siloId !== this.siloId)
			throw new _ConversationComputerTurnAuthorityEndedError("Conversation computer output crossed its admitted silo");
		const { projection, current, lease } = await this._Admit({ computerId: turn.computerId, lease: turn.lease, process });
		const candidate = await this._Compile(turn.computerId, projection, current, lease, { expectedRevision: turn.binding.expectedRevision, latestPendingEntryId: turn.latestPendingEntryId });
		if (candidate === null || candidate.latestPendingEntryId !== turn.latestPendingEntryId || candidate.compiledInput.digest !== turn.compile.digest || candidate.modelAlias !== turn.modelAlias)
			throw new _ConversationComputerTurnAuthorityEndedError("Conversation computer output requires the original conversation history");
		return candidate;
	}

	/** Resolve the live process from the persisted realization after current lease validation. */
	private async _ResolveProcess(computerId: string, lease: ConversationComputerTurnCandidate["lease"])
	{
		const process = await this.processes.resolve({ computerId, lease });
		if (process === null)
			throw new _ConversationComputerTurnAuthorityEndedError("Conversation computer workflow requires the lease-bound process");
		return process;
	}

	/** Recheck the exact frozen input and resolve the live process before a server-owned effect. */
	public async assertCurrentForWorkflow(turn: FrozenConversationComputerTurn): Promise<ConversationComputerTurnExecution>
	{
		const { projection, current, lease } = await this._CurrentLease({ computerId: turn.computerId, lease: turn.lease });
		const process = await this._ResolveProcess(turn.computerId, lease);
		const candidate = await this._Compile(turn.computerId, projection, current, lease, { expectedRevision: turn.binding.expectedRevision, latestPendingEntryId: turn.latestPendingEntryId });
		if (candidate === null || candidate.latestPendingEntryId !== turn.latestPendingEntryId || candidate.compiledInput.digest !== turn.compile.digest || candidate.modelAlias !== turn.modelAlias)
			throw new _ConversationComputerTurnAuthorityEndedError("Conversation computer output requires restart after conversation history changed");
		return { candidate, process };
	}

	/** Recheck the live lease and process without recompiling input already consumed by a saved output. */
	public async assertLeaseForWorkflow(turn: FrozenConversationComputerTurn): Promise<ConversationComputerTurnExecution["process"]>
	{
		if (turn.siloId !== this.siloId)
			throw new _ConversationComputerTurnAuthorityEndedError("Conversation computer output crossed its admitted silo");
		const { lease } = await this._CurrentLease({ computerId: turn.computerId, lease: turn.lease });
		return this._ResolveProcess(turn.computerId, lease);
	}
}
