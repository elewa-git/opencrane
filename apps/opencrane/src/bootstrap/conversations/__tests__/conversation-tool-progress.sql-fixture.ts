import { randomUUID } from "node:crypto";

import { HistoryExpectedRevisions, type HistoryRecordedEvent, type HistoryStore } from "@opencrane/backend/server/infra/history-store";

import type { _SeedConversationToolProposalSqlFixture } from "./conversation-tool-proposal.sql-fixture";

/**
 * Keep history local while the route uses real PostgreSQL claim and permission owners.
 * The running append commits both records, then loses its acknowledgement once. Real Kurrent
 * atomicity is qualified separately by the conversation integration target.
 */
export function _ProgressHistoryWithLostAcknowledgement(fixture: Awaited<ReturnType<typeof _SeedConversationToolProposalSqlFixture>>, afterRunningCommit: () => Promise<void>)
{
	const conversationId = fixture.turn.binding.conversationId;
	const streamName = `conversation-${conversationId}`;
	const eventId = randomUUID();
	const genesis = { schemaVersion: 1, siloId: fixture.siloId, conversationId, mode: "agent_session", agentServiceId: fixture.turn.binding.agentServiceId, createdByPrincipalId: fixture.principalId, createdAt: new Date().toISOString() };
	const streams = new Map<string, HistoryRecordedEvent[]>([[streamName, [{ streamName, revision: 0n, recordedAt: new Date(), id: eventId, type: "opencrane.conversation-created.v1", data: { genesis }, metadata: { siloId: fixture.siloId, conversationId, causationId: eventId, correlationId: eventId, idempotencyKey: eventId } }]]]);
	let lostAcknowledgements = 0;
	const history: Pick<HistoryStore, "append" | "appendAtomic" | "readHead" | "readStream"> = {
		async append() { throw new Error("Progress must append its receipt and participant entry atomically"); },
		async appendAtomic(command)
		{
			for (const head of command.expectedHeads)
			{
				const expected = head.revision === HistoryExpectedRevisions.NoStream ? -1n : head.revision;
				if (expected !== BigInt((streams.get(head.streamName) ?? []).length - 1))
					throw new Error("Progress SQL fixture history head changed");
			}
			for (const append of command.appends)
			{
				const events = streams.get(append.streamName) ?? [];
				for (const event of append.events)
					events.push({ ...structuredClone(event), streamName: append.streamName, revision: BigInt(events.length), recordedAt: new Date() });
				streams.set(append.streamName, events);
			}
			if (lostAcknowledgements === 0 && command.appends.some(append => append.streamName.startsWith("conversation-tool-progress-running-")))
			{
				lostAcknowledgements += 1;
				await afterRunningCommit();
				throw new Error("Running history committed but its acknowledgement was lost");
			}
			return command.appends.map(append => ({ streamName: append.streamName, revision: BigInt(streams.get(append.streamName)!.length - 1) }));
		},
		async readHead(name) { return { streamName: name, revision: streams.has(name) ? BigInt(streams.get(name)!.length - 1) : null }; },
		async *readStream(request)
		{
			for (const event of (streams.get(request.streamName) ?? []).filter(event => event.revision >= (request.fromRevision ?? 0n)).slice(0, request.maxCount))
				yield structuredClone(event);
		},
	};
	return { history, lostAcknowledgements: function _LostAcknowledgements() { return lostAcknowledgements; } };
}
