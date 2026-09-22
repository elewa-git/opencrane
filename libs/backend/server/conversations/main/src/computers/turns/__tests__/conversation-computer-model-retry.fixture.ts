import { WrongExpectedVersionError } from "@kurrent/kurrentdb-client";
import { HistoryExpectedRevisions, type HistoryAppend, type HistoryReadRequest, type HistoryRecordedEvent } from "@opencrane/backend/server/infra/history-store";
import { ConversationModelPreForwardContracts, ConversationModelPreForwardReasons, ConversationModelToolModes } from "@opencrane/contracts";
import { vi } from "vitest";

import { _ConversationModelInitialNonce, _ConversationModelLogicalFence } from "../conversation-computer-model-retry";
import type { ConversationComputerModelRejection, ConversationComputerModelRetryClaim } from "../conversation-computer-model-retry.types";
import { _ConversationModelRequestDigest } from "../conversation-computer-model-reservation";
import { _ConversationComputerTurnHistoryDigest, _InitialConversationComputerTurnProtocol, _ReduceConversationComputerTurnProtocol } from "../conversation-computer-turn-protocol";
import { ConversationComputerTurnProtocolEvents } from "../conversation-computer-turn-protocol.types";
import type { ConversationComputerTurnModelReservation } from "../conversation-computer-turn-protocol.types";
import { KurrentConversationComputerTurnStore } from "../conversation-computer-turn-store";
import type { FrozenConversationComputerTurn } from "../conversation-computer-turn.types";

export const _NOW = 1_800_000_000_000;
export const _DIGEST = `sha256:${"a".repeat(64)}`;
export const _TURN: FrozenConversationComputerTurn = {
	bootstrapId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", siloId: "testv5", computerId: "computer-1",
	lease: { leaseId: "lease-1", leaseGeneration: 1, sandboxClaimId: "computer-1-g1" },
	latestPendingEntryId: "entry-1", latestPendingEntryPosition: "1", modelAlias: "primary", maximumBudgetUsd: 0.05, credentialLifetimeSeconds: 300,
	binding: { siloId: "testv5", conversationId: "conversation-1", computerId: "computer-1", leaseGeneration: 1, agentIdentityId: "identity-1", agentServiceId: "service-1", agentName: "Ada", agentAvatarArtifactRevisionId: null, runId: "run-1", expectedRevision: 1n, maximumEntryBytes: 65_536 },
	compile: { runId: "run-1", attempt: 1, promptCompilerVersion: "computer-v2", digest: _DIGEST },
	budget: { maxModelTurns: 3, maxCompletionTokens: 300, maxCostUsdMicros: null, maxToolInvocations: 2, maxLoopIterations: 2, wallClockDeadlineEpochMs: _NOW + 300_000 },
	protocol: _InitialConversationComputerTurnProtocol(),
};

export function _Reservation(): ConversationComputerTurnModelReservation
{
	const facts = { ordinal: 1, tools: ConversationModelToolModes.Select, compiledInputDigest: _DIGEST, historyDigest: _ConversationComputerTurnHistoryDigest([]), maxCompletionTokens: 100, authorityExpiresAtEpochMs: _NOW + 300_000, dispatchDeadlineEpochMs: _NOW + 25_000 } as const;
	return { ...facts, invocationFence: "41c1f1dc-0010-4f13-9c2f-d3841ffd6651", requestDigest: _ConversationModelRequestDigest(_TURN, facts) };
}

export function _Rejection(nonce = _ConversationModelInitialNonce(_Reservation()), elapsed = 0): ConversationComputerModelRejection
{
	return {
		receipt: { version: ConversationModelPreForwardContracts.V1, reason: ConversationModelPreForwardReasons.LocalRateLimit, physicalNonce: nonce, logicalFence: _ConversationModelLogicalFence(_Reservation()), requestBodySha256: "b".repeat(64), deadlineEpochMs: _NOW + 25_000, retryAtEpochMs: _NOW + elapsed + 1_000 },
		credentialDigest: _DIGEST, credentialExpiresAt: new Date(_NOW + 300_000).toISOString(), receivedAtEpochMs: _NOW + elapsed,
	};
}

export function _Claim(retryOrdinal = 1): ConversationComputerModelRetryClaim
{
	return { ordinal: 1, modelInvocationFence: _Reservation().invocationFence, retryOrdinal, physicalNonce: String(retryOrdinal).repeat(64), claimedAtEpochMs: _NOW + retryOrdinal * 1_000 };
}

export function _ReservedProtocol()
{
	return _ReduceConversationComputerTurnProtocol(_TURN.protocol, { kind: ConversationComputerTurnProtocolEvents.ModelReserved, reservation: _Reservation() }, _TURN.budget);
}

export function _RetryFixture()
{
	const streams = new Map<string, HistoryRecordedEvent[]>();
	const append = vi.fn(async function _Append(input: HistoryAppend)
	{
		const events = streams.get(input.streamName) ?? [];
		if (input.events.every(candidate => events.some(event => event.id === candidate.id)))
			return [];
		const current = events.length === 0 ? HistoryExpectedRevisions.NoStream : BigInt(events.length - 1);
		if (input.expectedRevision !== current)
			throw new WrongExpectedVersionError(undefined, { streamName: input.streamName, expected: input.expectedRevision as never, current: current as never });
		for (const event of input.events)
			events.push({ ...structuredClone(event), streamName: input.streamName, revision: BigInt(events.length), recordedAt: new Date(_NOW) } as HistoryRecordedEvent);
		streams.set(input.streamName, events);
		return [];
	});
	const history = {
		append,
		appendAtomic: vi.fn(),
		readStream: vi.fn(function _Read(input: HistoryReadRequest)
		{
			return (async function* _Events()
			{
				const events = (streams.get(input.streamName) ?? []).filter(event => event.revision >= (input.fromRevision ?? 0n));
				for (const event of events.slice(0, input.maxCount ?? events.length))
					yield structuredClone(event);
			})();
		}),
	};
	return { history, streams, store: new KurrentConversationComputerTurnStore(history as never) };
}

export async function _WaitingFixture()
{
	const fixture = _RetryFixture();
	await fixture.store.createOrRead(_TURN);
	await fixture.store.reserveModel(_TURN.bootstrapId, _Reservation());
	await fixture.store.recordModelRejection(_TURN.bootstrapId, _Rejection());
	return fixture;
}
