import { PrismaGroupChildAccessRepository } from "./prisma-group-child-access-repository";
import { createHash } from "node:crypto";
import { AgentRevisionState, AgentServiceState, ConversationLifecycle, OrgMemberStatus, Prisma, type PrismaClient } from "@prisma/client";
import { ProductAuthorizationActions } from "@opencrane/models/authorization";
import type { MessageEntry } from "@opencrane/contracts";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";

import { ConversationHistoryReader } from "../conversation-history-reader";
import type { ConversationPrivatePayloadCipher, EncryptedConversationPrivatePayload } from "../conversation-private-payload.types";
import type { ConversationComputerOutputPayloadStore, ConversationComputerPendingTurnCompiler, ConversationComputerRunAdmissionCommand, ConversationComputerRunAdmissionPort, ConversationComputerTurnCandidate, ConversationComputerTurnCompileCommand, ConversationComputerTurnProjectionRepository, FrozenConversationComputerTurn } from "../conversation-computer-turn.types";
import { PrismaConversationProductAuthorizationRepository } from "./conversation-product-authorization";

/** Resolves a pending turn and delegates its durable run admission before Kurrent freezes it. */
export class PrismaConversationComputerTurnRepository implements ConversationComputerTurnProjectionRepository, ConversationComputerPendingTurnCompiler, ConversationComputerOutputPayloadStore
{
	private readonly histories: ConversationHistoryReader;
	public constructor(private readonly prisma: Prisma.TransactionClient, history: Pick<HistoryStore, "readStream">, private readonly cipher: ConversationPrivatePayloadCipher, private readonly maximumTurnCostUsdMicros: number, private readonly runAdmission: ConversationComputerRunAdmissionPort)
	{
		this.histories = new ConversationHistoryReader(history);
	}

	/** Resolve exact computer coordinates inside the TokenReviewed silo. */
	public async resolve(siloId: string, computerId: string)
	{
		const row = await this.prisma.conversation.findFirst({ where: { siloId, computerId }, select: { id: true, computerAgentIdentityId: true, computerProfileRevisionId: true } });
		return row === null || row.computerAgentIdentityId === null || row.computerProfileRevisionId === null ? null : { conversationId: row.id, agentIdentityId: row.computerAgentIdentityId, profileRevisionId: row.computerProfileRevisionId };
	}

	/** Compile the latest unhandled human entry with the current published revision; later refreshes conflict with the frozen digest. */
	public async compile(command: ConversationComputerTurnCompileCommand): Promise<ConversationComputerTurnCandidate | null>
	{
		const { siloId, conversationId, computerId, agentIdentityId } = command.computer;
		const history = await this.histories.read({ siloId, conversationId });
		const messages = history.entries.filter((entry): entry is MessageEntry => entry.kind === "message" && entry.state === "completed");
		const lastAgent = messages.findLastIndex(entry => entry.author.kind === "agent");
		const pending = messages.slice(lastAgent + 1).findLast(entry => entry.author.kind === "human" && (entry.addressedAgentIdentityId === null || entry.addressedAgentIdentityId === agentIdentityId));
		if (pending === undefined)
			return null;
		if (pending.author.kind !== "human")
			throw new Error("Conversation computer turn requires a pending human entry");
		const pendingAuthor = pending.author;
		const expectedRevision = BigInt(history.entries.at(-1)?.position ?? "0");
		const loaded = await (async () =>
		{
			const conversation = await this.prisma.conversation.findFirst({ where: { id: conversationId, siloId, computerId, lifecycle: ConversationLifecycle.Open, service: { is: { state: AgentServiceState.Active } } }, select: { participants: { where: { accessEndedPosition: null }, select: { userId: true } }, service: { select: { id: true, name: true, activeRevision: { select: { id: true, state: true, publishedAt: true, promptPolicyVersion: true, personaRevisionId: true, budget: true, modelDefinition: { select: { publicModelName: true, generatedOutputCapabilities: true } } } } } } } });
			if (conversation?.service?.activeRevision === null || conversation?.service?.activeRevision === undefined)
				throw new Error("Conversation computer turn requires an active agent revision");
			const subjects = conversation.participants.map(participant => participant.userId);
			const memberships = await this.prisma.orgMembership.findMany({ where: { clusterTenant: siloId, subject: { in: subjects }, status: OrgMemberStatus.Active }, select: { subject: true } });
			const principal = await this.prisma.principal.findFirst({ where: { id: pendingAuthor.principalId, siloId, issuer: pendingAuthor.issuer, subject: pendingAuthor.participantId }, select: { id: true, issuer: true, subject: true } });
			const isActiveMember = memberships.some(membership => membership.subject === pendingAuthor.participantId);
			const authorization = new PrismaConversationProductAuthorizationRepository(this.prisma);
			const admitted = principal !== null && isActiveMember && await authorization.isCurrentlyEligible({ siloId, principalId: principal.id, subjectId: principal.subject, externalIssuer: principal.issuer, verifiedAuthenticationAt: pendingAuthor.authenticatedAt }, conversationId, ProductAuthorizationActions.Use);
			if (!admitted || principal === null || !await new PrismaGroupChildAccessRepository(this.prisma).mayAccess({ siloId, principalId: pendingAuthor.principalId, subjectId: pendingAuthor.participantId, externalIssuer: pendingAuthor.issuer, verifiedAuthenticationAt: pendingAuthor.authenticatedAt }, conversationId))
				throw new Error("Conversation computer turn requires one currently authorized active participant");
			const revision = conversation.service.activeRevision;
			if (revision.state !== AgentRevisionState.Published || revision.publishedAt === null)
				throw new Error("Conversation computer turn requires the pinned revision to remain published");
			return { principal, service: conversation.service, revision };
		})();
		const runId = _Uuid("turn", pending.id);
		const admissionCommand: ConversationComputerRunAdmissionCommand = { runId, computer: command.computer, agent: { agentServiceId: loaded.service.id, agentRevisionId: loaded.revision.id, profileRevisionId: command.profileRevisionId }, lease: command.lease, requesterPrincipalId: loaded.principal.id, requesterIssuer: loaded.principal.issuer, requesterSubjectId: loaded.principal.subject, requesterAuthenticatedAt: pendingAuthor.authenticatedAt, requestIdempotencyKey: pending.id, messageInput: { mode: "pre_persisted_history" as const, messageId: pending.id, historyRevision: expectedRevision.toString(), orderedMessageIds: messages.map(message => message.id) } };
		const admitted = await this.runAdmission.admit(admissionCommand);
		const compiledInput = admitted.compiledInput;
		const authorityExpiresAt = Date.parse(admitted.authorityExpiresAt);
		const remainingAuthoritySeconds = Math.floor((authorityExpiresAt - Date.now()) / 1_000);
		if (!Number.isFinite(authorityExpiresAt) || remainingAuthoritySeconds < 1)
			throw new Error("Conversation computer turn requires unexpired run and membership authority");
		if (compiledInput.runId !== runId || compiledInput.attempt !== 1)
			throw new Error("Conversation computer run admission returned input for another run attempt");
		return { binding: { siloId, conversationId, computerId, leaseGeneration: command.lease.leaseGeneration, agentIdentityId, agentServiceId: loaded.service.id, agentName: loaded.service.name, agentAvatarArtifactRevisionId: null, runId, expectedRevision, maximumEntryBytes: 65_536 }, compiledInput, latestPendingEntryId: pending.id, modelAlias: compiledInput.model.modelAlias, maximumBudgetUsd: this.maximumTurnCostUsdMicros / 1_000_000, credentialLifetimeSeconds: Math.min(300, remainingAuthoritySeconds), credentialExpiresAt: new Date(authorityExpiresAt).toISOString(), lease: command.lease };
	}

	/** Encrypt and idempotently persist assistant text before history references it, moving the conversation to the top of every list. */
	public store(turn: FrozenConversationComputerTurn, sourceCommandId: string, text: string)
	{
		const payloadRef = _Uuid("payload", sourceCommandId);
		const blockId = _Uuid("block", sourceCommandId);
		const coordinates = { siloId: turn.siloId, conversationId: turn.binding.conversationId, payloadRef, authorSubject: turn.binding.agentIdentityId };
		const encrypted = this.cipher.encrypt(text, coordinates);
		return (async () =>
		{
			const existing = await this.prisma.conversationPrivatePayload.findUnique({ where: { conversationId_authorSubject_idempotencyKey: { conversationId: turn.binding.conversationId, authorSubject: turn.binding.agentIdentityId, idempotencyKey: sourceCommandId } } });
			const row = existing ?? await this._createPayload(turn, sourceCommandId, payloadRef, encrypted);
			if (this.cipher.decrypt({ keyId: row.keyId, nonce: row.nonce, authTag: row.authTag, ciphertext: row.ciphertext, ciphertextDigest: row.ciphertextDigest }, { siloId: row.siloId, conversationId: row.conversationId, payloadRef: row.id, authorSubject: row.authorSubject }) !== text)
				throw new Error("Conversation computer output idempotency key was reused for different text");
			return { blockId, payloadRef: row.id, ciphertextDigest: row.ciphertextDigest };
		})();
	}

	/** Store one new encrypted payload and move its conversation to the top of every list in the same transaction. */
	private async _createPayload(turn: FrozenConversationComputerTurn, sourceCommandId: string, payloadRef: string, encrypted: EncryptedConversationPrivatePayload)
	{
		const row = await this.prisma.conversationPrivatePayload.create({ data: { id: payloadRef, siloId: turn.siloId, conversationId: turn.binding.conversationId, authorSubject: turn.binding.agentIdentityId, idempotencyKey: sourceCommandId, keyId: encrypted.keyId, nonce: Buffer.from(encrypted.nonce), authTag: Buffer.from(encrypted.authTag), ciphertext: Buffer.from(encrypted.ciphertext), ciphertextDigest: encrypted.ciphertextDigest } });
		// The conversation trigger accepts this move only because the payload above was stored in the same transaction, and stamps the real database time.
		await this.prisma.conversation.update({ where: { id_siloId: { id: turn.binding.conversationId, siloId: turn.siloId } }, data: { updatedAt: new Date() }, select: { id: true } });
		return row;
	}
}

/** Opens an isolated Prisma transaction for each conversation-computer persistence operation. */
export class PrismaConversationComputerTurnUnitOfWork implements ConversationComputerTurnProjectionRepository, ConversationComputerPendingTurnCompiler, ConversationComputerOutputPayloadStore
{
	public constructor(private readonly prisma: PrismaClient, private readonly history: Pick<HistoryStore, "readStream">, private readonly cipher: ConversationPrivatePayloadCipher, private readonly maximumTurnCostUsdMicros: number, private readonly runAdmission: ConversationComputerRunAdmissionPort) {}

	public resolve(siloId: string, computerId: string)
	{
		return this._Run(repository => repository.resolve(siloId, computerId), Prisma.TransactionIsolationLevel.RepeatableRead);
	}

	public compile(command: ConversationComputerTurnCompileCommand)
	{
		return this._Run(repository => repository.compile(command), Prisma.TransactionIsolationLevel.RepeatableRead);
	}

	public store(turn: FrozenConversationComputerTurn, sourceCommandId: string, text: string)
	{
		return this._Run(repository => repository.store(turn, sourceCommandId, text), Prisma.TransactionIsolationLevel.Serializable);
	}

	private _Run<TResult>(operation: (repository: PrismaConversationComputerTurnRepository) => Promise<TResult>, isolationLevel: Prisma.TransactionIsolationLevel): Promise<TResult>
	{
		const history = this.history;
		const cipher = this.cipher;
		const maximumTurnCostUsdMicros = this.maximumTurnCostUsdMicros;
		const runAdmission = this.runAdmission;
		return this.prisma.$transaction(async function _Run(transaction: Prisma.TransactionClient)
		{
			return await operation(new PrismaConversationComputerTurnRepository(transaction, history, cipher, maximumTurnCostUsdMicros, runAdmission));
		}, { isolationLevel });
	}
}

function _Uuid(domain: string, coordinate: string): string
{
	const hex = createHash("sha256").update(`${domain}:${coordinate}`).digest("hex").slice(0, 32).split("");
	hex[12] = "4"; hex[16] = "8";
	return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}
