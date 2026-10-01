import { OrgMemberStatus, type Prisma } from "@prisma/client";
import type { ConversationCaller } from "./conversation-caller.types";


/** Checks current silo membership. */
export async function _IsActiveConversationMember(
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