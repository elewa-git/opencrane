import { AgentRunState, type Prisma } from "@prisma/client";

import { __FindToolInvocationInTransaction, __MarkToolInvocationApprovalRejectedInTransaction, __MarkToolInvocationApprovedInTransaction } from "./tool-invocation-transaction";
import type { ApproveElicitedToolInvocationCommand, RejectElicitedToolInvocationCommand, ToolInvocationElicitationRepository } from "./tool-invocation-elicitation-authority.types";
import { ExternalActionClaimKinds, ToolInvocationStates } from "./tool-invocation-lifecycle.types";
import type { ToolInvocationClaim, ToolInvocationRecord } from "./tool-invocation.types";

/** Authorization-owned invocation checks and transitions bound to one Prisma transaction. */
export class PrismaToolInvocationElicitationRepository implements ToolInvocationElicitationRepository
{
	/** Existing transaction shared with the elicitation response or permission check. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Bind lifecycle decisions to the caller's serializable transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
	}

	/** Load one exact invocation through the canonical authorization projection. */
	findById(invocationId: string): Promise<ToolInvocationRecord | null>
	{
		return __FindToolInvocationInTransaction(this._transaction, invocationId);
	}

	/** Advance one exact awaiting invocation through the canonical lifecycle planner. */
	approve(command: ApproveElicitedToolInvocationCommand): Promise<boolean>
	{
		return __MarkToolInvocationApprovedInTransaction(this._transaction, command.invocationId, command.expectedArguments, command.expectedArgumentsDigest, command.effectiveArguments, command.effectiveArgumentsDigest);
	}

	/** Terminalise one exact rejection through the canonical lifecycle and delivery owner. */
	reject(command: RejectElicitedToolInvocationCommand): Promise<boolean>
	{
		return __MarkToolInvocationApprovalRejectedInTransaction(this._transaction, command.invocationId, command.now, command.failureCode);
	}

	/** Re-read the single persisted claim row and match every dispatch fence. */
	async verifyActiveDispatchClaim(invocation: ToolInvocationRecord, claim: ToolInvocationClaim, now: Date): Promise<boolean>
	{
		if (invocation.runId === null || invocation.attempt === null)
			return false;
		const current = await this.findById(claim.invocationId);
		if (current === null) return false;
		const run = await this._transaction.agentRun.findUnique({ where: { id: invocation.runId }, select: { attempt: true, state: true } });
		return run !== null
			&& run.attempt === invocation.attempt
			&& run.state === AgentRunState.Running
			&& claim.invocationId === invocation.id
			&& claim.kind === ExternalActionClaimKinds.Dispatch
			&& claim.kind === invocation.claimKind
			&& claim.fence === invocation.claimFence
			&& claim.revision === invocation.revision
			&& current.id === invocation.id
			&& current.runId === invocation.runId
			&& current.attempt === invocation.attempt
			&& current.subjectId === invocation.subjectId
			&& current.toolInvocationId === invocation.toolInvocationId
			&& current.toolRevisionId === invocation.toolRevisionId
			&& current.requestFingerprint === invocation.requestFingerprint
			&& current.effectiveArgumentsDigest === invocation.effectiveArgumentsDigest
			&& current.state === ToolInvocationStates.Claimed
			&& current.claimKind === ExternalActionClaimKinds.Dispatch
			&& current.claimFence === claim.fence
			&& current.revision === claim.revision
			&& current.claimExpiresAt !== null
			&& current.claimExpiresAt.getTime() > now.getTime();
	}
}
