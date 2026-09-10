import { Prisma, type PrismaClient } from "@prisma/client";

import { CONVERSATION_COMPUTER_PROJECTED_TOKEN_AUDIENCE } from "@opencrane/contracts";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import { __ConsumeRunToolResultInTransaction, __ReadRunToolResultInTransaction, RunToolResultPendingKinds, RunToolResultReadOutcomes } from "@opencrane/backend/server/iam/authorization";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";
import type { RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { ConversationComputerToolResultOutcomes, type ConversationComputerToolResult, type ConversationComputerToolResults } from "../../turns/conversation-computer-continuation.types";
import type { ConversationComputerTurnCandidateResolver, ConversationComputerTurnStore, FrozenConversationComputerTurn } from "../../turns/conversation-computer-turn.types";
import type { ConversationToolDispatchDependencies } from "../dispatch/conversation-tool-dispatch.types";
import { PrismaConversationToolDispatchAuthority } from "../dispatch/prisma-conversation-tool-dispatch-authority";

/** Signals that the complete transaction must roll back before reporting unavailable content. */
class _ResultAuthorityEnded extends Error {}

/** Compare frozen inputs and saved selection while allowing output or call-two progress to advance. */
function _sameTurn(expected: FrozenConversationComputerTurn, stored: FrozenConversationComputerTurn): boolean
{
	/** Excludes derived progress while keeping every original turn and selection coordinate. */
	function _identity(turn: FrozenConversationComputerTurn): JsonValue
	{
		const { continuationReservation: _continuation, outputSourceCommandId: _source, outputReceipt: _receipt, ...identity } = turn;
		return { ...identity, binding: { ...turn.binding, expectedRevision: turn.binding.expectedRevision.toString() } } as unknown as JsonValue;
	}
	return ___DigestCanonicalJson(_identity(expected)) === ___DigestCanonicalJson(_identity(stored));
}

/**
 * Reads result integrity and current tool authority in the same PostgreSQL transaction.
 * Acknowledgement is allowed only after the unit of work verifies the saved second-call reservation.
 * Provider content never enters telemetry, and no method claims an executor or sends a model call.
 */
export class PrismaConversationToolResultsRepository implements ConversationComputerToolResults
{
	/** Keep the result owner and existing dispatch authority on this transaction. */
	public constructor(private readonly transaction: Prisma.TransactionClient, private readonly dependencies: ConversationToolDispatchDependencies) {}

	/** Return the exact terminal content only while the original run and current tool authority agree. */
	public read(turn: FrozenConversationComputerTurn, workload: RuntimeWorkloadIdentity): Promise<ConversationComputerToolResult>
	{
		return this._Read(turn, workload, false);
	}

	/** Acknowledge the saved result and require the same payload and unexpired authority after the write. */
	public consume(turn: FrozenConversationComputerTurn, workload: RuntimeWorkloadIdentity): Promise<ConversationComputerToolResult>
	{
		return this._Read(turn, workload, true);
	}

	/** Keep read and consume on identical coordinate, payload and current-authority checks. */
	private async _Read(turn: FrozenConversationComputerTurn, workload: RuntimeWorkloadIdentity, consume: boolean): Promise<ConversationComputerToolResult>
	{
		const selection = turn.toolSelection;
		if (selection === null)
			return { outcome: ConversationComputerToolResultOutcomes.Unavailable };
		const command = { siloId: turn.siloId, runId: turn.compile.runId, attempt: turn.compile.attempt, toolInvocationId: selection.proposalId, runtimeInstanceId: turn.computerId, commandId: turn.bootstrapId, requestFingerprint: selection.requestFingerprint };
		let result = await __ReadRunToolResultInTransaction(this.transaction, command);
		if (result.outcome !== RunToolResultReadOutcomes.Available)
		{
			if (result.outcome !== RunToolResultReadOutcomes.Pending || consume)
				return { outcome: ConversationComputerToolResultOutcomes.Unavailable };
			const waitFor = result.pendingKind === RunToolResultPendingKinds.Approval ? "approval" : "result";
			return { outcome: ConversationComputerToolResultOutcomes.Pending, waitFor, waitUntilEpochMs: result.pendingUntilEpochMs };
		}
		const reservation = turn.continuationReservation;
		if (reservation !== null && (reservation.proposalId !== selection.proposalId || reservation.resultDigest !== result.payloadDigest))
			return { outcome: ConversationComputerToolResultOutcomes.Unavailable };
		const authority = new PrismaConversationToolDispatchAuthority(this.transaction, this.dependencies);
		const auditedWorkload = { audience: CONVERSATION_COMPUTER_PROJECTED_TOKEN_AUDIENCE, namespace: workload.namespace, serviceAccountName: workload.serviceAccountName, workloadKind: "pod" as const, workloadUid: workload.podUid, podUid: workload.podUid };
		const admittedUntil = await authority.admitUntil(result.invocation, new Date(), auditedWorkload);
		if (admittedUntil === null)
			return { outcome: ConversationComputerToolResultOutcomes.Unavailable };
		const notAfterEpochMs = Math.min(admittedUntil, turn.modelReservation?.authorityExpiresAtEpochMs ?? 0, reservation?.authorityExpiresAtEpochMs ?? admittedUntil, consume ? reservation?.dispatchDeadlineEpochMs ?? 0 : admittedUntil);
		if (!Number.isSafeInteger(notAfterEpochMs) || notAfterEpochMs <= Date.now())
			return { outcome: ConversationComputerToolResultOutcomes.Unavailable };
		if (consume)
		{
			if (reservation === null)
				return { outcome: ConversationComputerToolResultOutcomes.Unavailable };
			result = await __ConsumeRunToolResultInTransaction(this.transaction, { ...command, payloadDigest: reservation.resultDigest }, new Date());
			if (result.outcome !== RunToolResultReadOutcomes.Available || !result.consumed || result.payloadDigest !== reservation.resultDigest)
				throw new _ResultAuthorityEnded();
		}
		if (notAfterEpochMs <= Date.now())
			throw new _ResultAuthorityEnded();
		return { outcome: ConversationComputerToolResultOutcomes.Available, payload: result.payload, payloadDigest: result.payloadDigest, notAfterEpochMs };
	}
}

/**
 * Verifies the actual saved turn and TokenReviewed Pod before reading a result in its transaction.
 * Consume requires the exact ordinal-two reservation read from KurrentDB, including its proposal,
 * result digest and invocation fence. A caller-supplied reservation cannot acknowledge a delivery.
 * Database rollback retries repeat those history and Pod checks; uncertain failures are not retried.
 */
export class PrismaConversationToolResultsUnitOfWork implements ConversationComputerToolResults
{
	/** Bind the installation, real turn store, current Pod checks and existing tool authority. */
	public constructor(private readonly prisma: PrismaClient, private readonly siloId: string, private readonly store: ConversationComputerTurnStore, private readonly candidates: Pick<ConversationComputerTurnCandidateResolver, "admit">, private readonly dependencies: ConversationToolDispatchDependencies) {}

	/** Support both pending continuation and saved-output recovery while the run remains Running. */
	public read(turn: FrozenConversationComputerTurn, workload: RuntimeWorkloadIdentity): Promise<ConversationComputerToolResult>
	{
		return this._Run(turn, workload, false);
	}

	/** Verify durable request evidence before any acknowledgement and roll back expired writes. */
	public consume(turn: FrozenConversationComputerTurn, workload: RuntimeWorkloadIdentity): Promise<ConversationComputerToolResult>
	{
		return this._Run(turn, workload, true);
	}

	/** Keep payload reads, permission decisions and optional acknowledgement in one bounded transaction. */
	private _Run(turn: FrozenConversationComputerTurn, workload: RuntimeWorkloadIdentity, consume: boolean): Promise<ConversationComputerToolResult>
	{
		const expected = structuredClone(turn);
		const reviewedWorkload = structuredClone(workload);
		const { prisma, siloId, store, candidates, dependencies } = this;
		return ___DoWithTrace("conversation.tool_result.read", {}, async function _ReadResult()
		{
			try
			{
				return await ___RunInPrismaUnitOfWork(prisma, async function _Read(transaction)
				{
					if (expected.siloId !== siloId)
						return { outcome: ConversationComputerToolResultOutcomes.Unavailable };
					const stored = await store.load(expected.bootstrapId);
					if (stored === null || !_sameTurn(expected, stored) || stored.toolSelection === null)
						return { outcome: ConversationComputerToolResultOutcomes.Unavailable };
					if (consume && (expected.continuationReservation === null || stored.continuationReservation === null
						|| stored.continuationReservation.ordinal !== 2 || stored.continuationReservation.proposalId !== stored.toolSelection.proposalId
						|| stored.continuationReservation.compiledInputDigest !== stored.compile.digest
						|| ___DigestCanonicalJson(expected.continuationReservation as unknown as JsonValue) !== ___DigestCanonicalJson(stored.continuationReservation as unknown as JsonValue)))
						return { outcome: ConversationComputerToolResultOutcomes.Unavailable };
					await candidates.admit({ computerId: stored.computerId, lease: stored.lease, workload: reviewedWorkload });
					const repository = new PrismaConversationToolResultsRepository(transaction, dependencies);
					return consume ? repository.consume(stored, reviewedWorkload) : repository.read(stored, reviewedWorkload);
				}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, operation: "conversation tool result", attemptLimit: 3, timeout: 10_000 });
			}
			catch (error)
			{
				if (error instanceof _ResultAuthorityEnded)
					return { outcome: ConversationComputerToolResultOutcomes.Unavailable };
				throw error;
			}
		});
	}
}
