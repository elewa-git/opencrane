import { McpTaskState, Prisma, ToolInvocationState } from "@prisma/client";

import { __PlanToolInvocationLifecycle } from "./tool-invocation-lifecycle";
import { TOOL_INVOCATION_PREPARATION_POLICY, ToolInvocationLifecycleActions, ToolInvocationLifecycleEvents } from "./tool-invocation-lifecycle.types";
import { PrismaToolInvocationRepository } from "./prisma-tool-invocation-repository";
import type { McpUnusedToolInvocationRepository } from "./mcp-tool-invocation-participant.types";
import type { ToolInvocationTransitionResult } from "./tool-invocation.types";

/**
 * Fails a task-owned Ready invocation under the revision observed by the MCP workflow transaction.
 *
 * Provider-claimed and non-task invocations remain unchanged. The MCP participant uses the returned
 * `changed` value to decide whether it must update the task row in the same transaction.
 *
 * Called by: {@link PrismaMcpToolInvocationParticipantUnitOfWork.completeUnusedBeforeDispatch}.
 */
export class PrismaMcpUnusedToolInvocationRepository implements McpUnusedToolInvocationRepository
{
	/** Prisma client for the MCP runtime's open serializable transaction. */
	private readonly _transaction: Prisma.TransactionClient;
	/** Existing reader that returns the authorization package's stable record shape. */
	private readonly _toolInvocations: PrismaToolInvocationRepository;

	/** Bind the narrow MCP workflow transition to the caller-owned transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
		this._toolInvocations = new PrismaToolInvocationRepository(this._transaction);
	}

	/** Fail exact Ready work only when its revision and task projection still match. */
	async complete(invocationId: string, expectedRevision: number, failureCode: string, now: Date): Promise<ToolInvocationTransitionResult>
	{
		const invocation = await this._toolInvocations.findById(invocationId);
		if (invocation === null)
			return { changed: false, invocation: null };
		const action = __PlanToolInvocationLifecycle({ state: invocation.state, event: ToolInvocationLifecycleEvents.UnusedBeforeDispatch, recoveryMode: invocation.recoveryMode, claimKind: invocation.claimKind, preparationAttempt: invocation.preparationAttempt, preparationAttemptLimit: TOOL_INVOCATION_PREPARATION_POLICY.attemptLimit, withinPreparationDeadline: invocation.retryDeadlineAt.getTime() >= now.getTime() });
		if (action !== ToolInvocationLifecycleActions.Fail || invocation.mcpTaskId === null)
			return { changed: false, invocation };
		const safeFailureCode = /^[a-z][a-z0-9_]{0,63}$/u.test(failureCode) ? failureCode : "external_action_failed";
		const updated = await this._transaction.toolInvocation.updateMany({
			where: { id: invocationId, mcpTaskId: invocation.mcpTaskId, state: ToolInvocationState.Ready, revision: expectedRevision, claimKind: null, claimExpiresAt: null, mcpTask: { is: { state: McpTaskState.Queued } } },
			data: { state: ToolInvocationState.Failed, failureCode: safeFailureCode, completedAt: now, revision: { increment: 1 } },
		});
		return { changed: updated.count === 1, invocation: await this._toolInvocations.findById(invocationId) };
	}
}
