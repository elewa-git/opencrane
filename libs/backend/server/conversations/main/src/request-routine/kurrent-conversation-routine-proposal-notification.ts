import { ___DoWithTrace } from "@opencrane/backend/observability";
import type { RequestRoutineProposalNotificationEvidenceReader } from "@opencrane/backend/server/agents/scheduling/contract";
import { ConversationHistoryAppendOutcomes, ConversationHistoryAuthority, ConversationHistoryReader } from "@opencrane/backend/server/conversations/history";
import type { HistoryEvent, HistoryRecordedEvent, HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { ConversationAuthorKinds, ConversationEntryAudiences, ConversationEntryKinds, ConversationEntryProvenance, ConversationLogKinds, ConversationRoutineProposalLogPhases, ___ConversationEntrySchema, type RoutineProposalLogEntry } from "@opencrane/contracts";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { _ConversationComputerEventId } from "../computers/conversation-computer-event-id";
import { ConversationRoutineProposalNotificationOutcomes, type ConversationRoutineProposalNotificationCommand, type ConversationRoutineProposalNotificationPort, type ConversationRoutineProposalRecipientReader } from "../computers/turns/request-routine/conversation-request-routine.types";

const _APPEND_ATTEMPTS = 4;
const _RECEIPT_EVENT_TYPE = "opencrane.conversation-routine-proposal-notification.v1";
const _SUMMARY = "Routine proposal ready for review";

/** Publishes one content-free requester-only proposal entry with a private receipt. */
export class KurrentConversationRoutineProposalNotificationPublisher implements ConversationRoutineProposalNotificationPort
{
	private readonly _historyAuthority: ConversationHistoryAuthority;
	private readonly _historyReader: ConversationHistoryReader;

	public constructor(private readonly _evidence: RequestRoutineProposalNotificationEvidenceReader, private readonly _recipients: ConversationRoutineProposalRecipientReader, historyAuthority: ConversationHistoryAuthority, historyReader: ConversationHistoryReader, private readonly _history: Pick<HistoryStore, "append" | "appendAtomic" | "readHead" | "readStream">, private readonly _clock: { now(): Date } = { now: function _Now() { return new Date(); } })
	{
		this._historyAuthority = historyAuthority;
		this._historyReader = historyReader;
	}

	public async publish(command: ConversationRoutineProposalNotificationCommand): Promise<ConversationRoutineProposalNotificationOutcomes>
	{
		const publisher = this;
		return ___DoWithTrace("conversation.routine_proposal.publish", { siloId: command.siloId, conversationId: command.sourceConversationId, runId: command.runId, proposalRef: command.proposalRef }, async function _PublishRoutineProposal() { return publisher._Publish(command); });
	}

	private async _Publish(command: ConversationRoutineProposalNotificationCommand): Promise<ConversationRoutineProposalNotificationOutcomes>
	{
		_AssertCommand(command);
		for (let attempt = 0; attempt < _APPEND_ATTEMPTS; attempt += 1)
		{
			const recipient = await this._recipients.readCurrent(command);
			if (recipient === null)
				return ConversationRoutineProposalNotificationOutcomes.NoLongerVisible;
			const recovered = await this._Recover(command, recipient.participantId);
			if (recovered)
				return ConversationRoutineProposalNotificationOutcomes.Published;
			const current = await this._evidence.readCurrent(command);
			if (current === null)
				return ConversationRoutineProposalNotificationOutcomes.NoLongerVisible;
			const streamName = _ConversationStream(command.sourceConversationId);
			const head = await this._history.readHead(streamName);
			if (head.streamName !== streamName || head.revision === null)
				throw new Error("Routine proposal notification requires immutable conversation genesis");
			const intent = _Intent(command, recipient.participantId, this._clock.now().toISOString(), head.revision);
			const result = await this._historyAuthority.appendWithAttestation(intent.command);
			if (result.outcome === ConversationHistoryAppendOutcomes.Appended)
				return ConversationRoutineProposalNotificationOutcomes.Published;
		}
		throw new Error("Routine proposal notification history remained contended");
	}

	private async _Recover(command: ConversationRoutineProposalNotificationCommand, participantId: string): Promise<boolean>
	{
		let receipt: HistoryRecordedEvent | null = null;
		for await (const event of this._history.readStream({ streamName: _ReceiptStream(command.proposalRef), fromRevision: 0n, maxCount: 2 }))
		{
			if (receipt !== null)
				throw new Error("Routine proposal notification receipt stream contains multiple events");
			receipt = event;
		}
		if (receipt === null)
			return false;
		const entry = _ReadReceipt(receipt, command, participantId);
		const history = await this._historyReader.read({ siloId: command.siloId, conversationId: command.sourceConversationId, fromRevision: BigInt(entry.position), maxCount: 1, maximumBytes: 65_536 });
		if (history.entries[0] === undefined || ___DigestCanonicalJson(history.entries[0] as unknown as JsonValue) !== ___DigestCanonicalJson(entry as unknown as JsonValue))
			throw new Error("Routine proposal notification receipt omitted its conversation entry");
		return true;
	}
}

function _Intent(command: ConversationRoutineProposalNotificationCommand, participantId: string, occurredAt: string, expectedRevision: bigint)
{
	const receiptStream = _ReceiptStream(command.proposalRef);
	const receiptId = _ConversationComputerEventId("routine-proposal-notification-receipt", command.proposalRef);
	const entryId = _ConversationComputerEventId("routine-proposal-notification-entry", command.proposalRef);
	const entry: RoutineProposalLogEntry = { schemaVersion: 1, id: entryId, conversationId: command.sourceConversationId, position: (expectedRevision + 1n).toString(), author: { kind: ConversationAuthorKinds.System, systemId: "opencrane", name: "OpenCrane" }, provenance: ConversationEntryProvenance.ServiceAttested, visibility: { audience: ConversationEntryAudiences.ParticipantSubset, participantIds: [participantId] }, runId: command.runId, causationId: command.proposalRef, correlationId: command.runId, idempotencyKey: entryId, occurredAt, attestation: { serviceId: "opencrane", receiptId, domainStream: receiptStream, domainRevision: "0", decisionEvidenceId: null }, kind: ConversationEntryKinds.Log, logKind: ConversationLogKinds.RoutineProposal, proposalRef: command.proposalRef, phase: ConversationRoutineProposalLogPhases.ReadyForReview, summary: _SUMMARY, detailsRef: null };
	const parsed = ___ConversationEntrySchema.parse(entry) as RoutineProposalLogEntry;
	const event: HistoryEvent = { id: receiptId, type: _RECEIPT_EVENT_TYPE, data: { command, entry: parsed }, metadata: { siloId: command.siloId, conversationId: command.sourceConversationId, runId: command.runId, proposalRef: command.proposalRef } };
	return { command: { siloId: command.siloId, conversationId: command.sourceConversationId, expectedRevision, entry: parsed, attestation: { streamName: receiptStream, event } }, entry: parsed };
}

function _ReadReceipt(event: HistoryRecordedEvent, command: ConversationRoutineProposalNotificationCommand, participantId: string): RoutineProposalLogEntry
{
	if (event.streamName !== _ReceiptStream(command.proposalRef) || event.revision !== 0n || event.type !== _RECEIPT_EVENT_TYPE)
		throw new Error("Routine proposal notification receipt has invalid stream coordinates");
	if (typeof event.data !== "object" || event.data === null || Array.isArray(event.data))
		throw new Error("Routine proposal notification receipt has invalid data");
	const data = event.data as { readonly command?: unknown; readonly entry?: unknown };
	if (!_SameCommand(data.command, command))
		throw new Error("Routine proposal notification receipt differs from its source coordinates");
	const parsed = ___ConversationEntrySchema.safeParse(data.entry);
	if (!parsed.success)
		throw new Error("Routine proposal notification receipt has invalid safe entry");
	const entry = parsed.data;
	if (entry.kind !== ConversationEntryKinds.Log || entry.logKind !== ConversationLogKinds.RoutineProposal || entry.proposalRef !== command.proposalRef || entry.phase !== ConversationRoutineProposalLogPhases.ReadyForReview || entry.summary !== _SUMMARY || entry.detailsRef !== null || entry.visibility.audience !== ConversationEntryAudiences.ParticipantSubset || entry.visibility.participantIds.length !== 1 || entry.visibility.participantIds[0] !== participantId)
		throw new Error("Routine proposal notification receipt has invalid safe entry");
	return entry;
}

/** Compares the complete content-free proposal coordinates without parsing untrusted receipt data. */
function _SameCommand(value: unknown, command: ConversationRoutineProposalNotificationCommand): boolean
{
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return false;
	const candidate = value as Readonly<Record<string, unknown>>;
	return Object.keys(candidate).length === 9 && candidate.bootstrapId === command.bootstrapId && candidate.siloId === command.siloId && candidate.sourceConversationId === command.sourceConversationId && candidate.runId === command.runId && candidate.attempt === command.attempt && candidate.ordinal === command.ordinal && candidate.requesterPrincipalId === command.requesterPrincipalId && candidate.proposalRef === command.proposalRef && candidate.expiresAt === command.expiresAt;
}

function _AssertCommand(command: ConversationRoutineProposalNotificationCommand): void
{
	if ([command.bootstrapId, command.siloId, command.sourceConversationId, command.runId, command.requesterPrincipalId, command.proposalRef].some(value => value.trim().length === 0) || !Number.isSafeInteger(command.attempt) || command.attempt < 1 || !Number.isSafeInteger(command.ordinal) || command.ordinal < 1 || !Number.isFinite(Date.parse(command.expiresAt)))
		throw new Error("Routine proposal notification requires immutable coordinates");
}

function _ReceiptStream(proposalRef: string): string { return `conversation-routine-proposal-notification-${proposalRef}`; }
function _ConversationStream(conversationId: string): string { return `conversation-${conversationId}`; }
