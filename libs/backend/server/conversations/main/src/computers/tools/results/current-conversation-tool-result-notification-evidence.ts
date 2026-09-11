import { ToolResultDeliveryOutcomes } from "@opencrane/backend/server/iam/authorization";

import { ConversationComputerToolResultOutcomes, type ConversationComputerToolResults } from "../../turns/conversation-computer-continuation.types";
import type { ConversationComputerTurnCandidateResolver, ConversationComputerTurnStore } from "../../turns/conversation-computer-turn.types";
import type { ConversationToolResultNotificationCommand, ConversationToolResultNotificationEvidence, ConversationToolResultNotificationEvidenceReader } from "../../turns/tool-result-notifications/conversation-tool-result-notification.types";

/** Rechecks one frozen selection, live workflow identity, and terminal delivery without database access. */
export class CurrentConversationToolResultNotificationEvidenceReader implements ConversationToolResultNotificationEvidenceReader
{
	/** Bind the saved turn and the existing current-authority result owners. */
	public constructor(private readonly _turns: Pick<ConversationComputerTurnStore, "load">, private readonly _candidates: Pick<ConversationComputerTurnCandidateResolver, "assertCurrentForWorkflow">, private readonly _results: Pick<ConversationComputerToolResults, "read">) {}

	/** Return safe evidence only when every command coordinate still names the current durable result. */
	public async readCurrent(command: ConversationToolResultNotificationCommand): Promise<ConversationToolResultNotificationEvidence | null>
	{
		if (!_ValidCommand(command))
			throw new Error("Tool result notification requires immutable workflow coordinates");
		const turn = await this._turns.load(command.bootstrapId);
		if (turn === null || turn.siloId !== command.siloId || turn.binding.conversationId !== command.conversationId
			|| turn.compile.runId !== command.runId || turn.compile.attempt !== command.attempt
			|| turn.toolSelection?.proposalId !== command.toolInvocationId || turn.continuationReservation !== null || turn.outputReceipt !== null)
			return null;
		const execution = await this._candidates.assertCurrentForWorkflow(turn);
		const input = execution.candidate.compiledInput;
		if (input.runId !== turn.compile.runId || input.attempt !== turn.compile.attempt || input.promptCompilerVersion !== turn.compile.promptCompilerVersion || input.digest !== turn.compile.digest)
			return null;
		const result = await this._results.read(turn, execution.workload);
		if (result.outcome !== ConversationComputerToolResultOutcomes.Available || result.payloadDigest !== command.expectedResultDigest
			|| result.payload.toolInvocationId !== command.toolInvocationId || !/^sha256:[0-9a-f]{64}$/u.test(result.payloadDigest)
			|| !Number.isFinite(Date.parse(result.occurredAt)) || result.occurredAt !== new Date(result.occurredAt).toISOString()
			|| result.payload.outcome !== ToolResultDeliveryOutcomes.Succeeded && result.payload.outcome !== ToolResultDeliveryOutcomes.Failed)
			return null;
		const matching = input.tools.filter(tool => tool.toolRevisionId === result.toolRevisionId);
		if (matching.length !== 1)
			return null;
		const tool = matching[0]!;
		const outcome = result.payload.outcome === ToolResultDeliveryOutcomes.Succeeded
			? ToolResultDeliveryOutcomes.Succeeded
			: ToolResultDeliveryOutcomes.Failed;
		return { toolName: tool.name, toolKind: "mcp", outcome, resultDigest: result.payloadDigest, occurredAt: result.occurredAt };
	}
}

/** Reject malformed identifiers before they can name a stream or result. */
function _ValidCommand(command: ConversationToolResultNotificationCommand): boolean
{
	return [command.bootstrapId, command.siloId, command.conversationId, command.runId, command.toolInvocationId, command.expectedResultDigest]
		.every(value => value.trim().length > 0 && value === value.trim())
		&& Number.isSafeInteger(command.attempt) && command.attempt >= 1;
}
