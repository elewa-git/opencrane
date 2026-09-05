import { randomUUID } from "node:crypto";
import { ConversationLifecycle, ConversationMode, OrgMemberStatus, Prisma, type PrismaClient } from "@prisma/client";
import { ConversationLifecycles, ConversationModes } from "@opencrane/models/conversations";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { PrismaConversationProductAuthorizationRepository } from "./db/conversation-product-authorization";
import type { ConversationCaller } from "./types/conversation-caller.types";
import type { ConversationMetadataAuthority, ConversationMetadataDetail, ConversationMetadataSummary, InitialConversationComputerResolver } from "./conversation-metadata.types";

/** Projection-only PostgreSQL authority; participant entries never pass through this class. */
export class PrismaConversationMetadataUnitOfWork
  implements ConversationMetadataAuthority
{
  /** Creates the projection authority and its fail-closed agent-session resolver seam. */
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly initialComputer: InitialConversationComputerResolver,
  ) {}
  /** Returns opaque active membership references and no fabricated personal-agent mapping. */
  public directory(caller: ConversationCaller): Promise<unknown> {
    return this._read(async function _Directory(transaction) {
      if (!(await _Active(transaction, caller)))
        throw new Error("conversation directory unavailable");
      const rows = await transaction.orgMembership.findMany({
        where: { clusterTenant: caller.siloId, status: OrgMemberStatus.Active },
        select: { id: true, subject: true },
        orderBy: { id: "asc" },
      });
      const agents = await transaction.agentService.findMany({
        where: {
          siloId: caller.siloId,
          kind: "Personal",
          state: "Active",
          activeRevisionId: { not: null },
        },
        select: { id: true, name: true },
      });
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
        orderBy: { conversation: { activitySequence: "desc" } },
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
  /** Creates direct/group projections atomically and leaves agent-session creation fail-closed. */
  public async create(
    caller: ConversationCaller,
    request: unknown,
  ): Promise<ConversationMetadataDetail | null> {
    if (typeof request !== "object" || request === null)
return null;
    const value = request as Record<string, unknown>;
    if (value["mode"] === "agent_session")
{
      const conversationId = await this.initialComputer.resolve(
        caller,
        typeof value["personalAgentRef"] === "string"
          ? value["personalAgentRef"]
          : "",
      );
      return conversationId === null ? null : this.open(caller, conversationId);
    }
    if (
      (value["mode"] !== "direct" && value["mode"] !== "group") ||
      !Array.isArray(value["participantRefs"])
    )
      return null;
    const requestedRefs = value["participantRefs"];
    if (
      requestedRefs.some((ref) => typeof ref !== "string") ||
      new Set(requestedRefs).size !== requestedRefs.length ||
      requestedRefs.length < 1 ||
      (value["mode"] === "direct" && requestedRefs.length !== 1) ||
      requestedRefs.length > 99
    )
      return null;
    const prechecked = await this.prisma.$transaction(
	      async function _Precheck(transaction)
	      {
        if (!(await _Active(transaction, caller)))
return false;
        const callerMembership = await transaction.orgMembership.findUnique({
          where: {
            clusterTenant_subject: {
              clusterTenant: caller.siloId,
              subject: caller.subjectId,
            },
          },
          select: { id: true },
        });
        if (
          callerMembership === null ||
          requestedRefs.includes(callerMembership.id)
        )
          return false;
        const authorization =
          new PrismaConversationProductAuthorizationRepository(transaction);
        return authorization.admit(
          caller,
          {
            kind: ProductAuthorizationResourceKinds.ConversationCollection,
            id: caller.siloId,
          },
          ProductAuthorizationActions.Create,
          { mode: value["mode"] as "direct" | "group" },
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    if (!prechecked)
return null;
    const conversationId = randomUUID();
    await this.initialComputer.createOrdinaryGenesis(
      caller,
      conversationId,
      value["mode"],
    );
    return this.prisma.$transaction(
      async (transaction) => {
        if (!(await _Active(transaction, caller)))
return null;
        const selected = await transaction.orgMembership.findMany({
          where: {
            id: { in: requestedRefs as string[] },
            clusterTenant: caller.siloId,
            status: OrgMemberStatus.Active,
          },
          select: { id: true, subject: true },
        });
        if (selected.length !== requestedRefs.length)
return null;
        const authorization =
          new PrismaConversationProductAuthorizationRepository(transaction);
        if (
          !(await authorization.admit(
            caller,
            {
              kind: ProductAuthorizationResourceKinds.ConversationCollection,
              id: caller.siloId,
            },
            ProductAuthorizationActions.Create,
            { mode: value["mode"] as "direct" | "group" },
          ))
        )
          return null;
        const subjects = [
          caller.subjectId,
          ...selected.map((item) => item.subject),
        ];
        await transaction.conversation.create({
          data: {
            id: conversationId,
            siloId: caller.siloId,
            mode:
              value["mode"] === "direct"
                ? ConversationMode.Direct
                : ConversationMode.Group,
            participants: {
              create: subjects.map((subject) => ({
                userId: subject,
                visibleFromPosition: 1n,
                readThroughPosition: 0n,
              })),
            },
          },
        });
        await authorization.reconcileParticipants(
          caller.siloId,
          conversationId,
          subjects,
          caller.principalId,
          new Date(),
        );
        await authorization.reconcileCreator(
          caller.siloId,
          conversationId,
          caller.principalId,
          new Date(),
        );
        return _Detail(transaction, caller, conversationId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
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
    mode: row.conversation.mode as ConversationModes,
    lifecycle: row.conversation.lifecycle as ConversationLifecycles,
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
/** Resolves participant subjects to opaque active membership references inside the read transaction. */
async function _MembershipReferences(
  transaction: Prisma.TransactionClient,
  siloId: string,
  subjects: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const rows = await transaction.orgMembership.findMany({
    where: {
      clusterTenant: siloId,
      subject: { in: [...new Set(subjects)] },
      status: OrgMemberStatus.Active,
    },
    select: { id: true, subject: true },
  });
  if (rows.length !== new Set(subjects).size)
    throw new Error(
      "conversation participant membership projection is unavailable",
    );
  return new Map(rows.map((row) => [row.subject, row.id]));
}
