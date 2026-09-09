import type { Prisma } from "@prisma/client";

import type { ToolInvocationRecord, ProductAuthorizationWorkloadContext } from "@opencrane/backend/server/iam/authorization";

import { PrismaConversationComputerLifecycleProjectionRepository } from "../../../db/prisma-conversation-computer-lifecycle-projection-repository";
import { ConversationToolComputerEvidenceReader } from "./conversation-tool-computer-evidence";
import type { ConversationToolDispatchAuthority, ConversationToolDispatchDependencies } from "./conversation-tool-dispatch.types";
import { PrismaConversationToolAccessAuthority } from "./prisma-conversation-tool-access";
import { PrismaConversationToolRunEvidenceRepository } from "./prisma-conversation-tool-run-evidence";

/**
 * Rechecks permission when a tool is proposed, claimed by an executor, or read after completion.
 *
 * All database checks and audit writes use the caller's transaction. Missing or inactive facts
 * refuse the operation; history failures throw so that transaction rolls back. The identity or
 * lease can still change in KurrentDB after these reads; the PostgreSQL transaction cannot prevent that.
 */
export class PrismaConversationToolDispatchAuthority implements ConversationToolDispatchAuthority
{
	/** Keep the existing transaction and installation-selected membership readers. */
	public constructor(private readonly transaction: Prisma.TransactionClient, private readonly dependencies: ConversationToolDispatchDependencies) {}

	/** Return the earliest permission expiry, or null when any required check refuses the operation. */
	public async admitUntil(invocation: ToolInvocationRecord, now: Date, workload: ProductAuthorizationWorkloadContext): Promise<number | null>
	{
		const runs = new PrismaConversationToolRunEvidenceRepository(this.transaction);
		const run = await runs.load(invocation, now);
		if (run === null)
			return null;

		const projection = new PrismaConversationComputerLifecycleProjectionRepository(this.transaction);
		const computers = new ConversationToolComputerEvidenceReader(projection, this.dependencies);
		const computer = await computers.load(run, now);
		if (computer === null)
			return null;

		// History reads may take time. Permissions must be checked against the later server time.
		const decisionTime = Math.max(now.getTime(), Date.now());
		const access = new PrismaConversationToolAccessAuthority(this.transaction, this.dependencies);
		const membershipExpiresAt = await access.admitUntil(run, computer.identity, workload, decisionTime);
		if (membershipExpiresAt === null)
			return null;

		const expiresAt = Math.min(
			run.deadlineEpochMs, computer.leaseExpiresAtEpochMs, membershipExpiresAt,
			Date.parse(run.subject.membership.trustedUntil), Date.parse(run.subject.requester.membership.trustedUntil),
		);
		const checkedAt = Math.max(now.getTime(), Date.now());
		return Number.isSafeInteger(expiresAt) && expiresAt > checkedAt ? expiresAt : null;
	}
}
