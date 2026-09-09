import type { ConversationEntry } from "@opencrane/contracts";
import { ConversationActivityKinds, type ConversationActivityRow } from "@opencrane/state/conversation/elicitation";
import type { ConversationPersonalRun } from "@opencrane/state/conversation/workspace";

/**
 * Maps recent personal work without copying answers or interpreting run state as transcript content.
 * An answer link requires a completed agent message in both the authorized history and rendered rows.
 * Called by: ConversationWorkspacePresenter.
 */
export function _PersonalRunActivity(runs: readonly ConversationPersonalRun[], conversationId: string | null, entries: readonly ConversationEntry[], renderedEntryIds: ReadonlySet<string>): readonly ConversationActivityRow[]
{
	if (conversationId === null)
		return [];
	return runs.filter(run => run.conversationId === conversationId).map(function _Row(run): ConversationActivityRow
	{
		const answer = entries.filter(entry => entry.conversationId === conversationId && entry.runId === run.runId && entry.kind === "message" && entry.author.kind === "agent" && entry.state === "completed" && renderedEntryIds.has(entry.id)).reduce<ConversationEntry | undefined>(function _Newest(previous, entry) { return previous === undefined || BigInt(entry.position) > BigInt(previous.position) ? entry : previous; }, undefined);
		return { kind: ConversationActivityKinds.Run, id: run.runId, label: "Assistant work", occurredAt: run.acceptedAt, status: run.state, latestTool: run.latestTool, target: answer === undefined ? null : { conversationId, runId: run.runId, entryId: answer.id } };
	});
}
