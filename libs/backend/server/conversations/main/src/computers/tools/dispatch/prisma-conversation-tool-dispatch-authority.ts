import type { Prisma } from "@prisma/client";

import type { ToolInvocationRecord, ProductAuthorizationWorkloadContext } from "@opencrane/backend/server/iam/authorization";

import { PrismaConversationComputerLifecycleProjectionRepository } from "../../lifecycle/db/prisma-conversation-computer-lifecycle-projection-repository";
import { ConversationToolComputerEvidenceReader } from "./conversation-tool-computer-evidence";
import type { ConversationToolDispatchAdmission, ConversationToolDispatchAuthority, ConversationToolDispatchDependencies, ConversationToolExecutionAdmissionAuthority, ConversationToolSystemExecutionAdmissionAuthority } from "./conversation-tool-dispatch.types";
import type { ConversationToolAuthorizationActor } from "./conversation-tool-dispatch-evidence.types";
import { PrismaConversationToolAccessAuthority } from "./prisma-conversation-tool-access";
import { PrismaConversationToolRunEvidenceRepository } from "./prisma-conversation-tool-run-evidence";

/**
 * Rechecks permission when a tool is proposed, claimed by an executor, or read after completion.
 *
 * All database checks and audit writes use the caller's transaction. Missing or inactive facts
 * refuse the operation; history failures throw so that transaction rolls back. The identity or
 * lease can still change in KurrentDB after these reads; the PostgreSQL transaction cannot prevent that.
 */
export class PrismaConversationToolDispatchAuthority implements ConversationToolDispatchAuthority, ConversationToolExecutionAdmissionAuthority, ConversationToolSystemExecutionAdmissionAuthority
{
	/** Keep the existing transaction and installation-selected membership readers. */
	public constructor(private readonly transaction: Prisma.TransactionClient, private readonly dependencies: ConversationToolDispatchDependencies) {}

	/** Return the earliest permission expiry, or null when any required check refuses the operation. */
	public async admitUntil(invocation: ToolInvocationRecord, now: Date, workload: ProductAuthorizationWorkloadContext): Promise<number | null>
	{
		const admission = await this.admit(invocation, now, workload);
		return admission?.notAfterEpochMs ?? null;
	}

	/** Reuse the exact dispatch checks before another owner accepts a result under this run. */
	public async admit(invocation: ToolInvocationRecord, now: Date, workload: ProductAuthorizationWorkloadContext): Promise<ConversationToolDispatchAdmission | null>
	{
		return this._Admit(invocation, now, { actorKind: "workload", actorId: workload.podUid, workload });
	}

	/** Reuse the same checks for a fixed in-process workflow after its external worker exits. */
	public async admitSystem(invocation: ToolInvocationRecord, now: Date, actorId: string): Promise<ConversationToolDispatchAdmission | null>
	{
		if (!_SystemActor(actorId))
			throw new Error("Conversation tool system actor is invalid");
		return this._Admit(invocation, now, { actorKind: "system", actorId });
	}

	/** Evaluate all current run, computer, membership and tool evidence for one physical actor. */
	private async _Admit(invocation: ToolInvocationRecord, now: Date, actor: ConversationToolAuthorizationActor): Promise<ConversationToolDispatchAdmission | null>
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
		const accessAdmission = await access.admitUntil(run, computer.identity, actor, decisionTime);
		if (accessAdmission === null)
			return null;

		const expiresAt = Math.min(
			run.deadlineEpochMs, computer.leaseExpiresAtEpochMs, accessAdmission.notAfterEpochMs,
			Date.parse(run.subject.membership.trustedUntil), Date.parse(run.subject.requester.membership.trustedUntil),
		);
		const checkedAt = Math.max(now.getTime(), Date.now());
		if (!Number.isSafeInteger(expiresAt) || expiresAt <= checkedAt)
			return null;
		return { conversationId: run.conversationId, requesterSubjectId: accessAdmission.requesterSubjectId, identity: computer.identity, subject: run.subject, notAfterEpochMs: expiresAt };
	}
}

/** Require a bounded versioned server profile rather than request-selected identity text. */
function _SystemActor(value: string): boolean
{
	return /^opencrane-server\/[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9][0-9]*$/u.test(value);
}
