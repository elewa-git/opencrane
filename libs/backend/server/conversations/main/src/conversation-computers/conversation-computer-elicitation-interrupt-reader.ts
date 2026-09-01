import { ConversationElicitationEntryStates, ConversationEntryKinds, RunEventTypes, type AgUiProjectionSourceEvent, type ConversationEntry, type ElicitationRequestEntry } from "@opencrane/contracts";
import type { ConversationOpenInterruptReader, ReadOpenConversationInterruptsCommand } from "@opencrane/backend/conversations/projection";

import { ConversationHistoryReader } from "../conversation-history-reader";
import type { ConversationComputerElicitationInterruptClock, ConversationComputerElicitationInterruptExecutionResolver, ConversationComputerElicitationInterruptParticipantResolver, ConversationComputerElicitationInterruptPayloadReader } from "./conversation-computer-elicitation-interrupt-reader.types";

/**
 * Builds open target elicitation events for one authorized conversation participant.
 *
 * The reader derives the participant from the authenticated subject, selects only unresolved
 * request entries addressed to that participant, and asks the protected-payload boundary for a
 * browser-safe presentation. It passes `computerExecutionId` through the projection's opaque
 * `runId` field: target computers intentionally have no `AgentRun` identity, while the browser
 * wait reducer still needs a stable execution correlation.
 *
 * The target ConversationComputer socket composition for issue #759 will use this reader after
 * the protected payload store and participant router replace the legacy elicitation transport.
 * @see ConversationComputerElicitationInterruptPayloadReader
 */
export class ConversationComputerElicitationInterruptReader implements ConversationOpenInterruptReader
{
	/**
	 * Connects target history, current participant authority, protected presentation, and server time.
	 * @param conversations - Reads immutable conversation entries after the trust checks pass.
	 * @param participants - Resolves the current participant from the authenticated socket subject.
	 * @param executions - Resolves the app-derived computer execution and lease fence.
	 * @param payloads - Reads browser-safe request details from protected storage.
	 * @param clock - Supplies the server time for request expiry checks.
	 */
	public constructor(
		private readonly conversations: Pick<ConversationHistoryReader, "read">,
		private readonly participants: ConversationComputerElicitationInterruptParticipantResolver,
		private readonly executions: ConversationComputerElicitationInterruptExecutionResolver,
		private readonly payloads: ConversationComputerElicitationInterruptPayloadReader,
		private readonly clock: ConversationComputerElicitationInterruptClock,
	)
	{
	}

	/**
	 * Returns every currently actionable target request for the authenticated participant.
	 *
	 * The target socket composition calls this through `ConversationOpenInterruptReader` after it
	 * derives the socket subject and conversation coordinates.
	 * @param command - Carries the trusted socket subject and its conversation coordinates.
	 * @returns Projection events for addressed, unexpired requests on the current computer execution.
	 * @throws {Error} Rejects malformed resolver data or a protected-payload integrity failure. A
	 *   thrown failure closes the socket rather than silently omitting an actionable request.
	 */
	public async readOpen(command: ReadOpenConversationInterruptsCommand): Promise<readonly AgUiProjectionSourceEvent[]>
	{
		_ValidateCommand(command);
		const participant = await this.participants.resolve(command);
		if (participant === null)
			return [];
		if (!_Identifier(participant.participantId))
			throw new Error("Conversation computer elicitation interrupt reader resolved an invalid participant");
		const execution = await this.executions.resolve({ siloId: command.siloId, conversationId: command.conversationId });
		if (execution === null)
			return [];
		_ValidateExecution(execution);

		// 1. Read immutable history after current participation and execution checks block foreign requests.
		const history = await this.conversations.read({ siloId: command.siloId, conversationId: command.conversationId });
		const resolved = _ResolvedRequestIds(history.entries);
		const now = this.clock.now();
		const requests = history.entries.filter(function _OpenRequest(entry): entry is ElicitationRequestEntry
		{
			return _IsOpenRequest(entry, participant.participantId, execution, resolved, now);
		});

		// 2. Read protected payloads after history confirms each request address and current execution.
		const overlays: AgUiProjectionSourceEvent[] = [];
		for (const request of requests)
		{
			const presentation = await this.payloads.readRequestForParticipant({ siloId: command.siloId, conversationId: command.conversationId, participantId: participant.participantId, request });
			_ValidatePresentation(presentation);
			overlays.push({
				conversationId: command.conversationId,
				runId: request.computerExecutionId,
				position: request.position,
				eventType: RunEventTypes.ElicitationRequested,
				occurredAt: request.occurredAt,
				payload: {
					interrupt: {
						id: request.id,
						reason: request.elicitationKind,
						message: presentation.message,
						responseSchema: presentation.responseSchema,
						expiresAt: request.expiresAt,
					},
				},
			});
		}
		return overlays;
	}
}

/** Collects every request id with a terminal target resolution in the current immutable history. */
function _ResolvedRequestIds(entries: readonly ConversationEntry[]): ReadonlySet<string>
{
	const resolved = new Set<string>();
	for (const entry of entries)
	{
		if (entry.kind === ConversationEntryKinds.Elicitation && entry.state !== ConversationElicitationEntryStates.Requested)
			resolved.add(entry.requestEntryId);
	}
	return resolved;
}

/** Checks whether one entry remains an addressed, unexpired target request. */
function _IsOpenRequest(entry: ConversationEntry, participantId: string, execution: { readonly computerId: string; readonly executionId: string; readonly leaseGeneration: number }, resolved: ReadonlySet<string>, now: Date): entry is ElicitationRequestEntry
{
	return entry.kind === ConversationEntryKinds.Elicitation
		&& entry.state === ConversationElicitationEntryStates.Requested
		&& entry.addressedParticipantId === participantId
		&& entry.computerId === execution.computerId
		&& entry.computerExecutionId === execution.executionId
		&& entry.leaseGeneration === execution.leaseGeneration
		&& !resolved.has(entry.id)
		&& Date.parse(entry.expiresAt) > now.getTime();
}

/** Rejects browser-derived coordinates before they can reach history or participation readers. */
function _ValidateCommand(command: ReadOpenConversationInterruptsCommand): void
{
	if (!_Identifier(command.siloId) || !_Identifier(command.conversationId) || !_Identifier(command.subjectId))
		throw new Error("Conversation computer elicitation interrupt reader requires trusted socket coordinates");
}

/** Rejects malformed app-derived execution fences before they choose visible history entries. */
function _ValidateExecution(value: { readonly computerId: string; readonly executionId: string; readonly leaseGeneration: number }): void
{
	if (!_Identifier(value.computerId) || !_Identifier(value.executionId) || !Number.isSafeInteger(value.leaseGeneration) || value.leaseGeneration < 1)
		throw new Error("Conversation computer elicitation interrupt reader resolved an invalid active execution");
}

/** Rejects a malformed protected presentation instead of placing untrusted content in an interrupt. */
function _ValidatePresentation(value: { readonly message: string; readonly responseSchema: Readonly<Record<string, unknown>> }): void
{
	if (!_Identifier(value.message) || Object.getPrototypeOf(value.responseSchema) !== Object.prototype)
		throw new Error("Conversation computer elicitation interrupt reader received an invalid protected presentation");
}

/** Accepts a nonblank coordinate only when it has no surrounding whitespace. */
function _Identifier(value: string): boolean
{
	return value.trim().length > 0 && value === value.trim();
}
