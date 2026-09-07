import { AgentRevisionState, AgentServiceKind, AgentServiceState, ConversationLifecycle, ConversationMode, OrgMemberStatus, PersonaRevisionState, Prisma, type PrismaClient } from "@prisma/client";
import { ConversationLifecycles, ConversationModes } from "@opencrane/models/conversations";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";
import { _DeterministicUuid } from "./agent-session-identifiers";
import { _ParseOrdinaryConversationCreateCommand } from "./conversation-metadata.validator";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { PrismaConversationProductAuthorizationRepository } from "./db/conversation-product-authorization";
import type { ConversationCaller } from "./types/conversation-caller.types";
import type { ConversationMetadataAuthority, ConversationMetadataDetail, ConversationMetadataSummary, ConversationReviewCoordinates, InitialConversationComputerResolver } from "./conversation-metadata.types";

/** Converts Prisma's generated mode values into the public conversation contract. */
const _CONVERSATION_MODES: Readonly<Record<ConversationMode, ConversationModes>> = { [ConversationMode.AgentSession]: ConversationModes.AgentSession, [ConversationMode.Direct]: ConversationModes.Direct, [ConversationMode.Group]: ConversationModes.Group };
/** Converts persisted lifecycle values without inventing an unknown fallback state. */
const _CONVERSATION_LIFECYCLES: Readonly<Record<ConversationLifecycle, ConversationLifecycles>> = { [ConversationLifecycle.Open]: ConversationLifecycles.Open, [ConversationLifecycle.Closed]: ConversationLifecycles.Closed };

/** Projection-only PostgreSQL authority; participant entries never pass through this class. */
export class PrismaConversationMetadataUnitOfWork
  implements ConversationMetadataAuthority
{
  /** Creates the projection authority and its fail-closed agent-session resolver seam. */
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly initialComputer: InitialConversationComputerResolver,
  ) {}
  /**
   * Returns member references and the caller's readable personal assistant for conversation creation.
   * The caller's current approved persona selects candidates before authorization, so another
   * member's private assistant cannot hide or replace their own.
   * Called by: _CreateConversationMetadataRouter.
   * @param caller The signed-in identity resolved by the server for the selected silo.
   * @returns A ready assistant, or an unavailable or ambiguous state without an assistant reference.
   * @throws When the caller no longer has active organisation membership.
   * @see PrismaConversationProductAuthorizationRepository.canReadResources
   */
  public directory(caller: ConversationCaller): Promise<unknown>
  {
    return this._read(async function _Directory(transaction)
    {
      if (!(await _Active(transaction, caller)))
        throw new Error("conversation directory unavailable");
      const rows = await transaction.orgMembership.findMany({
        where: { clusterTenant: caller.siloId, status: OrgMemberStatus.Active },
        select: { id: true, subject: true, displayName: true },
        orderBy: { id: "asc" },
      });
      const persona = await transaction.personaProfile.findUnique({
        where: { siloId_userId: { siloId: caller.siloId, userId: caller.subjectId } },
        select: { activeRevision: { select: { id: true, state: true, approvedAt: true } } },
      });
      const revision = persona?.activeRevision;
      const agents = revision?.state === PersonaRevisionState.Approved && revision.approvedAt !== null
        ? await transaction.agentService.findMany({
            where: {
              siloId: caller.siloId,
              kind: AgentServiceKind.Personal,
              state: AgentServiceState.Active,
              activeRevisionId: { not: null },
              activeRevision: { is: { siloId: caller.siloId, state: AgentRevisionState.Published, personaRevisionId: revision.id } },
            },
            select: { id: true, name: true },
            orderBy: { id: "asc" },
            take: 2,
          }) : [];
      const authorization =
        new PrismaConversationProductAuthorizationRepository(transaction);
      const allReadable = await authorization.canReadResources(
        caller,
        agents.map((agent) => ({
          kind: ProductAuthorizationResourceKinds.AgentService,
          id: agent.id,
        })),
      );
      const available = allReadable ? agents : [];
      return {
        participants: rows.map((row) => ({
          participantRef: row.id,
          displayName: row.displayName?.trim() || "Unnamed member",
          isSelf: row.subject === caller.subjectId,
        })),
        personalAgentStatus: _PersonalAgentStatus(available.length),
        personalAgent:
          available.length === 1
            ? {
                personalAgentRef: available[0]!.id,
                displayName: available[0]!.name,
              }
            : null,
      };
    });
  }
  /** Lists only current participant projections after central Read filtering. */
  public list(
    caller: ConversationCaller,
    includeArchived: boolean,
  ): Promise<readonly ConversationMetadataSummary[]> {
    return this._read(async function _List(transaction) {
      if (!(await _Active(transaction, caller)))
        throw new Error("conversation list unavailable");
      const rows = await transaction.conversationParticipant.findMany({
        where: {
          userId: caller.subjectId,
          accessEndedPosition: null,
          ...(includeArchived ? {} : { archivedAt: null }),
          conversation: { siloId: caller.siloId },
        },
        include: { conversation: { include: { participants: true } } },
        // Newest participant-visible append first; the id keeps equal timestamps stable.
        orderBy: [{ conversation: { updatedAt: "desc" } }, { conversationId: "asc" }],
      });
      const authorization =
        new PrismaConversationProductAuthorizationRepository(transaction);
      const ids = await authorization.entitledIds(
        caller,
        rows.map((row) => row.conversationId),
        ProductAuthorizationActions.Read,
      );
      const references = await _MembershipReferences(
        transaction,
        caller.siloId,
        rows.flatMap((row) =>
          row.conversation.participants.map((item) => item.userId),
        ),
      );
      return rows
        .filter((row) => ids.has(row.conversationId))
        .map((row) => _Summary(row, references));
    });
  }
  /** Opens metadata only; messages stay empty because KurrentDB history owns entries. */
  public open(
    caller: ConversationCaller,
    conversationId: string,
  ): Promise<ConversationMetadataDetail | null> {
    return this._read(function _Open(transaction) {
      return _Detail(transaction, caller, conversationId);
    });
  }

	/** Releases exact computer history coordinates only for a current participant with central Read authority. */
	public reviewCoordinates(caller: ConversationCaller, conversationId: string, action: ProductAuthorizationActions = ProductAuthorizationActions.Read): Promise<ConversationReviewCoordinates | null>
	{
		return this._read(async function _ReviewCoordinates(transaction)
		{
			if (!await _Active(transaction, caller))
				return null;
			const row = await transaction.conversation.findFirst({ where: { id: conversationId, siloId: caller.siloId, mode: ConversationMode.AgentSession, lifecycle: ConversationLifecycle.Open, participants: { some: { userId: caller.subjectId, accessEndedPosition: null } } }, select: { computerId: true, computerAgentIdentityId: true, computerProfileRevisionId: true } });
			if (row === null || row.computerId === null || row.computerAgentIdentityId === null || row.computerProfileRevisionId === null)
				return null;
			const authorization = new PrismaConversationProductAuthorizationRepository(transaction);
			if (!await authorization.canAccess(caller, conversationId, action))
				return null;
			return { computerId: row.computerId, agentIdentityId: row.computerAgentIdentityId, profileRevisionId: row.computerProfileRevisionId };
		});
	}
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
      return conversationId === null ? null : this.open(caller, conversationId);
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
        return _Detail(transaction, caller, conversationId);
      }
      // 4. Only the insertion winner creates participant and creator grants in this transaction.
      await transaction.conversation.create({ data: { id: conversationId, siloId: caller.siloId, mode, participants: { create: subjects.map(subject => ({ userId: subject, visibleFromPosition: 1n, readThroughPosition: 0n })) } } });
      const now = new Date();
      await authorization.reconcileParticipants(caller.siloId, conversationId, subjects, caller.principalId, now);
      await authorization.reconcileCreator(caller.siloId, conversationId, caller.principalId, now);
      return _Detail(transaction, caller, conversationId);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, attemptLimit: 3, operation: "ordinary conversation creation" });
  }
  /** Changes only this participant's archive projection. */
  public archive(
    caller: ConversationCaller,
    conversationId: string,
    archived: boolean,
  ): Promise<ConversationMetadataDetail | null> {
    return this.prisma.$transaction(
      async (transaction) => {
        const current = await _Detail(transaction, caller, conversationId);
        const authorization =
          new PrismaConversationProductAuthorizationRepository(transaction);
        if (
          current === null ||
          !(await authorization.admit(
            caller,
            {
              kind: ProductAuthorizationResourceKinds.Conversation,
              id: conversationId,
            },
            ProductAuthorizationActions.Edit,
            { archived },
          ))
        )
          return null;
        await transaction.conversationParticipant.update({
          where: {
            conversationId_userId: { conversationId, userId: caller.subjectId },
          },
          data: { archivedAt: archived ? new Date() : null },
        });
        return _Detail(transaction, caller, conversationId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  /** Permanently closes an authorized conversation projection. */
  public close(
    caller: ConversationCaller,
    conversationId: string,
  ): Promise<ConversationMetadataDetail | null> {
    return this.prisma.$transaction(
      async (transaction) => {
        const authorization =
          new PrismaConversationProductAuthorizationRepository(transaction);
        if (
          !(await _Active(transaction, caller)) ||
          !(await authorization.admit(
            caller,
            {
              kind: ProductAuthorizationResourceKinds.Conversation,
              id: conversationId,
            },
            ProductAuthorizationActions.Delete,
            { lifecycle: "closed" },
          ))
        )
          return null;
        const changed = await transaction.conversation.updateMany({
          where: {
            id: conversationId,
            siloId: caller.siloId,
            lifecycle: ConversationLifecycle.Open,
            participants: {
              some: { userId: caller.subjectId, accessEndedPosition: null },
            },
          },
          data: {
            lifecycle: ConversationLifecycle.Closed,
            closedAt: new Date(),
          },
        });
        if (changed.count !== 1)
return null;
        return _Detail(transaction, caller, conversationId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  /** Runs one repeatable projection read. */
  private _read<Result>(
    work: (transaction: Prisma.TransactionClient) => Promise<Result>,
  ): Promise<Result> {
    return this.prisma.$transaction(work, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }
}

/** Resolves active same-silo members and refuses a caller repeated in the requested peer list. */
async function _OrdinarySubjects(transaction: Prisma.TransactionClient, caller: ConversationCaller, participantRefs: readonly string[]): Promise<readonly string[] | null>
{
  if (!await _Active(transaction, caller))
    return null;
  const members = await transaction.orgMembership.findMany({ where: { id: { in: [...participantRefs] }, clusterTenant: caller.siloId, status: OrgMemberStatus.Active }, select: { id: true, subject: true } });
  if (members.length !== participantRefs.length || members.some(member => member.subject === caller.subjectId))
    return null;
  return [caller.subjectId, ...members.map(member => member.subject)];
}

/** Checks current silo membership. */
async function _Active(
  transaction: Prisma.TransactionClient,
  caller: ConversationCaller,
): Promise<boolean> {
  return (
    (await transaction.orgMembership.count({
      where: {
        clusterTenant: caller.siloId,
        subject: caller.subjectId,
        status: OrgMemberStatus.Active,
      },
    })) === 1
  );
}
/** Loads one currently authorized participant detail. */
async function _Detail(
  transaction: Prisma.TransactionClient,
  caller: ConversationCaller,
  conversationId: string,
): Promise<ConversationMetadataDetail | null> {
  if (!(await _Active(transaction, caller)))
return null;
  const row = await transaction.conversationParticipant.findFirst({
    where: {
      conversationId,
      userId: caller.subjectId,
      accessEndedPosition: null,
      conversation: { siloId: caller.siloId },
    },
    include: { conversation: { include: { participants: true } } },
  });
  if (
    row === null ||
    !(await new PrismaConversationProductAuthorizationRepository(
      transaction,
    ).canAccess(caller, conversationId, ProductAuthorizationActions.Read))
  )
    return null;
  const references = await _MembershipReferences(
    transaction,
    caller.siloId,
    row.conversation.participants.map((item) => item.userId),
  );
  return {
    ..._Summary(row, references),
    visibleFromPosition: row.visibleFromPosition.toString(),
    accessEndedPosition: row.accessEndedPosition?.toString() ?? null,
  };
}
/** Maps one participant projection to the preserved frontend summary contract. */
function _Summary(
  row: {
    readonly archivedAt: Date | null;
    readonly readThroughPosition: bigint;
    readonly conversation: {
      readonly id: string;
      readonly mode: ConversationMode;
      readonly lifecycle: ConversationLifecycle;
      readonly agentServiceId: string | null;
      readonly updatedAt: Date;
      readonly participants: readonly { readonly userId: string }[];
    };
  },
  references: ReadonlyMap<string, string>,
): ConversationMetadataSummary {
  return {
    id: row.conversation.id,
    mode: _CONVERSATION_MODES[row.conversation.mode],
    lifecycle: _CONVERSATION_LIFECYCLES[row.conversation.lifecycle],
    agentServiceId: row.conversation.agentServiceId,
    participantRefs: row.conversation.participants
      .map((item) => references.get(item.userId)!)
      .filter(Boolean),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    readThroughPosition: row.readThroughPosition.toString(),
    updatedAt: row.conversation.updatedAt.toISOString(),
  };
}
/** Maps an exact authorized personal-agent count to the closed directory state. */
function _PersonalAgentStatus(
  count: number,
): "ready" | "unavailable" | "ambiguous" {
  if (count === 1)
return "ready";
  if (count === 0)
return "unavailable";
  return "ambiguous";
}
/** Resolves existing same-silo membership references, retaining suspended peers and omitting deleted rows. */
async function _MembershipReferences(
  transaction: Prisma.TransactionClient,
  siloId: string,
  subjects: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const rows = await transaction.orgMembership.findMany({
    where: {
      clusterTenant: siloId,
      subject: { in: [...new Set(subjects)] },
    },
    select: { id: true, subject: true },
  });
  return new Map(rows.map((row) => [row.subject, row.id]));
}
