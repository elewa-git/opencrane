import type { MessageEntry } from "@opencrane/contracts";
import type { __CreatePrismaSessionAssemblyAuthorities } from "@opencrane/backend/agents/execution/inputs";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";

import { ConversationHistoryReader } from "./conversation-history-reader";

/** Re-reads one exact canonical conversation revision before run admission freezes its message set. */
type _ConversationHistoryAdmissionReader = Parameters<typeof __CreatePrismaSessionAssemblyAuthorities>[2];

/** Successful exact history read returned through the execution-input admission boundary. */
type _ConversationHistoryAdmissionRead = Exclude<Awaited<ReturnType<_ConversationHistoryAdmissionReader["read"]>>, null>;

/** Re-reads one exact canonical conversation revision before run admission freezes its message set. */
export class KurrentConversationHistoryAdmissionReader implements _ConversationHistoryAdmissionReader
{
	/** Validated finite history reader over the sole KurrentDB source. */
	private readonly _history: ConversationHistoryReader;

	/** Bind run admission to validated conversation history without a relational fallback. */
	constructor(historyStore: Pick<HistoryStore, "readStream">)
	{
		this._history = new ConversationHistoryReader(historyStore);
	}

	/** Return the exact ordered completed messages only when the requested stream revision still matches. */
	async read(command: { readonly siloId: string; readonly conversationId: string; readonly expectedRevision: string }): Promise<_ConversationHistoryAdmissionRead | null>
	{
		const history = await this._history.read({ siloId: command.siloId, conversationId: command.conversationId });
		const lastRevision = history.entries.at(-1)?.position ?? "0";
		if (lastRevision !== command.expectedRevision)
			return null;
		const messages = history.entries.filter(function _CompletedMessage(entry): entry is MessageEntry { return entry.kind === "message" && entry.state === "completed"; });
		const finalMessage = messages.at(-1);
		if (finalMessage?.author.kind !== "human")
			return null;
		return {
			historyRevision: lastRevision,
			orderedMessageIds: messages.map(message => message.id),
			finalMessageAuthor: { principalId: finalMessage.author.principalId, issuer: finalMessage.author.issuer, subjectId: finalMessage.author.participantId, authenticatedAt: finalMessage.author.authenticatedAt },
		};
	}
}
