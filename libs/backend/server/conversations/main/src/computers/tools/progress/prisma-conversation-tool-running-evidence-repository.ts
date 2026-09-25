import { AgentRunState, McpExecutorCommandState, McpExecutorWorkloadState, McpRuntimeExecutionKind, Prisma } from "@prisma/client";

import { __AreRunInputSnapshotMcpToolsValid } from "@opencrane/backend/agents/execution/inputs";
import { __FindToolInvocationInTransaction, ExternalActionClaimKinds, ToolInvocationStates } from "@opencrane/backend/server/iam/authorization";
import { ConversationLogToolKinds, type RunInputSnapshotMcpTool } from "@opencrane/contracts";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { PrismaConversationToolDispatchAuthority } from "../dispatch/prisma-conversation-tool-dispatch-authority";
import type { ConversationToolDispatchDependencies } from "../dispatch/conversation-tool-dispatch.types";
import type { ConversationToolProgressNotificationEvidence, ConversationToolRunningNotificationCommand } from "../../turns/tool-progress-notifications/conversation-tool-progress-notification.types";
import type { ConversationToolRunningNotificationRepository } from "./conversation-tool-progress-notification-persistence.types";

/** Owns the exact SQL reads and current dispatch admission used by running publication. */
export class _PrismaConversationToolRunningNotificationRepository implements ConversationToolRunningNotificationRepository
{
	/** Exact transaction that owns every current claim and run delegate read. */
	private readonly _transaction: Prisma.TransactionClient;
	/** Supplies existing run, membership and IAM dispatch authorities. */
	private readonly _dependencies: ConversationToolDispatchDependencies;

	/** Keep every delegate and nested authority on the caller's exact transaction. */
	public constructor(transaction: Prisma.TransactionClient, dependencies: ConversationToolDispatchDependencies)
	{
		this._transaction = transaction;
		this._dependencies = dependencies;
	}

	/** Return durable display facts only while every execution, claim, run and workload coordinate remains current. */
	public async readCurrent(command: ConversationToolRunningNotificationCommand): Promise<ConversationToolProgressNotificationEvidence | null>
	{
		const clock = await this._transaction.mcpRuntimeClock.findUnique({ where: { singleton: 1 } });
		if (clock === null || Number.isNaN(clock.now.getTime()))
			throw new Error("Conversation tool running evidence requires the database clock");
		const now = clock.now;
		const execution = await this._transaction.mcpRuntimeExecution.findFirst({
			where: {
				id: command.executionId, siloId: command.siloId, kind: McpRuntimeExecutionKind.Invocation,
				toolInvocationId: command.invocationId, workloadState: McpExecutorWorkloadState.Registered,
				commandState: McpExecutorCommandState.Claimed, companionClaimFence: command.companionClaimFence,
				companionClaimExpiresAt: { gt: now }, toolInvocationClaimFence: command.toolClaim.fence,
				toolInvocationClaimRevision: command.toolClaim.revision, workloadUid: command.workload.workloadUid,
				podUid: command.workload.podUid,
			},
			select: { id: true, companionClaimExpiresAt: true },
		});
		if (execution === null || command.toolClaim.invocationId !== command.invocationId || command.toolClaim.kind !== ExternalActionClaimKinds.Dispatch)
			return null;
		const invocation = await __FindToolInvocationInTransaction(this._transaction, command.invocationId);
		if (invocation === null || invocation.id !== command.invocationId || invocation.siloId !== command.siloId
			|| invocation.runId !== command.runId || invocation.attempt !== command.attempt || invocation.mcpTaskId !== null
			|| invocation.toolInvocationId !== command.toolInvocationId || ___DigestCanonicalJson(invocation.requestIdentity as unknown as JsonValue) !== ___DigestCanonicalJson(command.requestIdentity as unknown as JsonValue)
			|| invocation.state !== ToolInvocationStates.Claimed || invocation.claimKind !== ExternalActionClaimKinds.Dispatch
			|| invocation.claimFence !== command.toolClaim.fence || invocation.revision !== command.toolClaim.revision
			|| invocation.claimExpiresAt === null || invocation.claimExpiresAt <= now)
			return null;
		const authority = new PrismaConversationToolDispatchAuthority(this._transaction, this._dependencies);
		const admission = await authority.admit(invocation, now, command.workload);
		if (admission === null || admission.conversationId !== command.conversationId)
			return null;
		const run = await this._transaction.agentRun.findFirst({
			where: { id: command.runId, siloId: command.siloId, attempt: command.attempt, state: AgentRunState.Running, conversationId: command.conversationId, agentRevisionId: invocation.agentRevisionId ?? undefined, agentIdentityId: admission.subject.agentIdentityId, principalId: admission.subject.principalId },
			select: { inputSnapshotDigest: true },
		});
		if (run === null)
			return null;
		const snapshot = await this._transaction.runInputSnapshot.findFirst({
			where: { runId: command.runId, attempt: command.attempt, siloId: command.siloId, conversationId: command.conversationId, digest: run.inputSnapshotDigest, agentRevisionId: invocation.agentRevisionId ?? undefined, agentIdentityId: admission.subject.agentIdentityId, principalId: admission.subject.principalId },
			select: { mcpTools: true },
		});
		const tools = snapshot?.mcpTools;
		if (!Array.isArray(tools) || !__AreRunInputSnapshotMcpToolsValid(tools as unknown as RunInputSnapshotMcpTool[]))
			return null;
		const matching = (tools as unknown as RunInputSnapshotMcpTool[]).filter(tool => tool.toolRevisionId === invocation.toolRevisionId);
		if (matching.length !== 1)
			return null;
		const row = await this._transaction.toolInvocation.findUnique({ where: { id: command.invocationId }, select: { createdAt: true } });
		if (row === null)
			return null;

		// Anchor elapsed time before the final database clock so leases cannot expire during the closing reads.
		const finalClockStarted = performance.now();
		const finalClock = await this._transaction.mcpRuntimeClock.findUnique({ where: { singleton: 1 } });
		if (finalClock === null || Number.isNaN(finalClock.now.getTime()))
			throw new Error("Conversation tool running evidence requires the database clock");
		const currentExecution = await this._transaction.mcpRuntimeExecution.findFirst({
			where: {
				id: command.executionId, siloId: command.siloId, kind: McpRuntimeExecutionKind.Invocation,
				toolInvocationId: command.invocationId, workloadState: McpExecutorWorkloadState.Registered,
				commandState: McpExecutorCommandState.Claimed, companionClaimFence: command.companionClaimFence,
				companionClaimExpiresAt: { gt: finalClock.now }, toolInvocationClaimFence: command.toolClaim.fence,
				toolInvocationClaimRevision: command.toolClaim.revision, workloadUid: command.workload.workloadUid,
				podUid: command.workload.podUid,
			},
			select: { id: true, companionClaimExpiresAt: true },
		});
		const currentInvocation = await __FindToolInvocationInTransaction(this._transaction, command.invocationId);
		const conservativeNow = finalClock.now.getTime() + Math.max(0, performance.now() - finalClockStarted);
		if (currentExecution === null || currentInvocation === null || currentInvocation.state !== ToolInvocationStates.Claimed
			|| currentInvocation.claimKind !== ExternalActionClaimKinds.Dispatch || currentInvocation.claimFence !== command.toolClaim.fence
			|| currentInvocation.revision !== command.toolClaim.revision || currentInvocation.claimExpiresAt === null
			|| currentExecution.companionClaimExpiresAt === null || currentExecution.companionClaimExpiresAt.getTime() <= conservativeNow
			|| currentInvocation.claimExpiresAt.getTime() <= conservativeNow || admission.notAfterEpochMs <= conservativeNow)
			return null;
		return {
			bootstrapId: command.requestIdentity.commandId, siloId: command.siloId, conversationId: command.conversationId,
			runId: command.runId, attempt: command.attempt, toolInvocationId: command.toolInvocationId,
			toolName: matching[0]!.name, toolKind: ConversationLogToolKinds.Mcp, occurredAt: row.createdAt.toISOString(),
		};
	}
}
