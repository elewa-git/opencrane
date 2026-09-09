import { ConversationLifecycle, ConversationMode, Prisma, type PrismaClient } from "@prisma/client";
import { ConversationLifecycles, ConversationModes } from "@opencrane/models/conversations";
import { ProductAuthorizationActions } from "@opencrane/models/authorization";
import type { ConversationCaller } from "../authorization/conversation-caller.types";
import { PrismaConversationProductAuthorizationRepository } from "../authorization/db/conversation-product-authorization";
import { _IsActiveConversationMember } from "../authorization/prisma-conversation-membership";
import { PrismaGroupChildAccessRepository } from "../children/db/prisma-group-child-access-repository";
import type { ConversationMetadataDetail, ConversationMetadataSummary, ConversationReviewCoordinates } from "./conversation-metadata.types";



/** Converts Prisma's generated mode values into the public conversation contract. */
const _CONVERSATION_MODES: Readonly<Record<ConversationMode, ConversationModes>> = { [ConversationMode.AgentSession]: ConversationModes.AgentSession, [ConversationMode.Direct]: ConversationModes.Direct, [ConversationMode.Group]: ConversationModes.Group };

/** Converts persisted lifecycle values without inventing an unknown fallback state. */
const _CONVERSATION_LIFECYCLES: Readonly<Record<ConversationLifecycle, ConversationLifecycles>> = { [ConversationLifecycle.Open]: ConversationLifecycles.Open, [ConversationLifecycle.Closed]: ConversationLifecycles.Closed };
/** Owns authorised metadata reads and their participant-facing projections. */
export class PrismaConversationMetadataReader
{
	/** Connects this owner to its transaction dependencies. */
	public constructor(private readonly prisma: PrismaClient) {}

  /** Lists only current participant projections after central Read filtering. */
  public list(
    caller: ConversationCaller,
    includeArchived: boolean,
  ): Promise<readonly ConversationMetadataSummary[]> {
    return this._read(async function _List(transaction) {
      if (!(await _IsActiveConversationMember(transaction, caller)))
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
      const visible = new Set<string>();
      for (const row of rows)
        if (ids.has(row.conversationId) && await new PrismaGroupChildAccessRepository(transaction).mayAccess(caller, row.conversationId))
          visible.add(row.conversationId);
      return rows
        .filter((row) => visible.has(row.conversationId))
        .map((row) => _Summary(row, references));
    });
  }
  /** Opens metadata only; messages stay empty because KurrentDB history owns entries. */
  public open(
    caller: ConversationCaller,
    conversationId: string,
  ): Promise<ConversationMetadataDetail | null> {
    return this._read(function _Open(transaction) {
      return _ReadConversationDetail(transaction, caller, conversationId);
    });
  }

	/** Releases exact computer history coordinates only for a current participant with central Read authority. */
	public reviewCoordinates(caller: ConversationCaller, conversationId: string, action: ProductAuthorizationActions = ProductAuthorizationActions.Read): Promise<ConversationReviewCoordinates | null>
	{
		return this._read(async function _ReviewCoordinates(transaction)
		{
			if (!await _IsActiveConversationMember(transaction, caller))
				return null;
			const row = await transaction.conversation.findFirst({ where: { id: conversationId, siloId: caller.siloId, mode: ConversationMode.AgentSession, lifecycle: ConversationLifecycle.Open, participants: { some: { userId: caller.subjectId, accessEndedPosition: null } } }, select: { computerId: true, computerAgentIdentityId: true, computerProfileRevisionId: true } });
			if (row === null || row.computerId === null || row.computerAgentIdentityId === null || row.computerProfileRevisionId === null)
				return null;
			const authorization = new PrismaConversationProductAuthorizationRepository(transaction);
			if (!await authorization.canAccess(caller, conversationId, action) || !await new PrismaGroupChildAccessRepository(transaction).mayAccess(caller, conversationId))
				return null;
			return { computerId: row.computerId, agentIdentityId: row.computerAgentIdentityId, profileRevisionId: row.computerProfileRevisionId };
		});
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

/** Loads one currently authorized participant detail. */
export async function _ReadConversationDetail(
  transaction: Prisma.TransactionClient,
  caller: ConversationCaller,
  conversationId: string,
): Promise<ConversationMetadataDetail | null> {
  if (!(await _IsActiveConversationMember(transaction, caller)) || !await new PrismaGroupChildAccessRepository(transaction).mayAccess(caller, conversationId))
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
    parent: await new PrismaGroupChildAccessRepository(transaction).origin(caller, conversationId),
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