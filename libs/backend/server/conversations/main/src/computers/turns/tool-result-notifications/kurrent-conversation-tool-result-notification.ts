import { createHash } from "node:crypto";

import { ConversationHistoryAppendOutcomes, ConversationHistoryAuthority, ConversationHistoryReader } from "@opencrane/backend/server/conversations/history";
import { type HistoryEvent, type HistoryRecordedEvent, type HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { ConversationAuthorKinds, ConversationEntryKinds, ___ConversationEntrySchema, type ToolCallLogEntry } from "@opencrane/contracts";
import { ToolResultDeliveryOutcomes } from "@opencrane/backend/server/iam/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { ConversationToolResultNotificationOutcomes, type ConversationToolResultNotificationCommand, type ConversationToolResultNotificationEvidence, type ConversationToolResultNotificationEvidenceReader, type ConversationToolResultNotificationPort } from "./conversation-tool-result-notification.types";

/** Maximum checked conversation-head retries before the turn retries its complete advance. */
const _APPEND_ATTEMPTS = 4;
/** Versioned private receipt that binds a participant log to one exact terminal delivery. */
const _RECEIPT_EVENT_TYPE = "opencrane.conversation-tool-result-notification.v1";
/** Recognizes the canonical digest carried by the private result owner. */
const _DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

/** Publishes one content-free terminal tool fact through the existing atomic history boundary. */
export class KurrentConversationToolResultNotificationPublisher implements ConversationToolResultNotificationPort
{
	/** Participant history validator and atomic append owner. */
	private readonly _historyAuthority: ConversationHistoryAuthority;
	/** Validates the exact participant entry before receipt recovery succeeds. */
	private readonly _historyReader: ConversationHistoryReader;

	/** Bind current result authority and existing KurrentDB history without owning either lifecycle. */
	public constructor(private readonly _evidence: ConversationToolResultNotificationEvidenceReader, historyAuthority: ConversationHistoryAuthority, historyReader: ConversationHistoryReader, private readonly _history: Pick<HistoryStore, "append" | "appendAtomic" | "readHead" | "readStream">)
	{
		this._historyAuthority = historyAuthority;
		this._historyReader = historyReader;
	}

	/** Recover the committed fact or append it after a fresh current-authority check. */
	public async publishTerminal(command: ConversationToolResultNotificationCommand): Promise<ConversationToolResultNotificationOutcomes>
	{
		_AssertCommand(command);
		for (let attempt = 0; attempt < _APPEND_ATTEMPTS; attempt += 1)
		{
			if (await this._recover(command))
				return ConversationToolResultNotificationOutcomes.Published;
			const evidence = await this._evidence.readCurrent(command);
			if (evidence === null)
				return ConversationToolResultNotificationOutcomes.NoLongerVisible;
			_AssertEvidence(command, evidence);
			const conversationStream = _ConversationStream(command.conversationId);
			const head = await this._history.readHead(conversationStream);
			if (head.streamName !== conversationStream || head.revision === null)
				throw new Error("Tool result notification requires immutable conversation genesis");
			const intent = _Intent(command, evidence, head.revision);
			const result = await this._historyAuthority.appendWithAttestation(intent.command);
			if (result.outcome === ConversationHistoryAppendOutcomes.Appended)
				return ConversationToolResultNotificationOutcomes.Published;
		}
		throw new Error("Tool result notification conversation history remained contended");
	}

	/** Confirm a complete private receipt and its exact participant entry after an uncertain append. */
	private async _recover(command: ConversationToolResultNotificationCommand): Promise<boolean>
	{
		const receiptStream = _ReceiptStream(command.toolInvocationId);
		let receipt: HistoryRecordedEvent | null = null;
		for await (const event of this._history.readStream({ streamName: receiptStream, fromRevision: 0n, maxCount: 1 }))
			receipt = event;
		if (receipt === null)
			return false;
		const intent = _ReadReceipt(receipt, command);
		const history = await this._historyReader.read({ siloId: command.siloId, conversationId: command.conversationId, fromRevision: BigInt(intent.entry.position), maxCount: 1, maximumBytes: 65_536 });
		const accepted = history.entries[0];
		if (accepted === undefined || ___DigestCanonicalJson(accepted as unknown as JsonValue) !== ___DigestCanonicalJson(intent.entry as unknown as JsonValue))
			throw new Error("Tool result notification receipt omitted its conversation entry");
		return true;
	}
}

/** Reject substituted safe evidence before it can enter either history stream. */
function _AssertEvidence(command: ConversationToolResultNotificationCommand, evidence: ConversationToolResultNotificationEvidence): void
{
	if (evidence.resultDigest !== command.expectedResultDigest || evidence.outcome !== ToolResultDeliveryOutcomes.Succeeded && evidence.outcome !== ToolResultDeliveryOutcomes.Failed
		|| evidence.toolKind !== "mcp" || evidence.toolName.trim().length === 0 || evidence.toolName !== evidence.toolName.trim()
		|| !Number.isFinite(Date.parse(evidence.occurredAt)) || new Date(evidence.occurredAt).toISOString() !== evidence.occurredAt)
		throw new Error("Tool result notification evidence is invalid");
}

/** Build the private receipt and its minimal participant-visible projection. */
function _Intent(command: ConversationToolResultNotificationCommand, evidence: ConversationToolResultNotificationEvidence, expectedRevision: bigint)
{
	const receiptStream = _ReceiptStream(command.toolInvocationId);
	const receiptId = _Uuid("tool-result-notification-receipt", command.toolInvocationId);
	const entryId = _Uuid("tool-result-notification-entry", command.toolInvocationId);
	const completed = evidence.outcome === ToolResultDeliveryOutcomes.Succeeded;
	const phase = completed ? "completed" : "failed";
	const summary = completed ? "Tool completed" : "Tool failed";
	const entry: ToolCallLogEntry = { schemaVersion: 1, id: entryId, conversationId: command.conversationId, position: (expectedRevision + 1n).toString(), author: { kind: ConversationAuthorKinds.System, systemId: "opencrane", name: "OpenCrane" }, provenance: "service-attested", visibility: { audience: "conversation" }, runId: command.runId, causationId: command.toolInvocationId, correlationId: command.runId, idempotencyKey: entryId, occurredAt: evidence.occurredAt, attestation: { serviceId: "opencrane", receiptId, domainStream: receiptStream, domainRevision: "0", decisionEvidenceId: null }, kind: ConversationEntryKinds.Log, logKind: "tool_call", toolCallId: command.toolInvocationId, toolKind: evidence.toolKind, toolName: evidence.toolName, phase, resultArtifactRevisionId: null, summary, detailsRef: null };
	const parsed = ___ConversationEntrySchema.parse(entry);
	const data = { bootstrapId: command.bootstrapId, runId: command.runId, attempt: command.attempt, toolInvocationId: command.toolInvocationId, resultDigest: evidence.resultDigest, outcome: evidence.outcome, intent: { streamName: _ConversationStream(command.conversationId), entry: parsed } };
	const metadata = { siloId: command.siloId, conversationId: command.conversationId, runId: command.runId, toolInvocationId: command.toolInvocationId };
	const receipt: HistoryEvent = { id: receiptId, type: _RECEIPT_EVENT_TYPE, data, metadata };
	return { command: { siloId: command.siloId, conversationId: command.conversationId, expectedRevision, entry: parsed, attestation: { streamName: receiptStream, event: receipt } }, entry: parsed };
}

/** Read and validate the exact safe intent retained by the private revision-zero receipt. */
function _ReadReceipt(event: HistoryRecordedEvent, command: ConversationToolResultNotificationCommand)
{
	if (event.streamName !== _ReceiptStream(command.toolInvocationId) || event.revision !== 0n || event.type !== _RECEIPT_EVENT_TYPE)
		throw new Error("Tool result notification receipt has invalid stream coordinates");
	const data = event.data as { readonly bootstrapId?: unknown; readonly runId?: unknown; readonly attempt?: unknown; readonly toolInvocationId?: unknown; readonly resultDigest?: unknown; readonly outcome?: unknown; readonly intent?: { readonly entry?: { readonly position?: unknown } } };
	if (data.bootstrapId !== command.bootstrapId || data.runId !== command.runId || data.attempt !== command.attempt || data.toolInvocationId !== command.toolInvocationId || data.resultDigest !== command.expectedResultDigest || data.outcome !== ToolResultDeliveryOutcomes.Succeeded && data.outcome !== ToolResultDeliveryOutcomes.Failed)
		throw new Error("Tool result notification receipt differs from its invocation");
	const position = data.intent?.entry?.position;
	if (typeof position !== "string" || !/^[1-9][0-9]*$/u.test(position))
		throw new Error("Tool result notification receipt has invalid conversation position");
	const parsed = ___ConversationEntrySchema.safeParse(data.intent?.entry);
	if (!parsed.success || parsed.data.kind !== ConversationEntryKinds.Log || parsed.data.logKind !== "tool_call")
		throw new Error("Tool result notification receipt has invalid participant evidence");
	const entry = parsed.data;
	const evidence: ConversationToolResultNotificationEvidence = { toolName: entry.toolName, toolKind: entry.toolKind, outcome: data.outcome, resultDigest: data.resultDigest, occurredAt: entry.occurredAt };
	const expected = _Intent(command, evidence, BigInt(position) - 1n);
	if (!_SameEvent(event, expected.command.attestation.event))
		throw new Error("Tool result notification receipt differs from its saved intent");
	return expected;
}

/** Compare every immutable field of one KurrentDB event envelope. */
function _SameEvent(actual: HistoryEvent, expected: HistoryEvent): boolean
{
	return ___DigestCanonicalJson({ id: actual.id, type: actual.type, data: actual.data, metadata: actual.metadata } as JsonValue) === ___DigestCanonicalJson(expected as unknown as JsonValue);
}

/** Reject malformed workflow coordinates before they name a result or history stream. */
function _AssertCommand(command: ConversationToolResultNotificationCommand): void
{
	const identifiers = [command.bootstrapId, command.siloId, command.conversationId, command.runId, command.toolInvocationId];
	if (identifiers.some(value => value.trim().length === 0 || value !== value.trim()) || !Number.isSafeInteger(command.attempt) || command.attempt < 1 || !_DIGEST_PATTERN.test(command.expectedResultDigest))
		throw new Error("Tool result notification requires immutable workflow coordinates");
}

/** Name the private receipt stream for one tool invocation. */
function _ReceiptStream(toolInvocationId: string): string { return `conversation-tool-result-notification-${toolInvocationId}`; }

/** Name the canonical participant conversation stream. */
function _ConversationStream(conversationId: string): string { return `conversation-${conversationId}`; }

/** Derive a stable UUID without adding another persisted identifier. */
function _Uuid(domain: string, value: string): string
{
	const hex = createHash("sha256").update(`${domain}:${value}`).digest("hex").slice(0, 32).split("");
	hex[12] = "4";
	hex[16] = "8";
	return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}
