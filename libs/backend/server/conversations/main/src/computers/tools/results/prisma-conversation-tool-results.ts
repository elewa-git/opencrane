import { Prisma, type PrismaClient } from "@prisma/client";

import { CONVERSATION_COMPUTER_PROJECTED_TOKEN_AUDIENCE } from "@opencrane/contracts";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import { __ConsumeRunToolResultInTransaction, __ReadRunToolResultInTransaction, RunToolResultPendingKinds, RunToolResultReadOutcomes } from "@opencrane/backend/server/iam/authorization";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";
import type { RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { ConversationComputerToolResultOutcomes, type ConversationComputerToolResult, type ConversationComputerToolResults } from "../../turns/conversation-computer-continuation.types";
import type { ConversationComputerTurnCandidateResolver, ConversationComputerTurnStore, FrozenConversationComputerTurn } from "../../turns/conversation-computer-turn.types";
import { _ConversationComputerTurnHistoryDigest } from "../../turns/conversation-computer-turn-protocol";
import { ConversationComputerTurnProtocolStates } from "../../turns/conversation-computer-turn-protocol.types";
import type { ConversationToolDispatchDependencies } from "../dispatch/conversation-tool-dispatch.types";
import { ConversationGeneratedFileResultStates, type ConversationGeneratedFileResultRepository, type ConversationGeneratedFileResultRepositoryFactory } from "./conversation-generated-file-result.types";
import { PrismaConversationToolDispatchAuthority } from "../dispatch/prisma-conversation-tool-dispatch-authority";

/** Signals that the complete transaction must roll back before reporting unavailable content. */
class _ResultAuthorityEnded extends Error {}

/** Compare frozen inputs while allowing the ordered protocol to advance between retries. */
function _sameTurn(expected: FrozenConversationComputerTurn, stored: FrozenConversationComputerTurn): boolean
{
	/** Excludes derived progress while keeping every original turn and selection coordinate. */
	function _identity(turn: FrozenConversationComputerTurn): JsonValue
	{
		const { protocol: _protocol, ...identity } = turn;
		return { ...identity, binding: { ...turn.binding, expectedRevision: turn.binding.expectedRevision.toString() } } as unknown as JsonValue;
	}
	return ___DigestCanonicalJson(_identity(expected)) === ___DigestCanonicalJson(_identity(stored));
}

/** Select the current tool step for a read, or its historical result after a later model reservation. */
function _ToolStep(turn: FrozenConversationComputerTurn, consume: boolean)
{
	const current = turn.protocol.steps.at(-1);
	if (!consume && (current?.state === ConversationComputerTurnProtocolStates.ToolPending || current?.state === ConversationComputerTurnProtocolStates.ResultReady))
		return current;
	if (current?.state === ConversationComputerTurnProtocolStates.ModelReserved && current.reservation.ordinal > 1
		&& current.reservation.historyDigest === _ConversationComputerTurnHistoryDigest(turn.protocol.steps))
	{
		const historical = turn.protocol.steps.at(-2);
		if (historical?.state === ConversationComputerTurnProtocolStates.ResultReady)
			return historical;
	}
	return null;
}

/** Keep a retry bound to the same ordered selection while its step advances to a saved result. */
function _SameToolStep(expected: ReturnType<typeof _ToolStep>, stored: ReturnType<typeof _ToolStep>): boolean
{
	if (expected === null || stored === null)
		return false;
	return expected.reservation.ordinal === stored.reservation.ordinal
		&& expected.reservation.invocationFence === stored.reservation.invocationFence
		&& expected.selection.proposalId === stored.selection.proposalId
		&& expected.selection.toolInvocationId === stored.selection.toolInvocationId
		&& expected.selection.requestFingerprint === stored.selection.requestFingerprint
		&& (expected.result === null || stored.result?.resultDigest === expected.result.resultDigest);
}

/**
 * Reads result integrity and current tool authority in the same PostgreSQL transaction.
 * Acknowledgement is allowed only after the unit of work verifies the saved second-call reservation.
 * Provider content never enters telemetry, and no method claims an executor or sends a model call.
 */
export class PrismaConversationToolResultsRepository implements ConversationComputerToolResults
{
	/** Keep the result owner and existing dispatch authority on this transaction. */
	public constructor(private readonly transaction: Prisma.TransactionClient, private readonly dependencies: ConversationToolDispatchDependencies, private readonly generatedFiles: ConversationGeneratedFileResultRepository) {}

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
		const current = turn.protocol.steps.at(-1);
		const currentModel = current?.state === ConversationComputerTurnProtocolStates.ModelReserved ? current.reservation : null;
		const step = _ToolStep(turn, consume);
		if (step === null)
			return { outcome: ConversationComputerToolResultOutcomes.Unavailable };
		const selection = step.selection;
		const command = { siloId: turn.siloId, runId: turn.compile.runId, attempt: turn.compile.attempt, toolInvocationId: selection.toolInvocationId, runtimeInstanceId: turn.computerId, commandId: turn.bootstrapId, requestFingerprint: selection.requestFingerprint };
		let result = await __ReadRunToolResultInTransaction(this.transaction, command);
		if (result.outcome !== RunToolResultReadOutcomes.Available)
		{
			if (result.outcome !== RunToolResultReadOutcomes.Pending || consume)
				return { outcome: ConversationComputerToolResultOutcomes.Unavailable };
			const waitFor = result.pendingKind === RunToolResultPendingKinds.Approval ? "approval" : "result";
			return { outcome: ConversationComputerToolResultOutcomes.Pending, waitFor, waitUntilEpochMs: result.pendingUntilEpochMs };
		}
		const resultReservation = step.reservation;
		if (step.result !== null && (step.result.proposalId !== selection.proposalId || step.result.resultDigest !== result.payloadDigest))
			return { outcome: ConversationComputerToolResultOutcomes.Unavailable };
		if (consume && (currentModel === null || currentModel.historyDigest !== _ConversationComputerTurnHistoryDigest(turn.protocol.steps)))
			return { outcome: ConversationComputerToolResultOutcomes.Unavailable };
		const authority = new PrismaConversationToolDispatchAuthority(this.transaction, this.dependencies);
		const auditedWorkload = { audience: CONVERSATION_COMPUTER_PROJECTED_TOKEN_AUDIENCE, namespace: workload.namespace, serviceAccountName: workload.serviceAccountName, workloadKind: "pod" as const, workloadUid: workload.podUid, podUid: workload.podUid };
		const admission = await authority.admit(result.invocation, new Date(), auditedWorkload);
		if (admission === null)
			return { outcome: ConversationComputerToolResultOutcomes.Unavailable };
		const admittedUntil = admission.notAfterEpochMs;
		const notAfterEpochMs = Math.min(admittedUntil, resultReservation.authorityExpiresAtEpochMs, step.result?.authorityExpiresAtEpochMs ?? admittedUntil, currentModel?.authorityExpiresAtEpochMs ?? admittedUntil, consume && currentModel !== null ? currentModel.dispatchDeadlineEpochMs : admittedUntil);
		if (!Number.isSafeInteger(notAfterEpochMs) || notAfterEpochMs <= Date.now())
			return { outcome: ConversationComputerToolResultOutcomes.Unavailable };
		const generated = await this.generatedFiles.read({ turn, invocation: result.invocation, payload: result.payload, admission });
		if (generated.state === ConversationGeneratedFileResultStates.Unavailable)
			return { outcome: ConversationComputerToolResultOutcomes.Unavailable };
		if (generated.state === ConversationGeneratedFileResultStates.Pending)
		{
			if (consume)
				return { outcome: ConversationComputerToolResultOutcomes.Unavailable };
			return { outcome: ConversationComputerToolResultOutcomes.GeneratedFilePending, operationId: generated.operationId, notAfterEpochMs: Math.min(notAfterEpochMs, generated.notAfterEpochMs) };
		}
		const generatedFile = generated.state === ConversationGeneratedFileResultStates.NotGenerated ? undefined : generated;
		if (consume)
		{
			if (currentModel === null)
				return { outcome: ConversationComputerToolResultOutcomes.Unavailable };
			const expectedDigest = step.result?.resultDigest;
			if (expectedDigest === undefined)
				return { outcome: ConversationComputerToolResultOutcomes.Unavailable };
			result = await __ConsumeRunToolResultInTransaction(this.transaction, { ...command, payloadDigest: expectedDigest }, new Date());
			if (result.outcome !== RunToolResultReadOutcomes.Available || !result.consumed || result.payloadDigest !== expectedDigest)
				throw new _ResultAuthorityEnded();
		}
		if (notAfterEpochMs <= Date.now())
			throw new _ResultAuthorityEnded();
		return { outcome: ConversationComputerToolResultOutcomes.Available, payload: result.payload, payloadDigest: result.payloadDigest, toolRevisionId: result.invocation.toolRevisionId, occurredAt: result.occurredAt, notAfterEpochMs, ...(generatedFile === undefined ? {} : { generatedFile }) };
	}
}

/**
 * Verifies the actual saved turn and TokenReviewed Pod before reading a result in its transaction.
 * Consume requires a later model reservation whose ordered history binds the exact historical
 * result. A caller-supplied result cannot acknowledge a delivery before that binding exists.
 * Database rollback retries repeat those history and Pod checks; uncertain failures are not retried.
 */
export class PrismaConversationToolResultsUnitOfWork implements ConversationComputerToolResults
{
	/** Bind the installation, real turn store, current Pod checks and existing tool authority. */
	public constructor(private readonly prisma: PrismaClient, private readonly siloId: string, private readonly store: ConversationComputerTurnStore, private readonly candidates: Pick<ConversationComputerTurnCandidateResolver, "admit">, private readonly dependencies: ConversationToolDispatchDependencies, private readonly generatedFiles: ConversationGeneratedFileResultRepositoryFactory) {}

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
		const { prisma, siloId, store, candidates, dependencies, generatedFiles } = this;
		return ___DoWithTrace("conversation.tool_result.read", {}, async function _ReadResult()
		{
			try
			{
				return await ___RunInPrismaUnitOfWork(prisma, async function _Read(transaction)
				{
					if (expected.siloId !== siloId)
						return { outcome: ConversationComputerToolResultOutcomes.Unavailable };
					const stored = await store.load(expected.bootstrapId);
					if (stored === null || !_sameTurn(expected, stored))
						return { outcome: ConversationComputerToolResultOutcomes.Unavailable };
					if (!_SameToolStep(_ToolStep(expected, consume), _ToolStep(stored, consume)))
						return { outcome: ConversationComputerToolResultOutcomes.Unavailable };
					if (consume)
					{
						const expectedCurrent = expected.protocol.steps.at(-1);
						const storedCurrent = stored.protocol.steps.at(-1);
						if (expectedCurrent?.state !== ConversationComputerTurnProtocolStates.ModelReserved
							|| storedCurrent?.state !== ConversationComputerTurnProtocolStates.ModelReserved
							|| expectedCurrent.reservation.ordinal !== storedCurrent.reservation.ordinal
							|| ___DigestCanonicalJson(expectedCurrent.reservation as unknown as JsonValue) !== ___DigestCanonicalJson(storedCurrent.reservation as unknown as JsonValue))
							return { outcome: ConversationComputerToolResultOutcomes.Unavailable };
					}
					await candidates.admit({ computerId: stored.computerId, lease: stored.lease, workload: reviewedWorkload });
					const repository = new PrismaConversationToolResultsRepository(transaction, dependencies, generatedFiles(transaction));
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
