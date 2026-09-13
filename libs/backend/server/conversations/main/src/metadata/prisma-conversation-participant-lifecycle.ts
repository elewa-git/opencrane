import { ConversationLifecycle, Prisma, type PrismaClient } from "@prisma/client";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import type { ConversationCaller } from "../authorization/conversation-caller.types";
import { PrismaConversationProductAuthorizationRepository } from "../authorization/db/conversation-product-authorization";
import { _IsActiveConversationMember } from "../authorization/prisma-conversation-membership";
import { PrismaGroupChildAccessRepository } from "../children/db/prisma-group-child-access-repository";
import { _ReadConversationDetail } from "./prisma-conversation-metadata-reader";
import type { ConversationMetadataDetail } from "./conversation-metadata.types";

/** Owns participant archiving and conversation closure within their authorised write snapshots. */
export class PrismaConversationParticipantLifecycleUnitOfWork
{
	/** Connects this owner to its transaction dependencies. */
	public constructor(private readonly prisma: PrismaClient) {}

  /** Changes only this participant's archive projection. */
  public archive(
    caller: ConversationCaller,
    conversationId: string,
    archived: boolean,
  ): Promise<ConversationMetadataDetail | null> {
    return this.prisma.$transaction(
      async (transaction) => {
        const current = await _ReadConversationDetail(transaction, caller, conversationId);
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
        return _ReadConversationDetail(transaction, caller, conversationId);
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
          !(await _IsActiveConversationMember(transaction, caller)) ||
          !(await new PrismaGroupChildAccessRepository(transaction).mayAccess(caller, conversationId)) ||
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
        return _ReadConversationDetail(transaction, caller, conversationId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
