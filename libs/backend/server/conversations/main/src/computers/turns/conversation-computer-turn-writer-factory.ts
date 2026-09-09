import { BoundConversationWriter } from "@opencrane/backend/server/conversations/history";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import type { RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";

import { __AssertConversationComputerAnswerAuthority } from "./conversation-computer-answer-authority";
import type { ConversationComputerToolResults } from "./conversation-computer-continuation.types";
import type { ConversationComputerBoundWriterFactory, ConversationComputerTurnCandidateResolver, ConversationComputerTurnStore, FrozenConversationComputerTurn } from "./conversation-computer-turn.types";

/** Binds output writes to the admitted turn, conversation audience, workload lease and selected tool result. */
export class ConversationComputerTurnWriterFactory implements ConversationComputerBoundWriterFactory
{
	/** Connects append-time checks to the same durable turn and admission authorities. */
	public constructor(private readonly history: Pick<HistoryStore, "append" | "readStream">, private readonly turns: Pick<ConversationComputerTurnStore, "load">, private readonly candidates: Pick<ConversationComputerTurnCandidateResolver, "assertCurrent">, private readonly toolResults: Pick<ConversationComputerToolResults, "read">) {}

	/** Builds a writer that repeats all mutable checks immediately before appending output. */
	public create(turn: FrozenConversationComputerTurn, workload: RuntimeWorkloadIdentity): BoundConversationWriter
	{
		const turns = this.turns;
		const candidates = this.candidates;
		const toolResults = this.toolResults;
		return new BoundConversationWriter(this.history, turn.binding, { now: function _Now() { return new Date(); } }, { assertMayAppend: async function _RequirePendingTurn()
		{
			const current = await turns.load(turn.bootstrapId);
			if (current === null || current.outputSourceCommandId !== turn.outputSourceCommandId)
				throw new Error("Conversation computer turn has conflicting output");
		} }, { assertMayUseVisibility: async function _RequireConversationAudience(_binding, visibility)
		{
			if (visibility.audience !== "conversation")
				throw new Error("Conversation computer output requires conversation visibility");
		} }, { assertMayAppend: async function _RecheckAnswerAuthorityAtAppend()
		{
			await __AssertConversationComputerAnswerAuthority(turn, workload, { candidates, toolResults });
		} });
	}
}
