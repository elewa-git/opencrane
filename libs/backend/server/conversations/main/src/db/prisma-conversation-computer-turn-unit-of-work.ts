import { createHash } from "node:crypto";
import { AgentRevisionState, AgentServiceState, ConversationLifecycle, OrgMemberStatus, Prisma, type PrismaClient } from "@prisma/client";
import { ProductAuthorizationActions } from "@opencrane/models/authorization";
import type { CompiledMessage, MessageEntry } from "@opencrane/contracts";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";

import { ConversationHistoryReader } from "../conversation-history-reader";
import type { ConversationPrivatePayloadCipher } from "../conversation-private-payload.types";
import type { ConversationComputerOutputPayloadStore, ConversationComputerPendingTurnCompiler, ConversationComputerTurnCandidate, ConversationComputerTurnProjectionRepository, FrozenConversationComputerTurn } from "../conversation-computer-turn.types";
import { PrismaConversationProductAuthorizationRepository } from "./conversation-product-authorization";

/** Resolves and decrypts a pending turn against the current published revision before Kurrent freezes it. */
export class PrismaConversationComputerTurnRepository implements ConversationComputerTurnProjectionRepository, ConversationComputerPendingTurnCompiler, ConversationComputerOutputPayloadStore
{
	private readonly histories: ConversationHistoryReader;
	public constructor(private readonly prisma: Prisma.TransactionClient, history: Pick<HistoryStore, "readStream">, private readonly cipher: ConversationPrivatePayloadCipher, private readonly maximumTurnCostUsdMicros: number)
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
	public async compile(command: Parameters<ConversationComputerPendingTurnCompiler["compile"]>[0]): Promise<ConversationComputerTurnCandidate | null>
	{
		const history = await this.histories.read({ siloId: command.siloId, conversationId: command.conversationId });
		const messages = history.entries.filter((entry): entry is MessageEntry => entry.kind === "message" && entry.state === "completed");
		const lastAgent = messages.findLastIndex(entry => entry.author.kind === "agent");
		const pending = messages.slice(lastAgent + 1).findLast(entry => entry.author.kind === "human" && (entry.addressedAgentIdentityId === null || entry.addressedAgentIdentityId === command.agentIdentityId));
		if (pending === undefined)
			return null;
		const expectedRevision = BigInt(history.entries.at(-1)?.position ?? "0");
		const loaded = await (async () =>
		{
			const conversation = await this.prisma.conversation.findFirst({ where: { id: command.conversationId, siloId: command.siloId, computerId: command.computerId, lifecycle: ConversationLifecycle.Open, service: { is: { state: AgentServiceState.Active } } }, select: { participants: { where: { accessEndedPosition: null }, select: { userId: true } }, service: { select: { id: true, name: true, activeRevision: { select: { id: true, state: true, publishedAt: true, promptPolicyVersion: true, personaRevisionId: true, budget: true, modelDefinition: { select: { publicModelName: true, generatedOutputCapabilities: true } } } } } } } });
			if (conversation?.service?.activeRevision === null || conversation?.service?.activeRevision === undefined)
				throw new Error("Conversation computer turn requires an active agent revision");
			const subjects = conversation.participants.map(participant => participant.userId);
			const memberships = await this.prisma.orgMembership.findMany({ where: { clusterTenant: command.siloId, subject: { in: subjects }, status: OrgMemberStatus.Active }, select: { subject: true } });
			const principals = await this.prisma.principal.findMany({ where: { siloId: command.siloId, subject: { in: memberships.map(membership => membership.subject) } }, select: { id: true, subject: true } });
			const authorization = new PrismaConversationProductAuthorizationRepository(this.prisma);
			let admitted = false;
			for (const principal of principals)
				admitted ||= await authorization.canAccess({ siloId: command.siloId, principalId: principal.id, subjectId: principal.subject }, command.conversationId, ProductAuthorizationActions.Use);
			if (!admitted)
				throw new Error("Conversation computer turn requires one currently authorized active participant");
			const revision = conversation.service.activeRevision;
			if (revision.state !== AgentRevisionState.Published || revision.publishedAt === null)
				throw new Error("Conversation computer turn requires the pinned revision to remain published");
			const persona = revision.personaRevisionId === null ? null : await this.prisma.personaRevision.findUnique({ where: { id: revision.personaRevisionId }, select: { compiledInstructions: true } });
			const refs = messages.flatMap(entry => entry.blocks.flatMap(block => block.kind === "text" ? [block.payloadRef] : []));
			const payloads = await this.prisma.conversationPrivatePayload.findMany({ where: { siloId: command.siloId, conversationId: command.conversationId, id: { in: refs } } });
			return { service: conversation.service, revision, instructions: persona?.compiledInstructions ?? "", payloads };
		})();
		const expectedAuthors = new Map<string, string>();
		for (const entry of messages)
			for (const block of entry.blocks)
				if (block.kind === "text")
					expectedAuthors.set(block.payloadRef, _AuthorSubject(entry));
		if (loaded.payloads.length !== expectedAuthors.size || loaded.payloads.some(row => expectedAuthors.get(row.id) !== row.authorSubject || row.siloId !== command.siloId || row.conversationId !== command.conversationId))
			throw new Error("Conversation computer turn requires every private payload exactly once with its original author binding");
		const text = new Map(loaded.payloads.map(row => [row.id, this.cipher.decrypt({ keyId: row.keyId, nonce: row.nonce, authTag: row.authTag, ciphertext: row.ciphertext, ciphertextDigest: row.ciphertextDigest }, { siloId: row.siloId, conversationId: row.conversationId, payloadRef: row.id, authorSubject: row.authorSubject })]));
		const compiledMessages: CompiledMessage[] = messages.map(entry => _CompiledMessage(entry, text));
		const runId = _Uuid("turn", pending.id);
		const budget = loaded.revision.budget as { readonly maxTokens?: number; readonly maxDurationMs?: number };
		const capabilities = _GeneratedOutputCapabilities(loaded.revision.modelDefinition.generatedOutputCapabilities);
		const partial = { promptCompilerVersion: loaded.revision.promptPolicyVersion, runId, attempt: 1, instructions: loaded.instructions, messages: compiledMessages, tools: [], model: { modelAlias: loaded.revision.modelDefinition.publicModelName, maxOutputTokens: null, generatedOutputCapabilities: capabilities }, budget: { maxTotalTokens: budget.maxTokens ?? null, maxCostUsdMicros: this.maximumTurnCostUsdMicros, maxToolInvocations: 0, wallClockDeadlineEpochMs: null } };
		const compiledInput = { ...partial, digest: `sha256:${createHash("sha256").update(JSON.stringify(partial)).digest("hex")}` };
		return { binding: { siloId: command.siloId, conversationId: command.conversationId, computerId: command.computerId, leaseGeneration: command.generation, agentIdentityId: command.agentIdentityId, agentServiceId: loaded.service.id, agentName: loaded.service.name, agentAvatarArtifactRevisionId: null, runId, expectedRevision, maximumEntryBytes: 65_536 }, compiledInput, latestPendingEntryId: pending.id, modelAlias: loaded.revision.modelDefinition.publicModelName, maximumBudgetUsd: this.maximumTurnCostUsdMicros / 1_000_000, credentialLifetimeSeconds: 300, sandboxClaimId: command.sandboxClaimId };
	}

	/** Encrypt and idempotently persist assistant text before history references it. */
	public store(turn: FrozenConversationComputerTurn, sourceCommandId: string, text: string)
	{
		const payloadRef = _Uuid("payload", sourceCommandId);
		const blockId = _Uuid("block", sourceCommandId);
		const coordinates = { siloId: turn.siloId, conversationId: turn.binding.conversationId, payloadRef, authorSubject: turn.binding.agentIdentityId };
		const encrypted = this.cipher.encrypt(text, coordinates);
		return (async () =>
		{
			const existing = await this.prisma.conversationPrivatePayload.findUnique({ where: { conversationId_authorSubject_idempotencyKey: { conversationId: turn.binding.conversationId, authorSubject: turn.binding.agentIdentityId, idempotencyKey: sourceCommandId } } });
			const row = existing ?? await this.prisma.conversationPrivatePayload.create({ data: { id: payloadRef, siloId: turn.siloId, conversationId: turn.binding.conversationId, authorSubject: turn.binding.agentIdentityId, idempotencyKey: sourceCommandId, keyId: encrypted.keyId, nonce: Buffer.from(encrypted.nonce), authTag: Buffer.from(encrypted.authTag), ciphertext: Buffer.from(encrypted.ciphertext), ciphertextDigest: encrypted.ciphertextDigest } });
			if (this.cipher.decrypt({ keyId: row.keyId, nonce: row.nonce, authTag: row.authTag, ciphertext: row.ciphertext, ciphertextDigest: row.ciphertextDigest }, { siloId: row.siloId, conversationId: row.conversationId, payloadRef: row.id, authorSubject: row.authorSubject }) !== text)
				throw new Error("Conversation computer output idempotency key was reused for different text");
			return { blockId, payloadRef: row.id, ciphertextDigest: row.ciphertextDigest };
		})();
	}
}

/** Opens an isolated Prisma transaction for each conversation-computer persistence operation. */
export class PrismaConversationComputerTurnUnitOfWork implements ConversationComputerTurnProjectionRepository, ConversationComputerPendingTurnCompiler, ConversationComputerOutputPayloadStore
{
	public constructor(private readonly prisma: PrismaClient, private readonly history: Pick<HistoryStore, "readStream">, private readonly cipher: ConversationPrivatePayloadCipher, private readonly maximumTurnCostUsdMicros: number) {}

	public resolve(siloId: string, computerId: string)
	{
		return this._Run(repository => repository.resolve(siloId, computerId), Prisma.TransactionIsolationLevel.RepeatableRead);
	}

	public compile(command: Parameters<ConversationComputerPendingTurnCompiler["compile"]>[0])
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
		return this.prisma.$transaction(async function _Run(transaction: Prisma.TransactionClient)
		{
			return await operation(new PrismaConversationComputerTurnRepository(transaction, history, cipher, maximumTurnCostUsdMicros));
		}, { isolationLevel });
	}
}

function _AuthorSubject(entry: MessageEntry): string
{
	if (entry.author.kind === "agent")
		return entry.author.agentIdentityId;
	if (entry.author.kind === "human")
		return entry.author.participantId;
	return "";
}

function _GeneratedOutputCapabilities(values: readonly string[]): ("image_png" | "code_execution_files")[]
{
	if (!values.every(value => value === "image_png" || value === "code_execution_files"))
		throw new Error("Conversation computer turn received an unsupported generated-output capability");
	return values as ("image_png" | "code_execution_files")[];
}

function _CompiledMessage(entry: MessageEntry, text: ReadonlyMap<string, string>): CompiledMessage
{
	const role = entry.author.kind === "agent" ? "assistant" : "user";
	const content = entry.blocks.flatMap(function _Text(block)
	{
		if (block.kind !== "text")
			return [];
		const value = text.get(block.payloadRef);
		if (value === undefined)
			throw new Error("Conversation computer turn omitted a referenced private payload");
		return [value];
	}).join("\n");
	return { role, content };
}

function _Uuid(domain: string, coordinate: string): string
{
	const hex = createHash("sha256").update(`${domain}:${coordinate}`).digest("hex").slice(0, 32).split("");
	hex[12] = "4"; hex[16] = "8";
	return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}
