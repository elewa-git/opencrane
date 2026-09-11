import { createHash } from "node:crypto";
import { ConversationHistoryAppendOutcomes, ConversationHistoryAuthority, ConversationHistoryReader } from "@opencrane/backend/server/conversations/history";
import { type HistoryEvent, type HistoryRecordedEvent, type HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { ConversationAuthorKinds, ConversationEntryKinds, ___ConversationEntrySchema, type ApprovalLogEntry, type ConversationElicitation } from "@opencrane/contracts";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { ConversationApprovalNotificationOutcomes, type ConversationApprovalNotificationClock, type ConversationApprovalNotificationCommand, type ConversationApprovalNotificationPort, type ConversationApprovalNotificationRequestReader } from "./conversation-approval-notification.types";

/** Maximum checked conversation-head retries before the workflow retries the whole checkpoint. */
const _APPEND_ATTEMPTS = 4;
/** Versioned private receipt event that proves one requested log entry was atomically appended. */
const _RECEIPT_EVENT_TYPE = "opencrane.conversation-approval-notification.v1";

/** Publishes one safe requested-approval fact through current participant authority and KurrentDB history. */
export class KurrentConversationApprovalNotificationPublisher implements ConversationApprovalNotificationPort
{
	/** Participant history validator and atomic append owner. */
	private readonly _historyAuthority: ConversationHistoryAuthority;
	/** Validates conversation envelopes before receipt recovery accepts them. */
	private readonly _historyReader: ConversationHistoryReader;

	/** Bind current Prisma authority and existing KurrentDB history without owning either lifecycle. */
	public constructor(private readonly _requests: ConversationApprovalNotificationRequestReader, historyAuthority: ConversationHistoryAuthority, historyReader: ConversationHistoryReader, private readonly _history: Pick<HistoryStore, "append" | "appendAtomic" | "readHead" | "readStream">, private readonly _clock: ConversationApprovalNotificationClock = { now: function _Now() { return new Date(); } })
	{
		this._historyAuthority = historyAuthority;
		this._historyReader = historyReader;
	}

	/** Publish, recover, or suppress the exact requested entry after current recipient checks. */
	public async publishRequested(command: ConversationApprovalNotificationCommand): Promise<ConversationApprovalNotificationOutcomes>
	{
		_AssertCommand(command);
		for (let attempt = 0; attempt < _APPEND_ATTEMPTS; attempt += 1)
		{
			const request = await this._readCurrent(command);
			if (request === null)
				return ConversationApprovalNotificationOutcomes.NoLongerVisible;
			const recovered = await this._recover(command, request);
			if (recovered)
				return ConversationApprovalNotificationOutcomes.Published;
			const conversationStream = _ConversationStream(command.conversationId);
			const head = await this._history.readHead(conversationStream);
			if (head.streamName !== conversationStream || head.revision === null)
				throw new Error("Approval notification requires immutable conversation genesis");
			const intent = _Intent(command, request, head.revision);
			const result = await this._historyAuthority.appendWithAttestation(intent.command);
			if (result.outcome === ConversationHistoryAppendOutcomes.Appended)
				return ConversationApprovalNotificationOutcomes.Published;
		}
		throw new Error("Approval notification conversation history remained contended");
	}

	/** Resolve only an open request still owned and readable by its assigned participant. */
	private async _readCurrent(command: ConversationApprovalNotificationCommand): Promise<ConversationElicitation | null>
	{
		return this._requests.readCurrent(command, this._clock.now());
	}

	/** Confirm a complete private receipt and its exact participant history event after an uncertain append. */
	private async _recover(command: ConversationApprovalNotificationCommand, request: ConversationElicitation): Promise<boolean>
	{
		const receiptStream = _ReceiptStream(command.approvalId);
		let receipt: HistoryRecordedEvent | null = null;
		for await (const event of this._history.readStream({ streamName: receiptStream, fromRevision: 0n, maxCount: 1 }))
			receipt = event;
		if (receipt === null)
			return false;
		const intent = _ReadReceipt(receipt, command, request);
		const history = await this._historyReader.read({ siloId: command.siloId, conversationId: command.conversationId, fromRevision: BigInt(intent.entry.position), maxCount: 1, maximumBytes: 65_536 });
		const accepted = history.entries[0];
		if (accepted === undefined || ___DigestCanonicalJson(accepted as unknown as JsonValue) !== ___DigestCanonicalJson(intent.entry as unknown as JsonValue))
			throw new Error("Approval notification receipt omitted its conversation entry");
		return true;
	}
}

/** Build the complete receipt and participant entry at one checked conversation head. */
function _Intent(command: ConversationApprovalNotificationCommand, request: ConversationElicitation, expectedRevision: bigint)
{
	const receiptStream = _ReceiptStream(command.approvalId);
	const receiptId = _Uuid("approval-notification-receipt", command.approvalId);
	const entry: ApprovalLogEntry = { schemaVersion: 1, id: command.approvalId, conversationId: command.conversationId, position: (expectedRevision + 1n).toString(), author: { kind: ConversationAuthorKinds.System, systemId: "opencrane", name: "OpenCrane" }, provenance: "service-attested", visibility: { audience: "participant_subset", participantIds: [request.assignedParticipantId] }, runId: command.runId, causationId: command.approvalId, correlationId: command.runId, idempotencyKey: command.approvalId, occurredAt: request.requestedAt, attestation: { serviceId: "opencrane", receiptId, domainStream: receiptStream, domainRevision: "0", decisionEvidenceId: null }, kind: ConversationEntryKinds.Log, logKind: "approval", approvalId: command.approvalId, action: "Invoke tool", phase: "requested", summary: "Approval requested", detailsRef: null };
	const parsed = ___ConversationEntrySchema.parse(entry);
	const receipt: HistoryEvent = { id: receiptId, type: _RECEIPT_EVENT_TYPE, data: { bootstrapId: command.bootstrapId, approvalId: command.approvalId, intent: { streamName: _ConversationStream(command.conversationId), entry: parsed } }, metadata: { siloId: command.siloId, conversationId: command.conversationId, runId: command.runId, approvalId: command.approvalId } };
	return { command: { siloId: command.siloId, conversationId: command.conversationId, expectedRevision, entry: parsed, attestation: { streamName: receiptStream, event: receipt } }, streamName: _ConversationStream(command.conversationId), entry: parsed };
}

/** Read and validate the exact safe intent retained by the private revision-zero receipt. */
function _ReadReceipt(event: HistoryRecordedEvent, command: ConversationApprovalNotificationCommand, request: ConversationElicitation)
{
	if (event.streamName !== _ReceiptStream(command.approvalId) || event.revision !== 0n || event.type !== _RECEIPT_EVENT_TYPE)
		throw new Error("Approval notification receipt has invalid stream coordinates");
	const expectedPosition = _ReceiptPosition(event);
	const expected = _Intent(command, request, expectedPosition - 1n);
	if (!_SameEvent(event, expected.command.attestation.event))
		throw new Error("Approval notification receipt differs from its saved intent");
	return expected;
}

/** Extract the positive conversation entry position from an untrusted receipt. */
function _ReceiptPosition(event: HistoryRecordedEvent): bigint
{
	const data = event.data as { readonly intent?: { readonly entry?: { readonly position?: unknown } } };
	const position = data.intent?.entry?.position;
	if (typeof position !== "string" || !/^[1-9][0-9]*$/u.test(position))
		throw new Error("Approval notification receipt has invalid conversation position");
	return BigInt(position);
}

/** Compare only the immutable KurrentDB event envelope. */
function _SameEvent(actual: HistoryEvent, expected: HistoryEvent): boolean
{
	return ___DigestCanonicalJson({ id: actual.id, type: actual.type, data: actual.data, metadata: actual.metadata } as JsonValue) === ___DigestCanonicalJson(expected as unknown as JsonValue);
}

/** Reject malformed workflow coordinates before they name a database row or KurrentDB stream. */
function _AssertCommand(command: ConversationApprovalNotificationCommand): void
{
	if ([command.bootstrapId, command.siloId, command.conversationId, command.runId, command.approvalId].some(value => value.trim().length === 0) || !Number.isSafeInteger(command.attempt) || command.attempt < 1)
		throw new Error("Approval notification requires immutable workflow coordinates");
}

/** Name the private receipt stream for one requested approval. */
function _ReceiptStream(approvalId: string): string { return `conversation-approval-notification-${approvalId}`; }

/** Name the canonical participant conversation stream. */
function _ConversationStream(conversationId: string): string { return `conversation-${conversationId}`; }

/** Derive a stable UUID without adding a second persisted identifier. */
function _Uuid(domain: string, value: string): string
{
	const hex = createHash("sha256").update(`${domain}:${value}`).digest("hex").slice(0, 32).split("");
	hex[12] = "4";
	hex[16] = "8";
	return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}
