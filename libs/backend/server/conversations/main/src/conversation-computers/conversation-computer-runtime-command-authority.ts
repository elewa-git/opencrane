import { randomUUID } from "node:crypto";

import { CONVERSATION_COMPUTER_RUNTIME_PROTOCOL_VERSION, ConversationComputerRuntimeCommandKinds, ConversationComputerRuntimeTerminalStates, type ConversationComputerRuntimeCommandEnvelope, type ConversationComputerRuntimeTerminalReport } from "@opencrane/contracts";
import { HistoryExpectedRevisions, type HistoryRecordedEvent } from "@opencrane/backend/server/infra/history-store";

import type { ActiveConversationComputerExecution } from "./conversation-computer-history.types";
import type { ConversationComputerRuntimeCommandAuthorityDependencies, ConversationComputerRuntimeCommandCompleteCommand, ConversationComputerRuntimeCommandCurrentCommand, ConversationComputerRuntimeCommandIssueResult, ConversationComputerRuntimeCommandPollResult, ConversationComputerRuntimeCommandPollCommand, ConversationComputerRuntimeStartTurnIssueCommand } from "./conversation-computer-runtime-command-authority.types";

/** Limits a command delivery to a short server-owned interval after its durable issue. */
const _COMMAND_TTL_MILLISECONDS = 300_000;
/** Names the immutable stream event that records a server-issued target runtime command. */
const _COMMAND_ISSUED_EVENT_TYPE = "opencrane.conversation-computer-runtime-command-issued.v1";
/** Names the immutable stream event that records a terminal result for one target command. */
const _COMMAND_COMPLETED_EVENT_TYPE = "opencrane.conversation-computer-runtime-command-completed.v1";
/** Recognizes UUID event identifiers used for command idempotency and completion records. */
const _UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
/** Recognizes opaque protected payload references without accepting a path or network address. */
const _PAYLOAD_REFERENCE_PATTERN = /^payload:\/\/[A-Za-z0-9][A-Za-z0-9._-]*$/u;
/** Recognizes the fixed digest format used to bind protected payload references. */
const _DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;

/**
 * Stores ordered target runtime commands separately from the computer lifecycle stream.
 *
 * The authority rechecks the active execution before every operation and atomically fences command
 * writes against that computer head. The Sandbox cannot supply a cursor: polling returns only the
 * oldest incomplete command, while completion cannot skip an earlier one. Command state therefore
 * survives process replacement without turning Agent Sandbox into the loop or lifecycle authority.
 *
 * Called by: the future ConversationComputer runtime router and durable input-command worker.
 * @see ConversationComputerHistory for the server-owned active execution fence.
 */
export class ConversationComputerRuntimeCommandAuthority
{
	/** Connects target command storage to active computer history and the server clock. */
	public constructor(private readonly dependencies: ConversationComputerRuntimeCommandAuthorityDependencies) {}

	/**
	 * Issues or replays one start-turn command for a server-admitted participant input entry.
	 *
	 * @param command - Supplies trusted input coordinates and its protected payload reference.
	 * @returns The durable command whose input entry owns the command idempotency key.
	 * @throws {Error} Rejects malformed input, inactive executions, or a concurrent nonmatching queue write.
	 */
	public async issueStartTurn(command: ConversationComputerRuntimeStartTurnIssueCommand): Promise<ConversationComputerRuntimeCommandIssueResult>
	{
		_ValidateStartTurnIssue(command);
		const active = await this._LoadActive(command);
		const state = await this._ReadState(active);
		const existing = state.commands.find(candidate => candidate.commandId === command.inputEntryId);
		if (existing !== undefined)
		{
			_AssertMatchingStartTurn(existing, command);
			return { command: existing };
		}
		const now = _Now(this.dependencies.clock.now());
		const queued = _StartTurn(command, active, state.commands.length + 1, now);
		try
		{
			await this.dependencies.history.appendAtomic({
				expectedHeads: [
					{ streamName: active.streamName, revision: active.revision },
					{ streamName: state.streamName, revision: state.revision },
				],
				appends: [{
					streamName: state.streamName,
					expectedRevision: state.revision,
					events: [{
						id: queued.commandId,
						type: _COMMAND_ISSUED_EVENT_TYPE,
						data: { command: queued },
						metadata: _Metadata(queued),
					}],
				}],
			});
			return { command: queued };
		}
		catch (error: unknown)
		{
			const reloaded = await this._ReadState(await this._LoadActive(command));
			const winner = reloaded.commands.find(candidate => candidate.commandId === command.inputEntryId);
			if (winner !== undefined)
			{
				_AssertMatchingStartTurn(winner, command);
				return { command: winner };
			}
			throw error;
		}
	}

	/**
	 * Returns the oldest uncompleted command for one currently active execution.
	 *
	 * @param command - Supplies trusted current computer coordinates; it carries no cursor or sequence.
	 * @returns The oldest command still awaiting a terminal report, or null when the queue is empty.
	 * @throws {Error} Rejects an expired head command rather than letting a later command bypass it.
	 */
	public async poll(command: ConversationComputerRuntimeCommandPollCommand): Promise<ConversationComputerRuntimeCommandPollResult>
	{
		_ValidateCurrent(command);
		const active = await this._LoadActive(command);
		const state = await this._ReadState(active);
		const rechecked = await this._LoadActive(command);
		if (rechecked.streamName !== active.streamName || rechecked.revision !== active.revision || rechecked.execution.id !== active.execution.id || rechecked.lease.generation !== active.lease.generation)
			throw new Error("Conversation computer runtime command poll changed while loading its active execution");
		const next = state.commands.find(candidate => !state.completed.has(candidate.commandId));
		if (next === undefined)
			return { command: null };
		if (Date.parse(next.expiresAt) <= _Now(this.dependencies.clock.now()).getTime())
			throw new Error("Conversation computer runtime command expired before runtime delivery");
		return { command: next };
	}

	/**
	 * Completes the exact oldest command only after its current execution fence still holds.
	 *
	 * @param command - Supplies a runtime report that the router authenticated and lease-fenced separately.
	 * @throws {Error} Rejects foreign, duplicate, skipped, stale, or unknown command reports.
	 */
	public async complete(command: ConversationComputerRuntimeCommandCompleteCommand): Promise<void>
	{
		_ValidateCurrent(command);
		const active = await this._LoadActive(command);
		const state = await this._ReadState(active);
		_AssertMatchingReport(command.report, active);
		if (state.completed.has(command.report.commandId))
			return;
		const next = state.commands.find(candidate => !state.completed.has(candidate.commandId));
		if (next === undefined || next.commandId !== command.report.commandId)
			throw new Error("Conversation computer runtime command completion must acknowledge the oldest pending command");
		await this.dependencies.history.appendAtomic({
			expectedHeads: [
				{ streamName: active.streamName, revision: active.revision },
				{ streamName: state.streamName, revision: state.revision },
			],
			appends: [{
				streamName: state.streamName,
				expectedRevision: state.revision,
				events: [{
					id: randomUUID(),
					type: _COMMAND_COMPLETED_EVENT_TYPE,
					data: { report: command.report },
					metadata: _Metadata(command.report),
				}],
			}],
		});
	}

	/** Loads the current active execution while keeping identity and profile selection inside history. */
	private async _LoadActive(command: ConversationComputerRuntimeCommandCurrentCommand): Promise<ActiveConversationComputerExecution>
	{
		return this.dependencies.computers.loadActiveExecutionForServer({ ...command, nowEpochMilliseconds: _Now(this.dependencies.clock.now()).getTime() });
	}

	/** Replays one execution-scoped command stream and verifies its head before a later append. */
	private async _ReadState(active: ActiveConversationComputerExecution): Promise<_CommandState>
	{
		const streamName = _StreamName(active);
		const commands: ConversationComputerRuntimeCommandEnvelope[] = [];
		const completed = new Set<string>();
		let expectedRevision = 0n;
		for await (const event of this.dependencies.history.readStream({ streamName }))
		{
			if (event.streamName !== streamName || event.revision !== expectedRevision)
				throw new Error("Conversation computer runtime command history is noncontiguous");
			if (event.type === _COMMAND_ISSUED_EVENT_TYPE)
			{
				const queued = _ReadQueued(event, active);
				if (queued.sequence !== commands.length + 1 || commands.some(candidate => candidate.commandId === queued.commandId))
					throw new Error("Conversation computer runtime command history has an invalid command sequence");
				commands.push(queued);
			}
			else if (event.type === _COMMAND_COMPLETED_EVENT_TYPE)
			{
				const report = _ReadCompletion(event, active);
				const completedIndex = commands.findIndex(candidate => candidate.commandId === report.commandId);
				if (completedIndex < 0 || completed.has(report.commandId) || commands.slice(0, completedIndex).some(candidate => !completed.has(candidate.commandId)))
					throw new Error("Conversation computer runtime command history has an invalid completion");
				completed.add(report.commandId);
			}
			else
				throw new Error("Conversation computer runtime command history has an unsupported event");
			expectedRevision += 1n;
		}
		const head = await this.dependencies.history.readHead(streamName);
		const revision = expectedRevision === 0n ? HistoryExpectedRevisions.NoStream : expectedRevision - 1n;
		if (head.streamName !== streamName || head.revision !== (revision === HistoryExpectedRevisions.NoStream ? null : revision))
			throw new Error("Conversation computer runtime command history changed while loading");
		return { streamName, revision, commands, completed };
	}
}

/** Holds the checked command stream head and the queue state reconstructed from its immutable events. */
interface _CommandState
{
	/** Names the execution-scoped command stream that supplied this state. */
	readonly streamName: string;
	/** Requires the stream head checked during replay, or a missing stream for its first command. */
	readonly revision: HistoryExpectedRevisions.NoStream | bigint;
	/** Lists every server-issued command in immutable sequence order. */
	readonly commands: readonly ConversationComputerRuntimeCommandEnvelope[];
	/** Identifies the commands that already received one terminal runtime report. */
	readonly completed: ReadonlySet<string>;
}

/** Builds the deterministic command stream for one server-created execution, never a reusable computer lifetime. */
function _StreamName(active: ActiveConversationComputerExecution): string
{
	return `conversation-computer-runtime-${active.computer.id}-${active.execution.id}`;
}

/** Builds one server-issued start command from a checked active execution and protected input reference. */
function _StartTurn(command: ConversationComputerRuntimeStartTurnIssueCommand, active: ActiveConversationComputerExecution, sequence: number, now: Date): ConversationComputerRuntimeCommandEnvelope
{
	return {
		protocolVersion: CONVERSATION_COMPUTER_RUNTIME_PROTOCOL_VERSION,
		commandId: command.inputEntryId,
		sequence,
		computerId: active.computer.id,
		executionId: active.execution.id,
		leaseGeneration: active.lease.generation,
		issuedAt: now.toISOString(),
		expiresAt: new Date(now.getTime() + _COMMAND_TTL_MILLISECONDS).toISOString(),
		kind: ConversationComputerRuntimeCommandKinds.StartTurn,
		payload: {
			inputEntryId: command.inputEntryId,
			inputPayloadRef: command.inputPayloadRef,
			inputPayloadDigest: command.inputPayloadDigest,
		},
	};
}

/** Builds metadata that independently fences every durable command event to its active execution. */
function _Metadata(value: ConversationComputerRuntimeCommandEnvelope | ConversationComputerRuntimeTerminalReport): Record<string, unknown>
{
	return {
		computerId: value.computerId,
		executionId: value.executionId,
		leaseGeneration: value.leaseGeneration,
		commandId: value.commandId,
	};
}

/** Parses a command event only when its complete envelope and metadata match the checked execution. */
function _ReadQueued(event: HistoryRecordedEvent, active: ActiveConversationComputerExecution): ConversationComputerRuntimeCommandEnvelope
{
	if (!_Record(event.data) || !_ExactKeys(event.data, ["command"]) || !_Envelope(event.data.command) || !_MatchesMetadata(event.metadata, event.data.command) || !_MatchesActive(event.data.command, active) || event.id !== event.data.command.commandId)
		throw new Error("Conversation computer runtime command history has an invalid issued command");
	return event.data.command;
}

/** Parses a completion event only when its bounded report and metadata match the checked execution. */
function _ReadCompletion(event: HistoryRecordedEvent, active: ActiveConversationComputerExecution): ConversationComputerRuntimeTerminalReport
{
	if (!_Record(event.data) || !_ExactKeys(event.data, ["report"]) || !_TerminalReport(event.data.report) || !_MatchesMetadata(event.metadata, event.data.report) || !_MatchesActive(event.data.report, active) || !_UUID_PATTERN.test(event.id))
		throw new Error("Conversation computer runtime command history has an invalid completion report");
	return event.data.report;
}

/** Checks that one issued command remains fenced to the exact active computer execution. */
function _MatchesActive(value: ConversationComputerRuntimeCommandEnvelope | ConversationComputerRuntimeTerminalReport, active: ActiveConversationComputerExecution): boolean
{
	return value.computerId === active.computer.id && value.executionId === active.execution.id && value.leaseGeneration === active.lease.generation;
}

/** Checks the duplicated envelope metadata that makes cross-stream corruption fail closed. */
function _MatchesMetadata(value: Record<string, unknown>, command: ConversationComputerRuntimeCommandEnvelope | ConversationComputerRuntimeTerminalReport): boolean
{
	return _ExactKeys(value, ["computerId", "executionId", "leaseGeneration", "commandId"])
		&& value.computerId === command.computerId
		&& value.executionId === command.executionId
		&& value.leaseGeneration === command.leaseGeneration
		&& value.commandId === command.commandId;
}

/** Checks a complete target command envelope before it may become durable queue state. */
function _Envelope(value: unknown): value is ConversationComputerRuntimeCommandEnvelope
{
	if (!_Record(value) || !_ExactKeys(value, ["protocolVersion", "commandId", "sequence", "computerId", "executionId", "leaseGeneration", "issuedAt", "expiresAt", "kind", "payload"]) || value.protocolVersion !== CONVERSATION_COMPUTER_RUNTIME_PROTOCOL_VERSION || !_Uuid(value.commandId) || !_PositiveInteger(value.sequence) || !_Identifier(value.computerId) || !_Identifier(value.executionId) || !_PositiveInteger(value.leaseGeneration) || !_Timestamp(value.issuedAt) || !_Timestamp(value.expiresAt) || value.kind !== ConversationComputerRuntimeCommandKinds.StartTurn || !_StartTurnPayload(value.payload))
		return false;
	return value.payload.inputEntryId === value.commandId;
}

/** Checks a complete terminal report before it may complete one durable command. */
function _TerminalReport(value: unknown): value is ConversationComputerRuntimeTerminalReport
{
	return _Record(value)
		&& _ExactKeys(value, ["protocolVersion", "commandId", "computerId", "executionId", "leaseGeneration", "state"])
		&& value.protocolVersion === CONVERSATION_COMPUTER_RUNTIME_PROTOCOL_VERSION
		&& _Uuid(value.commandId)
		&& _Identifier(value.computerId)
		&& _Identifier(value.executionId)
		&& _PositiveInteger(value.leaseGeneration)
		&& Object.values(ConversationComputerRuntimeTerminalStates).includes(value.state as ConversationComputerRuntimeTerminalStates);
}

/** Checks the protected-input fields the initial target command may carry. */
function _StartTurnPayload(value: unknown): value is { readonly inputEntryId: string; readonly inputPayloadRef: string; readonly inputPayloadDigest: `sha256:${string}` }
{
	return _Record(value)
		&& _ExactKeys(value, ["inputEntryId", "inputPayloadRef", "inputPayloadDigest"])
		&& _Uuid(value.inputEntryId)
		&& _PayloadReference(value.inputPayloadRef)
		&& _Digest(value.inputPayloadDigest);
}

/** Rejects a changed retry so one participant input cannot silently replace its previously issued command. */
function _AssertMatchingStartTurn(existing: ConversationComputerRuntimeCommandEnvelope, command: ConversationComputerRuntimeStartTurnIssueCommand): void
{
	if (existing.kind !== ConversationComputerRuntimeCommandKinds.StartTurn || existing.payload.inputEntryId !== command.inputEntryId || existing.payload.inputPayloadRef !== command.inputPayloadRef || existing.payload.inputPayloadDigest !== command.inputPayloadDigest)
		throw new Error("Conversation computer runtime command input entry already owns a different command");
}

/** Rejects a completion report whose runtime coordinates differ from the exact active execution. */
function _AssertMatchingReport(report: ConversationComputerRuntimeTerminalReport, active: ActiveConversationComputerExecution): void
{
	if (!_TerminalReport(report) || !_MatchesActive(report, active))
		throw new Error("Conversation computer runtime command completion has foreign execution coordinates");
}

/** Validates one trusted server input before it can name a durable command or protected reference. */
function _ValidateStartTurnIssue(command: ConversationComputerRuntimeStartTurnIssueCommand): void
{
	_ValidateCurrent(command);
	if (!_Uuid(command.inputEntryId))
		throw new Error("Conversation computer runtime command issue has an invalid input entry identifier");
	if (!_PayloadReference(command.inputPayloadRef))
		throw new Error("Conversation computer runtime command issue has an invalid input payload reference");
	if (!_Digest(command.inputPayloadDigest))
		throw new Error("Conversation computer runtime command issue has an invalid input payload digest");
}

/** Validates the non-normalized server-owned coordinates that select one active computer execution. */
function _ValidateCurrent(command: ConversationComputerRuntimeCommandCurrentCommand): void
{
	if (!_Identifier(command.siloId) || !_Identifier(command.computerId) || !_Identifier(command.conversationId))
		throw new Error("Conversation computer runtime command requires server-owned current coordinates");
}

/** Returns a finite server time before it is used for a durable command expiry. */
function _Now(value: Date): Date
{
	if (!Number.isFinite(value.getTime()))
		throw new Error("Conversation computer runtime command requires a valid server clock");
	return value;
}

/** Checks a nonblank identifier without trimming a durable coordinate before it reaches storage. */
function _Identifier(value: unknown): value is string
{
	return typeof value === "string" && value.length > 0 && value.length <= 128 && value === value.trim();
}

/** Checks a UUID before it becomes a durable event or command idempotency key. */
function _Uuid(value: unknown): value is string
{
	return typeof value === "string" && _UUID_PATTERN.test(value);
}

/** Checks a protected payload reference without allowing a filesystem path or network address. */
function _PayloadReference(value: unknown): value is string
{
	return typeof value === "string" && _PAYLOAD_REFERENCE_PATTERN.test(value);
}

/** Checks a canonical SHA-256 digest before it binds a protected payload reference. */
function _Digest(value: unknown): value is `sha256:${string}`
{
	return typeof value === "string" && _DIGEST_PATTERN.test(value);
}

/** Checks a positive safe integer used as an execution-local command sequence or lease generation. */
function _PositiveInteger(value: unknown): value is number
{
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Checks a finite ISO timestamp before a runtime command may use it as a delivery fence. */
function _Timestamp(value: unknown): value is string
{
	return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/** Narrows a JSON-like value to a plain record before reading its owned protocol fields. */
function _Record(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

/** Rejects extensions or omissions in a durable protocol object rather than ignoring future fields. */
function _ExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean
{
	const actual = Object.keys(value);
	return actual.length === keys.length && keys.every(key => actual.includes(key));
}
