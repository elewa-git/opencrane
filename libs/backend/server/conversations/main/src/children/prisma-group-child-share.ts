import { Prisma, type PrismaClient } from "@prisma/client";
import { ___DigestCanonicalJson } from "@opencrane/util";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import type { MessageEntry } from "@opencrane/contracts";
import { _DeterministicUuid } from "../sessions/agent-session-identifiers";
import { ConversationHistoryAuthority } from "@opencrane/backend/server/conversations/history";
import { ConversationHistoryAppendOutcomes } from "@opencrane/backend/server/conversations/history";
import { ConversationHistoryReader } from "@opencrane/backend/server/conversations/history";
import type { ConversationPrivatePayloadCipher } from "@opencrane/backend/server/conversations/history";
import { PrismaGroupChildRequestRepository } from "./db/prisma-group-child-request-repository";
import type { GroupChildRequestRepository } from "./db/group-child-request-repository.types";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";
import { GroupChildConflictError } from "./group-child.errors";
import { _ReadGroupChildSource } from "./group-child-source";
import type { GroupChildShareCommand, GroupChildSharePort, GroupChildAgentResolver } from "./group-child.types";
import type { ConversationCaller } from "../authorization/conversation-caller.types";
import { ConversationMessageAdmissionOutcomes, type ConversationMessageAdmissionResult, type SelfConversationHistoryAuthority } from "../messages/self-conversation-history.types";

/** Posts explicitly reviewed child text as the sharing human, with verified upward provenance. */
export class PrismaGroupChildShareUnitOfWork implements GroupChildSharePort
{
	private readonly reader: ConversationHistoryReader;
	public constructor(private readonly prisma: PrismaClient, history: Pick<HistoryStore, "readStream" | "append">, private readonly cipher: ConversationPrivatePayloadCipher, private readonly participantHistory: Pick<SelfConversationHistoryAuthority, "read">, private readonly agents: GroupChildAgentResolver<Prisma.TransactionClient>, private readonly workflows: Pick<IWorkflowEngine, "spawn">, private readonly writer: ConversationHistoryAuthority)
	{
		this.reader = new ConversationHistoryReader(history);
	}

	/** Binds retries to the source coordinates and exact reviewed text before any parent append. */
	public async share(caller: ConversationCaller, childId: string, command: GroupChildShareCommand): Promise<ConversationMessageAdmissionResult | null>
	{
		if (caller.externalIssuer === undefined || caller.verifiedAuthenticationAt === undefined)
			return null;
		const request = await this._transaction(repository => repository.shareRequest(caller, childId));
		if (request === null)
			return null;
		const source = await _ReadGroupChildSource(this.participantHistory, caller, childId, command.sourceEntryId, BigInt(command.sourcePosition));
		if (source === null || source.entry.author.kind !== "agent" || source.entry.author.agentIdentityId !== request.agentIdentityId || source.entry.author.agentServiceId !== request.agentServiceId)
			return null;
		const digest = ___DigestCanonicalJson({ childId, parentId: request.parentConversationId, sourceEntryId: command.sourceEntryId, sourcePosition: command.sourcePosition, text: command.text });
		const payloadRef = _DeterministicUuid("group-child-share-payload", caller.siloId, caller.principalId, command.idempotencyKey, digest);
		const prepared = await this._transaction(repository => repository.prepareShare(caller, request, command, digest, payloadRef));
		if (prepared === null)
			return null;
		for (let attempt = 0; attempt < 4; attempt++)
		{
			const current = await this._transaction(repository => repository.canShare(caller, childId, request.parentConversationId));
			if (!current)
				return null;
			const history = await this.reader.read({ siloId: caller.siloId, conversationId: request.parentConversationId });
			if (!await this._transaction(repository => repository.canShare(caller, childId, request.parentConversationId)))
				return null;
			const repeated = history.entries.find(entry => entry.idempotencyKey === command.idempotencyKey && entry.author.kind === "human" && entry.author.participantId === caller.subjectId);
			if (repeated !== undefined)
			{
				if (repeated.kind !== "message" || repeated.causationId !== source.entry.id || repeated.correlationId !== request.id || repeated.replyToEntryId !== request.parentMessageId || repeated.blocks.length !== 1 || repeated.blocks[0]?.kind !== "text" || repeated.blocks[0].payloadRef !== payloadRef)
					throw new GroupChildConflictError();
				return { outcome: ConversationMessageAdmissionOutcomes.Idempotent, position: repeated.position };
			}
			const expectedRevision = BigInt(history.entries.at(-1)?.position ?? "0");
			const position = (expectedRevision + 1n).toString();
			const entry: MessageEntry = { schemaVersion: 1, id: command.idempotencyKey, conversationId: request.parentConversationId, position, author: { kind: "human", principalId: caller.principalId, participantId: caller.subjectId, issuer: caller.externalIssuer, authenticatedAt: caller.verifiedAuthenticationAt, name: prepared.authorName, avatarArtifactRevisionId: null }, provenance: "human-authored", visibility: { audience: "conversation" }, runId: null, causationId: source.entry.id, correlationId: request.id, idempotencyKey: command.idempotencyKey, occurredAt: new Date().toISOString(), attestation: null, kind: "message", state: "completed", blocks: [{ id: _DeterministicUuid("group-child-share-block", command.idempotencyKey), kind: "text", payloadRef, ciphertextDigest: prepared.payload.ciphertextDigest }], replyToEntryId: request.parentMessageId, addressedAgentIdentityId: null, activation: "none" };
			const result = await this.writer.append({ siloId: caller.siloId, conversationId: request.parentConversationId, expectedRevision, entry });
			if (result.outcome === ConversationHistoryAppendOutcomes.Appended)
				return { outcome: ConversationMessageAdmissionOutcomes.Accepted, position };
		}
		throw new Error("Group result sharing remained contended");
	}

	/** Retries only known rollbacks while preserving both current conversation gates in each attempt. */
	private _transaction<TResult>(operation: (repository: GroupChildRequestRepository) => Promise<TResult>): Promise<TResult>
	{
		const agents = this.agents;
		const workflows = this.workflows;
		const cipher = this.cipher;
		return ___RunInPrismaUnitOfWork(this.prisma, async function _GroupChildTransaction(transaction: Prisma.TransactionClient) { return operation(new PrismaGroupChildRequestRepository(transaction, agents, workflows, cipher)); }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, attemptLimit: 3, operation: "conversation-group-share" });
	}
}
