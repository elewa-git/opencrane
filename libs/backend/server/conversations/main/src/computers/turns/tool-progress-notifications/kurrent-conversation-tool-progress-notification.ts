import { createHash } from "node:crypto";

import { ConversationHistoryAppendOutcomes, ConversationHistoryAuthority, ConversationHistoryReader } from "@opencrane/backend/server/conversations/history";
import type { HistoryEvent, HistoryRecordedEvent, HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { ConversationAuthorKinds, ConversationEntryKinds, ___ConversationEntrySchema, type ToolCallLogEntry } from "@opencrane/contracts";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { _ConversationToolProgressNotificationPhases, ConversationToolProgressNotificationOutcomes, type _ConversationToolProgressNotificationEvidenceRead, type ConversationToolProgressNotificationEvidence, type ConversationToolRequestedNotificationCommand, type ConversationToolRequestedNotificationEvidenceReader, type ConversationToolRequestedNotificationPort, type ConversationToolRunningNotificationCommand, type ConversationToolRunningNotificationEvidenceReader, type ConversationToolRunningNotificationPort } from "./conversation-tool-progress-notification.types";
import { _ReadConversationToolResultNotificationReceipt } from "../tool-result-notifications/kurrent-conversation-tool-result-notification";

/** Maximum retries after another writer changes the conversation head. */
const _APPEND_ATTEMPTS = 4;
/** Versioned private receipt shared by requested and running participant projections. */
const _RECEIPT_EVENT_TYPE = "opencrane.conversation-tool-progress-notification.v1";

/** Publishes the proposal-admitted requested phase through checked participant history. */
export class KurrentConversationToolRequestedNotificationPublisher implements ConversationToolRequestedNotificationPort
{
	/** Rechecks the exact proposal after the history head is known. */
	private readonly _evidence: ConversationToolRequestedNotificationEvidenceReader;
	/** Shares checked append and receipt recovery with the running producer. */
	private readonly _publisher: _KurrentConversationToolProgressPublisher;

	/** Bind current proposal evidence to the existing atomic conversation-history owner. */
	public constructor(evidence: ConversationToolRequestedNotificationEvidenceReader, historyAuthority: ConversationHistoryAuthority, historyReader: ConversationHistoryReader, history: Pick<HistoryStore, "append" | "appendAtomic" | "readHead" | "readStream">)
	{
		this._evidence = evidence;
		this._publisher = new _KurrentConversationToolProgressPublisher(historyAuthority, historyReader, history);
	}

	/** Recover or append requested only after the exact proposal remains current. */
	public publishRequested(command: ConversationToolRequestedNotificationCommand): Promise<ConversationToolProgressNotificationOutcomes>
	{
		return this._publisher.publish(_ConversationToolProgressNotificationPhases.Requested, command, this._evidence.readCurrent.bind(this._evidence, command));
	}
}

/** Publishes requested then running and finishes with a fresh exact-claim recheck. */
export class KurrentConversationToolRunningNotificationPublisher implements ConversationToolRunningNotificationPort
{
	/** Rechecks the exact claim before each append and after every history operation. */
	private readonly _evidence: ConversationToolRunningNotificationEvidenceReader;
	/** Shares checked append and receipt recovery with the requested producer. */
	private readonly _publisher: _KurrentConversationToolProgressPublisher;

	/** Bind committed claim evidence to the same atomic history protocol as proposal publication. */
	public constructor(evidence: ConversationToolRunningNotificationEvidenceReader, historyAuthority: ConversationHistoryAuthority, historyReader: ConversationHistoryReader, history: Pick<HistoryStore, "append" | "appendAtomic" | "readHead" | "readStream">)
	{
		this._evidence = evidence;
		this._publisher = new _KurrentConversationToolProgressPublisher(historyAuthority, historyReader, history);
	}

	/** Ensure requested, publish running, then recheck the claim after every slow history operation. */
	public async publishRunning(command: ConversationToolRunningNotificationCommand): Promise<ConversationToolProgressNotificationOutcomes>
	{
		_AssertRunningCommand(command);
		const requested = _RequestedCommand(command);
		const read = this._evidence.readCurrent.bind(this._evidence, command);
		if (await this._publisher.publish(_ConversationToolProgressNotificationPhases.Requested, requested, read) !== ConversationToolProgressNotificationOutcomes.Published)
			return ConversationToolProgressNotificationOutcomes.NoLongerVisible;
		if (await this._publisher.publish(_ConversationToolProgressNotificationPhases.Running, requested, read) !== ConversationToolProgressNotificationOutcomes.Published)
			return ConversationToolProgressNotificationOutcomes.NoLongerVisible;
		return await this._evidence.readCurrent(command) === null
			? ConversationToolProgressNotificationOutcomes.NoLongerVisible
			: ConversationToolProgressNotificationOutcomes.Published;
	}
}

/** Owns phase ordering, receipt recovery and checked Kurrent appends without execution authority. */
class _KurrentConversationToolProgressPublisher
{
	/** Owns checked participant appends and their paired private receipt. */
	private readonly _historyAuthority: ConversationHistoryAuthority;
	/** Reads the exact participant entry retained by a recovered receipt. */
	private readonly _historyReader: ConversationHistoryReader;
	/** Reads heads and receipt streams used by the recovery protocol. */
	private readonly _history: Pick<HistoryStore, "append" | "appendAtomic" | "readHead" | "readStream">;

	/** Keep participant validation and atomic append behind the existing history owners. */
	public constructor(historyAuthority: ConversationHistoryAuthority, historyReader: ConversationHistoryReader, history: Pick<HistoryStore, "append" | "appendAtomic" | "readHead" | "readStream">)
	{
		this._historyAuthority = historyAuthority;
		this._historyReader = historyReader;
		this._history = history;
	}

	/** Recover the phase or append it only after observing the head and later receipts. */
	public async publish(phase: _ConversationToolProgressNotificationPhases, command: ConversationToolRequestedNotificationCommand, readEvidence: _ConversationToolProgressNotificationEvidenceRead): Promise<ConversationToolProgressNotificationOutcomes>
	{
		_AssertCommand(command);
		for (let attempt = 0; attempt < _APPEND_ATTEMPTS; attempt += 1)
		{
			if (await this._recoverProgress(command, phase))
				return ConversationToolProgressNotificationOutcomes.Published;
			const conversationStream = _ConversationStream(command.conversationId);
			const head = await this._history.readHead(conversationStream);
			if (head.streamName !== conversationStream || head.revision === null)
				throw new Error("Tool progress notification requires immutable conversation genesis");
			if (await this._hasLaterPhase(command, phase))
				return ConversationToolProgressNotificationOutcomes.NoLongerVisible;
			const evidence = await readEvidence();
			if (evidence === null)
				return ConversationToolProgressNotificationOutcomes.NoLongerVisible;
			_AssertEvidence(command, evidence);
			const intent = _Intent(command, evidence, phase, head.revision);
			try
			{
				const result = await this._historyAuthority.appendWithAttestation(intent.command);
				if (result.outcome === ConversationHistoryAppendOutcomes.Appended)
					return ConversationToolProgressNotificationOutcomes.Published;
			}
			catch (error)
			{
				if (await this._recoverProgress(command, phase))
					return ConversationToolProgressNotificationOutcomes.Published;
				throw error;
			}
		}
		throw new Error("Tool progress notification conversation history remained contended");
	}

	/** Confirm one complete progress receipt and its exact participant entry. */
	private async _recoverProgress(command: ConversationToolRequestedNotificationCommand, phase: _ConversationToolProgressNotificationPhases): Promise<boolean>
	{
		const receipt = await this._readReceipt(_ReceiptStream(command.toolInvocationId, phase));
		if (receipt === null)
			return false;
		const intent = _ReadProgressReceipt(receipt, command, phase);
		await this._assertConversationEntry(command, intent.entry);
		return true;
	}

	/** Suppress a fresh phase once an exact later receipt and entry are already durable. */
	private async _hasLaterPhase(command: ConversationToolRequestedNotificationCommand, phase: _ConversationToolProgressNotificationPhases): Promise<boolean>
	{
		if (phase === _ConversationToolProgressNotificationPhases.Requested && await this._recoverProgress(command, _ConversationToolProgressNotificationPhases.Running))
			return true;
		const receipt = await this._readReceipt(_TerminalReceiptStream(command.toolInvocationId));
		if (receipt === null)
			return false;
		const entry = _ReadTerminalReceipt(receipt, command);
		await this._assertConversationEntry(command, entry);
		return true;
	}

	/** Read only revision zero; additional receipt events are an integrity failure. */
	private async _readReceipt(streamName: string): Promise<HistoryRecordedEvent | null>
	{
		let receipt: HistoryRecordedEvent | null = null;
		for await (const event of this._history.readStream({ streamName, fromRevision: 0n, maxCount: 2 }))
		{
			if (receipt !== null)
				throw new Error("Tool notification receipt stream contains multiple events");
			receipt = event;
		}
		return receipt;
	}

	/** Validate the participant entry at the exact position retained by a private receipt. */
	private async _assertConversationEntry(command: ConversationToolRequestedNotificationCommand, entry: ToolCallLogEntry): Promise<void>
	{
		const history = await this._historyReader.read({ siloId: command.siloId, conversationId: command.conversationId, fromRevision: BigInt(entry.position), maxCount: 1, maximumBytes: 65_536 });
		const accepted = history.entries[0];
		if (accepted === undefined || ___DigestCanonicalJson(accepted as unknown as JsonValue) !== ___DigestCanonicalJson(entry as unknown as JsonValue))
			throw new Error("Tool notification receipt omitted its conversation entry");
	}
}

/** Build one deterministic receipt and its content-free participant projection. */
function _Intent(command: ConversationToolRequestedNotificationCommand, evidence: ConversationToolProgressNotificationEvidence, phase: _ConversationToolProgressNotificationPhases, expectedRevision: bigint)
{
	const receiptStream = _ReceiptStream(command.toolInvocationId, phase);
	const receiptId = _Uuid(`tool-progress-${phase}-receipt`, command.toolInvocationId);
	const entryId = _Uuid(`tool-progress-${phase}-entry`, command.toolInvocationId);
	const summary = phase === _ConversationToolProgressNotificationPhases.Requested ? "Tool requested" : "Tool running";
	const entry: ToolCallLogEntry = { schemaVersion: 1, id: entryId, conversationId: command.conversationId, position: (expectedRevision + 1n).toString(), author: { kind: ConversationAuthorKinds.System, systemId: "opencrane", name: "OpenCrane" }, provenance: "service-attested", visibility: { audience: "conversation" }, runId: command.runId, causationId: command.toolInvocationId, correlationId: command.runId, idempotencyKey: entryId, occurredAt: evidence.occurredAt, attestation: { serviceId: "opencrane", receiptId, domainStream: receiptStream, domainRevision: "0", decisionEvidenceId: null }, kind: ConversationEntryKinds.Log, logKind: "tool_call", toolCallId: command.toolInvocationId, toolKind: evidence.toolKind, toolName: evidence.toolName, phase, resultArtifactRevisionId: null, summary, detailsRef: null };
	const parsed = ___ConversationEntrySchema.parse(entry) as ToolCallLogEntry;
	const data = { bootstrapId: command.bootstrapId, siloId: command.siloId, conversationId: command.conversationId, runId: command.runId, attempt: command.attempt, toolInvocationId: command.toolInvocationId, phase, intent: { streamName: _ConversationStream(command.conversationId), entry: parsed } };
	const metadata = { siloId: command.siloId, conversationId: command.conversationId, runId: command.runId, toolInvocationId: command.toolInvocationId, phase };
	const receipt: HistoryEvent = { id: receiptId, type: _RECEIPT_EVENT_TYPE, data, metadata };
	return { command: { siloId: command.siloId, conversationId: command.conversationId, expectedRevision, entry: parsed, attestation: { streamName: receiptStream, event: receipt } }, entry: parsed };
}

/** Validate and reconstruct one exact requested or running receipt. */
function _ReadProgressReceipt(event: HistoryRecordedEvent, command: ConversationToolRequestedNotificationCommand, phase: _ConversationToolProgressNotificationPhases)
{
	if (event.streamName !== _ReceiptStream(command.toolInvocationId, phase) || event.revision !== 0n || event.type !== _RECEIPT_EVENT_TYPE)
		throw new Error("Tool progress notification receipt has invalid stream coordinates");
	const data = event.data as { readonly bootstrapId?: unknown; readonly siloId?: unknown; readonly conversationId?: unknown; readonly runId?: unknown; readonly attempt?: unknown; readonly toolInvocationId?: unknown; readonly phase?: unknown; readonly intent?: { readonly entry?: unknown } };
	if (data.bootstrapId !== command.bootstrapId || data.siloId !== command.siloId || data.conversationId !== command.conversationId
		|| data.runId !== command.runId || data.attempt !== command.attempt || data.toolInvocationId !== command.toolInvocationId || data.phase !== phase)
		throw new Error("Tool progress notification receipt differs from its invocation");
	const parsed = ___ConversationEntrySchema.safeParse(data.intent?.entry);
	if (!parsed.success || parsed.data.kind !== ConversationEntryKinds.Log || parsed.data.logKind !== "tool_call" || parsed.data.phase !== phase)
		throw new Error("Tool progress notification receipt has invalid participant evidence");
	const entry = parsed.data;
	const position = entry.position;
	if (!/^[1-9][0-9]*$/u.test(position))
		throw new Error("Tool progress notification receipt has invalid conversation position");
	const evidence = { ...command, toolName: entry.toolName, toolKind: entry.toolKind, occurredAt: entry.occurredAt };
	const expected = _Intent(command, evidence, phase, BigInt(position) - 1n);
	if (!_SameEvent(event, expected.command.attestation.event))
		throw new Error("Tool progress notification receipt differs from its saved intent");
	return expected;
}

/** Validate the existing terminal receipt before using it to suppress an earlier phase. */
function _ReadTerminalReceipt(event: HistoryRecordedEvent, command: ConversationToolRequestedNotificationCommand): ToolCallLogEntry
{
	const data = event.data as { readonly resultDigest?: unknown };
	if (typeof data.resultDigest !== "string")
		throw new Error("Tool terminal notification receipt has invalid result evidence");
	const intent = _ReadConversationToolResultNotificationReceipt(event, { ...command, expectedResultDigest: data.resultDigest });
	const entry = intent.entry;
	if (entry.kind !== ConversationEntryKinds.Log || entry.logKind !== "tool_call")
		throw new Error("Tool terminal notification receipt has invalid participant evidence");
	return entry;
}

/** Reject substituted safe evidence before it can enter either history stream. */
function _AssertEvidence(command: ConversationToolRequestedNotificationCommand, evidence: ConversationToolProgressNotificationEvidence): void
{
	if (evidence.bootstrapId !== command.bootstrapId || evidence.siloId !== command.siloId || evidence.conversationId !== command.conversationId
		|| evidence.runId !== command.runId || evidence.attempt !== command.attempt || evidence.toolInvocationId !== command.toolInvocationId
		|| evidence.toolKind !== "mcp" || evidence.toolName.trim().length === 0 || evidence.toolName !== evidence.toolName.trim()
		|| !Number.isFinite(Date.parse(evidence.occurredAt)) || new Date(evidence.occurredAt).toISOString() !== evidence.occurredAt)
		throw new Error("Tool progress notification evidence is invalid");
}

/** Reject malformed workflow coordinates before they name a receipt or history stream. */
function _AssertCommand(command: ConversationToolRequestedNotificationCommand): void
{
	if ([command.bootstrapId, command.siloId, command.conversationId, command.runId, command.toolInvocationId].some(value => value.trim().length === 0 || value !== value.trim())
		|| !Number.isSafeInteger(command.attempt) || command.attempt < 1)
		throw new Error("Tool progress notification requires immutable workflow coordinates");
}

/** Reject a substituted private claim envelope before using any of its coordinates. */
function _AssertRunningCommand(command: ConversationToolRunningNotificationCommand): void
{
	_AssertCommand(_RequestedCommand(command));
	const identifiers = [command.executionId, command.companionClaimFence, command.invocationId, command.requestIdentity.runtimeInstanceId, command.requestIdentity.commandId, command.requestIdentity.candidateId, command.toolClaim.invocationId, command.workload.podUid, command.workload.workloadUid];
	if (identifiers.some(value => value.trim().length === 0 || value !== value.trim()) || command.toolClaim.invocationId !== command.invocationId
		|| !Number.isSafeInteger(command.toolClaim.fence) || command.toolClaim.fence < 1 || !Number.isSafeInteger(command.toolClaim.revision) || command.toolClaim.revision < 1)
		throw new Error("Tool running notification requires exact committed claim coordinates");
}

/** Project only the stable requested coordinates shared by both producers. */
function _RequestedCommand(command: ConversationToolRunningNotificationCommand): ConversationToolRequestedNotificationCommand
{
	return { bootstrapId: command.requestIdentity.commandId, siloId: command.siloId, conversationId: command.conversationId, runId: command.runId, attempt: command.attempt, toolInvocationId: command.toolInvocationId };
}

/** Compare every immutable field of one private Kurrent event envelope. */
function _SameEvent(actual: HistoryEvent, expected: HistoryEvent): boolean
{
	return ___DigestCanonicalJson({ id: actual.id, type: actual.type, data: actual.data, metadata: actual.metadata } as JsonValue) === ___DigestCanonicalJson(expected as unknown as JsonValue);
}

/** Name one immutable requested or running receipt stream. */
function _ReceiptStream(toolInvocationId: string, phase: _ConversationToolProgressNotificationPhases): string { return `conversation-tool-progress-${phase}-${toolInvocationId}`; }
/** Name the existing immutable terminal receipt stream for the public invocation. */
function _TerminalReceiptStream(toolInvocationId: string): string { return `conversation-tool-result-notification-${toolInvocationId}`; }
/** Name the participant history stream that receives the safe projection. */
function _ConversationStream(conversationId: string): string { return `conversation-${conversationId}`; }

/** Derive stable receipt and participant UUIDs without another persisted identifier. */
function _Uuid(domain: string, value: string): string
{
	const hex = createHash("sha256").update(`${domain}:${value}`).digest("hex").slice(0, 32).split("");
	hex[12] = "4";
	hex[16] = "8";
	return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}
