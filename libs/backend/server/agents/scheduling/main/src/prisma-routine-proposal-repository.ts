import { AgentRoutineProposalState, type AgentRoutineProposal, type Prisma } from "@prisma/client";

import type { RequestRoutineProposalNotificationEvidence, RequestRoutineProposalSource, RequestRoutineProposalSourceAuthority } from "@opencrane/backend/server/agents/scheduling/contract";
import { RoutineProposalStates } from "@opencrane/contracts";

import type { RoutineCaller } from "./routine-authority.types";
import { RoutineCommandConflictError, RoutineCommandUnavailableError } from "./routine-command.errors";
import type { RoutineFactsRepository } from "./routine-prisma-facts.types";
import { __DecideRoutineProposalLifecycle } from "./routine-proposal-lifecycle";
import { RoutineProposalLifecycleEvent } from "./routine-proposal-lifecycle.types";
import type { CreateRoutineProposalPersistenceCommand, EncryptedRoutineProposalProjection, RoutineProposalAccessCommand, RoutineProposalPersistence } from "./routine-proposal.types";

/** Applies proposal replay, requester access, expiry and lifecycle transitions in one transaction. */
export class PrismaRoutineProposalRepository implements RoutineProposalPersistence
{
	public constructor(private readonly transaction: Prisma.TransactionClient, private readonly facts: Pick<RoutineFactsRepository, "databaseNow">, private readonly sourceAuthority: RequestRoutineProposalSourceAuthority) {}

	/** @inheritdoc */
	public async propose(command: CreateRoutineProposalPersistenceCommand)
	{
		const source = _Source(command);
		const authorized = await this.sourceAuthority.authorizeCreation(source);
		if (!_ExactSource(authorized, source))
			throw new RoutineCommandUnavailableError("routine proposal source is unavailable");
		const existing = await this.transaction.agentRoutineProposal.findFirst({ where: { siloId: command.siloId, sourceRunId: command.runId, sourceRunAttempt: command.attempt, sourceOrdinal: command.ordinal } });
		if (existing !== null)
		{
			_RequireExactReplay(existing, command);
			return _Receipt(existing);
		}
		const now = await this.facts.databaseNow();
		const created = await this.transaction.agentRoutineProposal.create({ data: {
			id: command.proposalId,
			siloId: command.siloId,
			sourceConversationId: command.sourceConversationId,
			sourceRunId: command.runId,
			sourceRunAttempt: command.attempt,
			sourceOrdinal: command.ordinal,
			requesterPrincipalId: command.requesterPrincipalId,
			suggestionKeyId: command.suggestion.keyId,
			suggestionNonce: command.suggestion.nonce,
			suggestionAuthTag: command.suggestion.authTag,
			suggestionCiphertext: command.suggestion.ciphertext,
			suggestionCiphertextDigest: command.suggestion.ciphertextDigest,
			argumentsDigest: command.argumentsDigest,
			createdAt: now,
			expiresAt: new Date(now.getTime() + 86_400_000),
		}, select: _SELECT });
		return _Receipt(created);
	}

	/** @inheritdoc */
	public async readProposal(command: RoutineProposalAccessCommand): Promise<EncryptedRoutineProposalProjection | null>
	{
		return await this._Access(command, RoutineProposalLifecycleEvent.Read);
	}

	/** @inheritdoc */
	public async cancelProposal(command: RoutineProposalAccessCommand): Promise<EncryptedRoutineProposalProjection | null>
	{
		return await this._Access(command, RoutineProposalLifecycleEvent.Cancel);
	}

	/** Returns only exact pending notification evidence that has not reached database-clock expiry. */
	public async readCurrent(command: RequestRoutineProposalNotificationEvidence): Promise<RequestRoutineProposalNotificationEvidence | null>
	{
		const now = await this.facts.databaseNow();
		const proposal = await this.transaction.agentRoutineProposal.findFirst({ where: { id: command.proposalRef, siloId: command.siloId, sourceConversationId: command.sourceConversationId, sourceRunId: command.runId, sourceRunAttempt: command.attempt, sourceOrdinal: command.ordinal, requesterPrincipalId: command.requesterPrincipalId, state: AgentRoutineProposalState.Pending, expiresAt: { gt: now } } });
		if (proposal === null || proposal.expiresAt.toISOString() !== command.expiresAt)
			return null;
		return { ..._SourceRow(proposal), proposalRef: proposal.id, expiresAt: proposal.expiresAt.toISOString() };
	}

	/** Loads and authorizes the durable source before an existing routine create transaction proceeds. */
	public async prepareAcceptance(caller: RoutineCaller, proposalRef: string, now: Date): Promise<AgentRoutineProposal>
	{
		const proposal = await this._RequesterProposal(caller, proposalRef);
		if (proposal.state === AgentRoutineProposalState.Accepted)
			return proposal;
		const decision = __DecideRoutineProposalLifecycle(_State(proposal.state), RoutineProposalLifecycleEvent.Accept, proposal.expiresAt.getTime() <= now.getTime());
		if (!decision.availableForAcceptance)
			throw new RoutineCommandConflictError("routine proposal is no longer available for acceptance");
		return proposal;
	}

	/** Atomically binds one pending unexpired proposal to the routine created in this transaction. */
	public async acceptPrepared(proposal: AgentRoutineProposal, routineId: string, now: Date): Promise<void>
	{
		const changed = await this.transaction.agentRoutineProposal.updateMany({
			where: { id: proposal.id, siloId: proposal.siloId, requesterPrincipalId: proposal.requesterPrincipalId, state: AgentRoutineProposalState.Pending, expiresAt: { gt: now } },
			data: { state: AgentRoutineProposalState.Accepted, acceptedRoutineId: routineId, terminalAt: now },
		});
		if (changed.count === 1)
			return;
		const winner = await this.transaction.agentRoutineProposal.findUnique({ where: { id: proposal.id } });
		if (winner?.state === AgentRoutineProposalState.Accepted && winner.acceptedRoutineId === routineId)
			return;
		throw new RoutineCommandConflictError("routine proposal acceptance lost its compare-and-set");
	}

	/** Reads current state, expires or cancels pending work, and rereads any durable CAS winner. */
	private async _Access(command: RoutineProposalAccessCommand, event: RoutineProposalLifecycleEvent): Promise<EncryptedRoutineProposalProjection | null>
	{
		let proposal = await this._RequesterProposalOrNull(command.caller, command.proposalRef);
		if (proposal === null)
			return null;
		const now = await this.facts.databaseNow();
		const decision = __DecideRoutineProposalLifecycle(_State(proposal.state), event, proposal.expiresAt.getTime() <= now.getTime());
		if (decision.transition)
		{
			const changed = await this.transaction.agentRoutineProposal.updateMany({
				where: { id: proposal.id, siloId: proposal.siloId, requesterPrincipalId: proposal.requesterPrincipalId, state: proposal.state },
				data: { state: _PrismaState(decision.nextState), terminalAt: now },
			});
			if (changed.count === 0)
			{
				const winner = await this.transaction.agentRoutineProposal.findUnique({ where: { id: proposal.id } });
				if (winner === null)
					return null;
				proposal = winner;
			}
			else
			{
				proposal = { ...proposal, state: _PrismaState(decision.nextState), terminalAt: now };
			}
		}
		return _Projection(proposal);
	}

	/** Enforces requester identity and current source readability from persisted evidence. */
	private async _RequesterProposal(caller: RoutineCaller, proposalRef: string): Promise<AgentRoutineProposal>
	{
		const proposal = await this._RequesterProposalOrNull(caller, proposalRef);
		if (proposal === null)
			throw new RoutineCommandUnavailableError("routine proposal is unavailable");
		return proposal;
	}

	/** Returns null without revealing whether a foreign proposal exists. */
	private async _RequesterProposalOrNull(caller: RoutineCaller, proposalRef: string): Promise<AgentRoutineProposal | null>
	{
		const proposal = await this.transaction.agentRoutineProposal.findFirst({ where: { id: proposalRef, siloId: caller.siloId, requesterPrincipalId: caller.principalId } });
		if (proposal === null)
			return null;
		const source = _SourceRow(proposal);
		const authorized = await this.sourceAuthority.authorizeRequesterAccess(source);
		return _ExactSource(authorized, source) ? proposal : null;
	}
}

const _SELECT = { id: true, siloId: true, sourceConversationId: true, sourceRunId: true, sourceRunAttempt: true, sourceOrdinal: true, requesterPrincipalId: true, suggestionKeyId: true, suggestionNonce: true, suggestionAuthTag: true, suggestionCiphertext: true, suggestionCiphertextDigest: true, argumentsDigest: true, state: true, acceptedRoutineId: true, createdAt: true, expiresAt: true, terminalAt: true } as const;

function _Source(command: CreateRoutineProposalPersistenceCommand): RequestRoutineProposalSource
{
	return { siloId: command.siloId, sourceConversationId: command.sourceConversationId, runId: command.runId, attempt: command.attempt, ordinal: command.ordinal, requesterPrincipalId: command.requesterPrincipalId };
}

function _SourceRow(row: AgentRoutineProposal): RequestRoutineProposalSource
{
	return { siloId: row.siloId, sourceConversationId: row.sourceConversationId, runId: row.sourceRunId, attempt: row.sourceRunAttempt, ordinal: row.sourceOrdinal, requesterPrincipalId: row.requesterPrincipalId };
}

function _ExactSource(actual: RequestRoutineProposalSource | null, expected: RequestRoutineProposalSource): boolean
{
	return actual !== null && actual.siloId === expected.siloId && actual.sourceConversationId === expected.sourceConversationId && actual.runId === expected.runId && actual.attempt === expected.attempt && actual.ordinal === expected.ordinal && actual.requesterPrincipalId === expected.requesterPrincipalId;
}

function _RequireExactReplay(row: AgentRoutineProposal, command: CreateRoutineProposalPersistenceCommand): void
{
	if (row.argumentsDigest !== command.argumentsDigest || row.requesterPrincipalId !== command.requesterPrincipalId || row.sourceConversationId !== command.sourceConversationId)
		throw new RoutineCommandConflictError("routine proposal source slot has different arguments");
}

function _Receipt(row: Pick<AgentRoutineProposal, "id" | "expiresAt">)
{
	return { proposalRef: row.id, expiresAt: row.expiresAt.toISOString() };
}

function _Projection(row: AgentRoutineProposal): EncryptedRoutineProposalProjection
{
	return { proposalRef: row.id, siloId: row.siloId, sourceConversationId: row.sourceConversationId, runId: row.sourceRunId, attempt: row.sourceRunAttempt, ordinal: row.sourceOrdinal, requesterPrincipalId: row.requesterPrincipalId, suggestion: { keyId: row.suggestionKeyId, nonce: Uint8Array.from(row.suggestionNonce), authTag: Uint8Array.from(row.suggestionAuthTag), ciphertext: Uint8Array.from(row.suggestionCiphertext), ciphertextDigest: row.suggestionCiphertextDigest as `sha256:${string}` }, state: _State(row.state), acceptedRoutineId: row.acceptedRoutineId, expiresAt: row.expiresAt.toISOString() };
}

function _State(state: AgentRoutineProposalState): RoutineProposalStates
{
	return {
		[AgentRoutineProposalState.Pending]: RoutineProposalStates.Pending,
		[AgentRoutineProposalState.Accepted]: RoutineProposalStates.Accepted,
		[AgentRoutineProposalState.Cancelled]: RoutineProposalStates.Cancelled,
		[AgentRoutineProposalState.Expired]: RoutineProposalStates.Expired,
	}[state];
}

function _PrismaState(state: RoutineProposalStates): AgentRoutineProposalState
{
	return {
		[RoutineProposalStates.Pending]: AgentRoutineProposalState.Pending,
		[RoutineProposalStates.Accepted]: AgentRoutineProposalState.Accepted,
		[RoutineProposalStates.Cancelled]: AgentRoutineProposalState.Cancelled,
		[RoutineProposalStates.Expired]: AgentRoutineProposalState.Expired,
	}[state];
}
