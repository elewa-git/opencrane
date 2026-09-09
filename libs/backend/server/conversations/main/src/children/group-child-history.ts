import { isDeepStrictEqual } from "node:util";
import { WrongExpectedVersionError } from "@kurrent/kurrentdb-client";
import type { GroupChildRequest } from "./group-child.types";
import { ConversationComputerStates, type ConversationComputer, type MessageEntry } from "@opencrane/contracts";
import { HistoryExpectedRevisions, type HistoryStore } from "@opencrane/backend/server/infra/history-store";

import { _DeterministicUuid } from "../sessions/agent-session-identifiers";
import { ConversationHistoryAuthority } from "@opencrane/backend/server/conversations/history";
import { ConversationHistoryAppendOutcomes } from "@opencrane/backend/server/conversations/history";
import { ConversationHistoryReader } from "@opencrane/backend/server/conversations/history";
import { ConversationComputerHistory } from "@opencrane/backend/server/conversations/computers";
import type { StoredConversationPrivatePayload } from "../messages/db/prisma-conversation-history-repository.types";
import { GroupChildConflictError } from "./group-child.errors";
import { _RequestOrigin } from "./group-child.mapper";

/** Establishes only the history owed by an already admitted group child command. */
export class GroupChildHistory
{
	private readonly reader: ConversationHistoryReader;
	private readonly computers: ConversationComputerHistory;
	/** Uses the existing Kurrent and logical-computer owners without creating a second activation engine. */
	public constructor(private readonly store: Pick<HistoryStore, "append" | "appendAtomic" | "readStream" | "readHead">, private readonly authority: ConversationHistoryAuthority)
	{
		this.reader = new ConversationHistoryReader(store);
		this.computers = new ConversationComputerHistory(store);
	}

	/** Atomically creates cold history, or verifies the same immutable origin after a lost response. */
	public async establish(request: GroupChildRequest): Promise<void>
	{
		const now = request.createdAt.toISOString();
		const genesis = { schemaVersion: 1 as const, siloId: request.siloId, conversationId: request.childConversationId, mode: "agent_session" as const, agentServiceId: request.agentServiceId, createdByPrincipalId: request.requestedByPrincipalId, createdAt: now, origin: _RequestOrigin(request) };
		const computer: ConversationComputer = { schemaVersion: 1, id: request.computerId, siloId: request.siloId, conversationId: request.childConversationId, agentIdentityId: request.agentIdentityId, profileRevisionId: request.profileRevisionId, state: ConversationComputerStates.Cold, leaseGeneration: 1, workspaceCheckpoint: null, createdAt: now, updatedAt: now };
		const conversation = this.authority.genesisAppend(genesis, _DeterministicUuid("group-child-genesis", request.id));
		const computerStreamName = `conversation-computer-${request.computerId}`;
		try
		{
			await this.store.appendAtomic({ expectedHeads: [{ streamName: conversation.streamName, revision: HistoryExpectedRevisions.NoStream }, { streamName: computerStreamName, revision: HistoryExpectedRevisions.NoStream }], appends: [conversation, { streamName: computerStreamName, expectedRevision: HistoryExpectedRevisions.NoStream, events: [{ id: _DeterministicUuid("group-child-computer", request.id), type: "opencrane.conversation-computer.v1", data: { computer, lease: null }, metadata: { siloId: request.siloId, computerId: request.computerId, conversationId: request.childConversationId, agentIdentityId: request.agentIdentityId, profileRevisionId: request.profileRevisionId } }] }] });
		}
		catch (error)
		{
			if (!(error instanceof WrongExpectedVersionError))
				throw error;
		}
		const existing = await this.reader.readGenesis({ siloId: request.siloId, conversationId: request.childConversationId, maximumBytes: 65_536, signal: AbortSignal.timeout(10_000) });
		if (!isDeepStrictEqual(existing, genesis))
			throw new GroupChildConflictError();
		const checkedComputer = await this.computers.load({ computer: { siloId: request.siloId, computerId: request.computerId, conversationId: request.childConversationId, agentIdentityId: request.agentIdentityId }, profileRevisionId: request.profileRevisionId });
		if (checkedComputer === null)
			throw new Error("Group child computer history is unavailable");
	}

	/** Commits the initial request and activation together; a retry observes the original first entry. */
	public async activate(request: GroupChildRequest, source: MessageEntry, payload: StoredConversationPrivatePayload): Promise<void>
	{
		if (payload.coordinates.siloId !== request.siloId || payload.coordinates.conversationId !== request.childConversationId || payload.coordinates.authorSubject !== request.requesterSubjectId || source.author.kind !== "human" || source.author.principalId !== request.requestedByPrincipalId || source.author.participantId !== request.requesterSubjectId || source.visibility.audience !== "conversation" || source.id !== request.parentMessageId || source.position !== request.parentMessagePosition.toString())
			throw new GroupChildConflictError();
		const id = _DeterministicUuid("group-child-input", request.id);
		const history = await this.reader.read({ siloId: request.siloId, conversationId: request.childConversationId, fromRevision: 1n, maxCount: 1, maximumBytes: 131_072, signal: AbortSignal.timeout(10_000) });
		const entry: MessageEntry = { schemaVersion: 1, id, conversationId: request.childConversationId, position: "1", author: source.author, provenance: "human-authored", visibility: { audience: "conversation" }, runId: null, causationId: request.parentMessageId, correlationId: request.id, idempotencyKey: id, occurredAt: request.createdAt.toISOString(), attestation: null, kind: "message", state: "completed", blocks: [{ id: _DeterministicUuid("group-child-input-block", request.id), kind: "text", payloadRef: payload.coordinates.payloadRef, ciphertextDigest: payload.ciphertextDigest }], replyToEntryId: null, addressedAgentIdentityId: request.agentIdentityId, activation: "start" };
		if (history.entries.length !== 0)
		{
			if (!isDeepStrictEqual(history.entries[0], entry))
				throw new GroupChildConflictError();
			return;
		}
		const queueName = `computer-activations-${request.siloId}`;
		const queue = await this.store.readHead(queueName);
		if (queue.streamName !== queueName)
			throw new Error("Group child activation returned a foreign queue");
		const appended = await this.authority.appendWithActivation({ siloId: request.siloId, conversationId: request.childConversationId, expectedRevision: 0n, entry, activation: { computerId: request.computerId, generation: 1, eventId: _DeterministicUuid("group-child-activate", request.id), queueExpectedRevision: queue.revision ?? HistoryExpectedRevisions.NoStream } });
		if (appended.outcome !== ConversationHistoryAppendOutcomes.Appended)
			throw new Error("Group child activation is contended; retry the admitted command");
	}
}
