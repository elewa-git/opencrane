import { ConversationMode, OrgMemberStatus, Prisma, type PrismaClient } from "@prisma/client";
import { ConversationModes } from "@opencrane/models/conversations";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";
import type { ConversationCaller } from "../authorization/conversation-caller.types";
import { PrismaConversationProductAuthorizationRepository } from "../authorization/db/conversation-product-authorization";
import { _IsActiveConversationMember } from "../authorization/prisma-conversation-membership";
import { _ReadConversationDetail } from "./prisma-conversation-metadata-reader";
import { _DeterministicUuid } from "../sessions/agent-session-identifiers";
import { _ParseOrdinaryConversationCreateCommand } from "./conversation-metadata.validator";
import type { ConversationMetadataDetail, InitialConversationComputerResolver } from "./conversation-metadata.types";
import type { PrismaConversationMetadataReader } from "./prisma-conversation-metadata-reader";

/** Owns creation admission, immutable genesis ordering, and participant/grant insertion. */
export class PrismaConversationCreationUnitOfWork
{
	/** Connects this owner to its transaction dependencies. */
	public constructor(private readonly prisma: PrismaClient, private readonly initialComputer: InitialConversationComputerResolver, private readonly reader: PrismaConversationMetadataReader) {}

  /**
   * Creates a conversation for a caller-scoped UUID or returns its current committed projection.
   * Ordinary member selection becomes fixed at the first PostgreSQL creation commit. Genesis alone
   * has not accepted a member set. Retries never reconcile grants, reset participants, or reopen a chat.
   * The serializable projection retries only proven rollbacks; history stays outside that retry loop.
   */
  public async create(
    caller: ConversationCaller,
    request: unknown,
  ): Promise<ConversationMetadataDetail | null> {
    if (typeof request !== "object" || request === null)
return null;
    const value = request as Record<string, unknown>;
    if (value["mode"] === "agent_session")
{
      if (Object.keys(value).some(key => !["mode", "personalAgentRef", "idempotencyKey"].includes(key)))
        return null;
      const conversationId = await this.initialComputer.resolve(
        caller,
        typeof value["personalAgentRef"] === "string"
          ? value["personalAgentRef"]
          : "",
        typeof value["idempotencyKey"] === "string" ? value["idempotencyKey"] : "",
      );
      return conversationId === null ? null : this.reader.open(caller, conversationId);
    }
    const command = _ParseOrdinaryConversationCreateCommand(request);
    if (command === null)
      return null;
    const conversationId = _DeterministicUuid("conversation", caller.siloId, caller.principalId, command.idempotencyKey.toLowerCase());
    const argumentsValue = { mode: command.mode, participantRefs: [...command.participantRefs].sort(), idempotencyKey: command.idempotencyKey.toLowerCase() };
    // 1. Check all selected members and creation authority before immutable genesis is written.
    const prechecked = await this.prisma.$transaction(async function _Precheck(transaction)
    {
      const subjects = await _OrdinarySubjects(transaction, caller, command.participantRefs);
      if (subjects === null)
        return false;
      const authorization = new PrismaConversationProductAuthorizationRepository(transaction);
      return authorization.admit(caller, { kind: ProductAuthorizationResourceKinds.ConversationCollection, id: caller.siloId }, ProductAuthorizationActions.Create, argumentsValue);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    if (!prechecked)
      return null;
    // 2. A repeated history write verifies the existing immutable mode and creator.
    await this.initialComputer.createOrdinaryGenesis(caller, conversationId, command.mode);
    // 3. Recheck mutable authority in each transaction attempt before accepting a member set.
    return ___RunInPrismaUnitOfWork(this.prisma, async function _Project(transaction): Promise<ConversationMetadataDetail | null>
    {
      const subjects = await _OrdinarySubjects(transaction, caller, command.participantRefs);
      if (subjects === null)
        return null;
      const authorization = new PrismaConversationProductAuthorizationRepository(transaction);
      const admitted = await authorization.admit(caller, { kind: ProductAuthorizationResourceKinds.ConversationCollection, id: caller.siloId }, ProductAuthorizationActions.Create, argumentsValue);
      if (!admitted)
        return null;
      const mode = command.mode === ConversationModes.Direct ? ConversationMode.Direct : ConversationMode.Group;
      const existing = await transaction.conversation.findUnique({ where: { id: conversationId }, select: { siloId: true, mode: true, agentServiceId: true, participants: { select: { userId: true } } } });
      if (existing !== null)
      {
        const existingSubjects = new Set(existing.participants.map(participant => participant.userId));
        if (existing.siloId !== caller.siloId || existing.mode !== mode || existing.agentServiceId !== null || existingSubjects.size !== subjects.length || subjects.some(subject => !existingSubjects.has(subject)))
          return null;
        return _ReadConversationDetail(transaction, caller, conversationId);
      }
      // 4. Only the insertion winner creates participant and creator grants in this transaction.
      await transaction.conversation.create({ data: { id: conversationId, siloId: caller.siloId, mode, participants: { create: subjects.map(subject => ({ userId: subject, visibleFromPosition: 1n, readThroughPosition: 0n })) } } });
      const now = new Date();
      await authorization.reconcileParticipants(caller.siloId, conversationId, subjects, caller.principalId, now);
      await authorization.reconcileCreator(caller.siloId, conversationId, caller.principalId, now);
      return _ReadConversationDetail(transaction, caller, conversationId);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, attemptLimit: 3, operation: "ordinary conversation creation" });
  }
}


/** Resolves active same-silo members and refuses a caller repeated in the requested peer list. */
async function _OrdinarySubjects(transaction: Prisma.TransactionClient, caller: ConversationCaller, participantRefs: readonly string[]): Promise<readonly string[] | null>
{
  if (!await _IsActiveConversationMember(transaction, caller))
    return null;
  const members = await transaction.orgMembership.findMany({ where: { id: { in: [...participantRefs] }, clusterTenant: caller.siloId, status: OrgMemberStatus.Active }, select: { id: true, subject: true } });
  if (members.length !== participantRefs.length || members.some(member => member.subject === caller.subjectId))
    return null;
  return [caller.subjectId, ...members.map(member => member.subject)];
}