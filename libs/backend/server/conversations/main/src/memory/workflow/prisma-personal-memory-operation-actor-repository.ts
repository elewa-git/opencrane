import { OrgMemberStatus, PrincipalProvenance, type Prisma } from "@prisma/client";

import type { ConversationCaller } from "../../authorization/conversation-caller.types";
import type { PersonalMemoryOperationActorResolver } from "./personal-memory-operation-authority.types";

/** Reads one exact external principal and organisation membership through a caller-owned transaction. */
export class PrismaPersonalMemoryOperationActorRepository implements PersonalMemoryOperationActorResolver
{
	/** Creates the actor reader inside one bounded unit-of-work attempt. */
	constructor(private readonly transaction: Prisma.TransactionClient) {}

	/** @inheritdoc */
	async resolve(siloId: string, actorPrincipalId: string): Promise<ConversationCaller | null>
	{
		const principal = await this.transaction.principal.findFirst({
			where: { id: actorPrincipalId, siloId, provenance: PrincipalProvenance.External },
			select: { id: true, issuer: true, subject: true },
		});
		if (principal === null || principal.issuer.trim().length === 0 || principal.subject.trim().length === 0)
			return null;
		const membership = await this.transaction.orgMembership.findUnique({
			where: { clusterTenant_subject: { clusterTenant: siloId, subject: principal.subject } },
			select: { status: true },
		});
		return membership?.status === OrgMemberStatus.Active
			? { siloId, principalId: principal.id, subjectId: principal.subject, externalIssuer: principal.issuer }
			: null;
	}
}
