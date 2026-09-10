import { BoundConversationWriter } from "@opencrane/backend/server/conversations/history";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import type { RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";

import { __AssertConversationComputerAnswerAuthority } from "./conversation-computer-answer-authority";
import type { ConversationComputerToolResults } from "./conversation-computer-continuation.types";
import type { ConversationComputerBoundWriterFactory, ConversationComputerTurnCandidateResolver, ConversationComputerTurnStore, FrozenConversationComputerTurn } from "./conversation-computer-turn.types";

/** Binds output preparation and exact atomic-commit confirmation to the admitted turn. */
export class ConversationComputerTurnWriterFactory implements ConversationComputerBoundWriterFactory
{
	/** Keeps the generic writer's checks available while the turn authority owns the atomic commit. */
	public constructor(private readonly history: Pick<HistoryStore, "append" | "readStream">, private readonly turns: Pick<ConversationComputerTurnStore, "load">, private readonly candidates: Pick<ConversationComputerTurnCandidateResolver, "assertCurrent">, private readonly toolResults: Pick<ConversationComputerToolResults, "read">) {}

	/** Builds a writer that prepares an answer and can confirm its exact participant event. */
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
