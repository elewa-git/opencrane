import { ConversationChildRequestState, ConversationMode, type Prisma } from "@prisma/client";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";
import type { ConversationPrivatePayloadCipher } from "../conversation-private-payload.types";
import type { GroupChildAgentResolver, GroupChildCreateCommand, GroupChildShareCommand, GroupChildRequest, GroupChildView } from "../group-child.types";
import type { ConversationCaller } from "../types/conversation-caller.types";
import type { GroupChildRequestRepository } from "./group-child-request-repository.types";
import type { StoredConversationPrivatePayload } from "./prisma-conversation-history-repository.types";
import { _DeterministicUuid } from "../agent-session-identifiers";
import { _GroupChildCaller, _GroupChildView } from "../group-child.mapper";
import { GroupChildConflictError } from "../group-child.errors";
import { GROUP_CHILD_TASK } from "../group-child-task";
import { PrismaGroupChildAccessRepository } from "./prisma-group-child-access-repository";
import { PrismaConversationProductAuthorizationRepository } from "./conversation-product-authorization";
import { PrismaConversationHistoryRepository } from "./prisma-conversation-history-repository";

/** Keeps request, projection, grant and encrypted-copy writes inside their admitted transaction. */
export class PrismaGroupChildRequestRepository implements GroupChildRequestRepository
{
	private readonly access: PrismaGroupChildAccessRepository;
	private readonly authorization: PrismaConversationProductAuthorizationRepository;
	private readonly history: PrismaConversationHistoryRepository;
	/** Shares one transaction with access checks, encrypted payloads, grants and durable admission. */
	public constructor(private readonly transaction: Prisma.TransactionClient, private readonly agents: GroupChildAgentResolver<Prisma.TransactionClient>, private readonly workflows: Pick<IWorkflowEngine, "spawn">, private readonly cipher: ConversationPrivatePayloadCipher) { this.access = new PrismaGroupChildAccessRepository(this.transaction); this.authorization = new PrismaConversationProductAuthorizationRepository(this.transaction); this.history = new PrismaConversationHistoryRepository(this.transaction); }

	/** Commits an exact immutable request and its durable task together; retries preserve the winner. */
	public async create(caller: ConversationCaller, parentConversationId: string, command: GroupChildCreateCommand, id: string, commandDigest: string): Promise<GroupChildView | null>
	{
		const existing = await this.transaction.conversationChildRequest.findUnique({ where: { id } });
		if (existing !== null)
			return await this._canRecover(caller, existing, commandDigest) ? _GroupChildView(existing) : null;
		const audience = await this.access.audience(caller, parentConversationId, BigInt(command.parentMessagePosition));
		if (audience === null)
			return null;
		const agent = await this.agents.resolve(this.transaction, caller, command.agentServiceId);
		if (agent === null)
			return null;
		const authorization = this.authorization;
		if (!await authorization.admit(caller, { kind: ProductAuthorizationResourceKinds.Conversation, id: parentConversationId }, ProductAuthorizationActions.Delegate, { commandDigest }) || !await authorization.admit(caller, { kind: ProductAuthorizationResourceKinds.ConversationCollection, id: caller.siloId }, ProductAuthorizationActions.Create, { commandDigest }))
			return null;
		const childConversationId = _DeterministicUuid("group-child-conversation", id);
		const request = await this.transaction.conversationChildRequest.create({ data: { id, siloId: caller.siloId, idempotencyKey: command.idempotencyKey, parentConversationId, parentMessageId: command.parentMessageId, parentMessagePosition: BigInt(command.parentMessagePosition), childConversationId, computerId: `computer-${_DeterministicUuid("group-child-computer", id)}`, requestedByPrincipalId: caller.principalId, requesterSubjectId: caller.subjectId, requesterIssuer: caller.externalIssuer!, requesterAuthenticatedAt: new Date(caller.verifiedAuthenticationAt!), agentServiceId: agent.agentServiceId, agentRevisionId: agent.agentRevisionId, agentIdentityId: agent.agentIdentityId, agentPrincipalId: agent.principalId, agentName: agent.name, profileRevisionId: agent.profileRevisionId, participantSubjectIds: [...audience], commandDigest } });
		await this.workflows.spawn({ client: this.transaction }, { taskName: GROUP_CHILD_TASK.taskName, idempotencyKey: request.id, input: { requestId: request.id, siloId: request.siloId } });
		return _GroupChildView(request);

	}

	/** Returns at most the latest 100 requests that remain visible through both conversation gates. */
	public async list(caller: ConversationCaller, parentConversationId: string): Promise<readonly GroupChildView[] | null>
	{
		if (await this.history.authorizeRead(caller, parentConversationId) === null)
			return null;
		const requests = await this.transaction.conversationChildRequest.findMany({ where: { siloId: caller.siloId, parentConversationId }, orderBy: { createdAt: "desc" }, take: 100 });
		const visible: GroupChildView[] = [];
		for (const request of requests)
		{
			if (Array.isArray(request.participantSubjectIds) && request.participantSubjectIds.includes(caller.subjectId) && await this.access.mayReadOrigin(caller, parentConversationId, request.parentMessagePosition) && (request.state !== ConversationChildRequestState.Ready || await this.access.mayAccess(caller, request.childConversationId)))
				visible.push(_GroupChildView(request));
		}
		return visible;

	}

	/** Creates participant and creator grants only for the first projection insertion after cold history exists. */
	public async project(request: GroupChildRequest): Promise<boolean>
	{
		if (!await this.access.stillAdmitted(request, this.agents))
			return false;
		const existing = await this.transaction.conversation.findUnique({ where: { id: request.childConversationId }, select: { siloId: true, agentServiceId: true, computerId: true, computerAgentIdentityId: true, computerProfileRevisionId: true } });
		if (existing !== null)
		{
			if (existing.siloId !== request.siloId || existing.agentServiceId !== request.agentServiceId || existing.computerId !== request.computerId || existing.computerAgentIdentityId !== request.agentIdentityId || existing.computerProfileRevisionId !== request.profileRevisionId)
				throw new GroupChildConflictError();
			return true;
		}
		const subjects = request.participantSubjectIds as string[];
		await this.transaction.conversation.create({ data: { id: request.childConversationId, siloId: request.siloId, mode: ConversationMode.AgentSession, agentServiceId: request.agentServiceId, computerId: request.computerId, computerAgentIdentityId: request.agentIdentityId, computerProfileRevisionId: request.profileRevisionId, participants: { create: subjects.map(userId => ({ userId, visibleFromPosition: 1n, readThroughPosition: 0n })) } } });
		const authorization = this.authorization;
		await authorization.reconcileParticipants(request.siloId, request.childConversationId, subjects, request.requestedByPrincipalId, request.createdAt);
		await authorization.reconcileCreator(request.siloId, request.childConversationId, request.requestedByPrincipalId, request.createdAt);
		return true;

	}

	/** Encrypts the selected source only after current creation authority is rechecked; retries reuse its ciphertext. */
	public async prepareInput(request: GroupChildRequest, text: string): Promise<StoredConversationPrivatePayload | null>
	{
		const caller = _GroupChildCaller(request);
		if (!await this.access.stillAdmitted(request, this.agents))
			return null;
		const key = _DeterministicUuid("group-child-input", request.id);
		const coordinates = { siloId: request.siloId, conversationId: request.childConversationId, authorSubject: request.requesterSubjectId, payloadRef: _DeterministicUuid("group-child-input-payload", request.id) };
		const stored = await this.history.createOrReadPayload(caller, request.childConversationId, key, coordinates.payloadRef, this.cipher.encrypt(text, coordinates));
		if (stored.payload.coordinates.payloadRef !== coordinates.payloadRef || this.cipher.decrypt(stored.payload, stored.payload.coordinates) !== text)
			throw new GroupChildConflictError();
		return stored.payload;

	}

	/** Finds a ready child request only after current participant and parent Read access. */
	public async shareRequest(caller: ConversationCaller, childId: string): Promise<GroupChildRequest | null>
	{
		if (!await this.access.mayAccess(caller, childId) || await this.history.authorizeRead(caller, childId) === null)
			return null;
		return this.transaction.conversationChildRequest.findFirst({ where: { siloId: caller.siloId, childConversationId: childId, state: ConversationChildRequestState.Ready } });

	}

	/** Binds a human share UUID to exact source coordinates and reviewed text before ciphertext persistence. */
	public async prepareShare(caller: ConversationCaller, request: GroupChildRequest, command: GroupChildShareCommand, digest: string, payloadRef: string): Promise<{ readonly payload: StoredConversationPrivatePayload; readonly authorName: string } | null>
	{
		const childId = request.childConversationId;
		const repository = this.history;
		if (await repository.authorizeRead(caller, childId) === null)
			return null;
		const parent = await repository.authorizeWrite(caller, request.parentConversationId);
		if (parent === null || !await this.authorization.admit(caller, { kind: ProductAuthorizationResourceKinds.Conversation, id: request.parentConversationId }, ProductAuthorizationActions.Use, { childId, digest, idempotencyKey: command.idempotencyKey }))
			return null;
		const coordinates = { siloId: caller.siloId, conversationId: request.parentConversationId, authorSubject: caller.subjectId, payloadRef };
		const stored = await repository.createOrReadPayload(caller, request.parentConversationId, command.idempotencyKey, payloadRef, this.cipher.encrypt(command.text, coordinates));
		if (stored.payload.coordinates.payloadRef !== payloadRef || this.cipher.decrypt(stored.payload, stored.payload.coordinates) !== command.text)
			throw new GroupChildConflictError();
		return { payload: stored.payload, authorName: parent.authorName };

	}

	/** Rechecks both conversations around the external Kurrent read and before the parent append. */
	public async canShare(caller: ConversationCaller, childId: string, parentId: string): Promise<boolean>
	{
		const repository = this.history;
		return await repository.authorizeRead(caller, childId) !== null && await repository.authorizeWrite(caller, parentId) !== null;

	}

	/** Loads only an immutable request; the coordinator rechecks its silo and state. */
	public find(id: string): Promise<GroupChildRequest | null> { return this.transaction.conversationChildRequest.findUnique({ where: { id } }); }
	/** Changes only pending requests and never reopens a terminal outcome. */
	public async setState(request: GroupChildRequest, state: GroupChildRequest["state"]): Promise<void> { await this.transaction.conversationChildRequest.updateMany({ where: { id: request.id, state: ConversationChildRequestState.Pending }, data: { state } }); }
	/** Rechecks the exact admitted company, parent, audience and child permissions. */
	public current(request: GroupChildRequest): Promise<boolean> { return this.access.stillAdmitted(request, this.agents); }
	/** Checks an admitted retry first; only a new request derives the whole current group audience. */
	public async canCreate(caller: ConversationCaller, parentId: string, command: GroupChildCreateCommand, id: string, digest: string): Promise<boolean>
	{
		const existing = await this.transaction.conversationChildRequest.findUnique({ where: { id } });
		if (existing !== null)
			return this._canRecover(caller, existing, digest);
		return await this.access.audience(caller, parentId, BigInt(command.parentMessagePosition)) !== null;
	}

	/** Recovers only the caller's immutable command while rechecking source and ready-child access. */
	private async _canRecover(caller: ConversationCaller, request: GroupChildRequest, digest: string): Promise<boolean>
	{
		if (request.siloId !== caller.siloId || request.requestedByPrincipalId !== caller.principalId || request.requesterSubjectId !== caller.subjectId || request.requesterIssuer !== caller.externalIssuer || !Array.isArray(request.participantSubjectIds) || !request.participantSubjectIds.includes(caller.subjectId))
			return false;
		if (request.commandDigest !== digest)
			throw new GroupChildConflictError();
		if (await this.access.audience(caller, request.parentConversationId, request.parentMessagePosition, [caller.subjectId]) === null)
			return false;
		return request.state !== ConversationChildRequestState.Ready || await this.access.mayAccess(caller, request.childConversationId);
	}
}
