import { OrgMemberStatus, type Prisma } from "@prisma/client";

import type { ElicitationConversationAccess } from "@opencrane/backend/agents/execution/elicitation";

import { PrismaGroupChildAccessRepository } from "./prisma-group-child-access-repository";

/**
 * Applies the existing child-sharing policy to ordinary assistant questions.
 * Browser composition injects this adapter into elicitation's own transaction, avoiding a reverse
 * dependency from elicitation to conversations. It neither adds participants nor grants access.
 */
export class PrismaConversationElicitationAccessRepository implements ElicitationConversationAccess
{
	/** Receives the transaction already reading or resolving the participant's request. */
	public constructor(private readonly transaction: Prisma.TransactionClient) {}

	/** Require current membership and exact participation before checking the saved child audience. */
	public async canAccess(siloId: string, subjectId: string, conversationId: string): Promise<boolean>
	{
		const membership = await this.transaction.orgMembership.count({ where: { clusterTenant: siloId, subject: subjectId, status: OrgMemberStatus.Active } });
		if (membership !== 1)
			return false;
		const participant = await this.transaction.conversationParticipant.findFirst({ where: { conversationId, userId: subjectId, accessEndedPosition: null, conversation: { siloId } }, select: { userId: true } });
		if (participant === null)
			return false;
		const principals = await this.transaction.principal.findMany({ where: { siloId, subject: subjectId }, select: { id: true }, take: 2 });
		if (principals.length !== 1)
			return false;
		const caller = { siloId, subjectId, principalId: principals[0]!.id };
		const access = new PrismaGroupChildAccessRepository(this.transaction);
		return access.mayAccess(caller, conversationId);
	}
}
