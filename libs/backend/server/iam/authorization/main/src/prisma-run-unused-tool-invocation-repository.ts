import { AgentRunState, Prisma, ToolInvocationState, ToolResultDeliveryState } from "@prisma/client";

import { __DigestCanonicalJson } from "./canonical-json-digest";
import { __PlanToolInvocationLifecycle } from "./tool-invocation-lifecycle";
import { TOOL_INVOCATION_PREPARATION_POLICY, ToolInvocationLifecycleActions, ToolInvocationLifecycleEvents } from "./tool-invocation-lifecycle.types";
import { PrismaToolInvocationRepository } from "./prisma-tool-invocation-repository";
import type { RunUnusedToolInvocationRepository } from "./mcp-tool-invocation-participant.types";
import type { ToolInvocationRecord, ToolInvocationTransitionResult } from "./tool-invocation.types";

/** Safe terminal reason for a queued call whose current authority no longer permits dispatch. */
export const _RUN_TOOL_DISPATCH_DENIED = "tool_dispatch_authority_denied";

/**
 * Closes run-owned work before any provider claim and saves its failure delivery atomically.
 *
 * The Ready revision and current run attempt must still match. Claimed, task-owned and stale work
 * remains untouched. The MCP participant checks the lifecycle fence only when this write wins;
 * the current reporter does not persist a run event.
 * Called by: PrismaMcpToolInvocationParticipantUnitOfWork.claim.
 */
export class PrismaRunUnusedToolInvocationRepository implements RunUnusedToolInvocationRepository
{
	/** Bind writes to the serializable transaction opened by the MCP runtime. */
	public constructor(private readonly transaction: Prisma.TransactionClient) {}

	/** Fail the observed Ready revision and return the durable winner after a concurrent change. */
	public async complete(invocation: ToolInvocationRecord, now: Date): Promise<ToolInvocationTransitionResult>
	{
		const action = __PlanToolInvocationLifecycle({ state: invocation.state, event: ToolInvocationLifecycleEvents.UnusedBeforeDispatch, recoveryMode: invocation.recoveryMode, claimKind: invocation.claimKind, preparationAttempt: invocation.preparationAttempt, preparationAttemptLimit: TOOL_INVOCATION_PREPARATION_POLICY.attemptLimit, withinPreparationDeadline: invocation.retryDeadlineAt.getTime() >= now.getTime() });
		if (action !== ToolInvocationLifecycleActions.Fail || invocation.mcpTaskId !== null || invocation.runId === null || invocation.attempt === null)
			return { changed: false, invocation };
		const updated = await this.transaction.toolInvocation.updateMany({
			where: { id: invocation.id, runId: invocation.runId, attempt: invocation.attempt, mcpTaskId: null, state: ToolInvocationState.Ready, revision: invocation.revision, claimKind: null, claimExpiresAt: null, run: { is: { attempt: invocation.attempt, state: AgentRunState.Running } } },
			data: { state: ToolInvocationState.Failed, failureCode: _RUN_TOOL_DISPATCH_DENIED, completedAt: now, revision: { increment: 1 } },
		});
		if (updated.count === 1)
		{
			const payload = { toolInvocationId: invocation.toolInvocationId, outcome: "failed", failureCode: _RUN_TOOL_DISPATCH_DENIED } as const;
			await this.transaction.toolResultDelivery.create({ data: { toolInvocationId: invocation.id, state: ToolResultDeliveryState.Pending, payload, payloadDigest: __DigestCanonicalJson(payload), createdAt: now } });
		}
		const repository = new PrismaToolInvocationRepository(this.transaction);
		return { changed: updated.count === 1, invocation: await repository.findById(invocation.id) };
	}
}
