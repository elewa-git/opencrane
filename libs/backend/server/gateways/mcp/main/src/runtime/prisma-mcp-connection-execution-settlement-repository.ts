import { McpExecutionTransport, McpExecutorCommandState, type Prisma } from "@prisma/client";

import { ToolInvocationStates, type McpToolInvocationTransactionParticipant } from "@opencrane/backend/server/iam/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { McpConnectionRecord } from "../connections/mcp-connection.types";
import type { RemoteMcpConnectionExecutionSettlementRepository } from "./remote-mcp-invocation.types";

/** Failure saved when revocation closes a remote invocation before dispatch. */
const _CONNECTION_REVOKED_BEFORE_DISPATCH = "mcp_connection_revoked_before_dispatch";

/** Applies connection cleanup fences within its caller's Prisma transaction. */
export class PrismaMcpConnectionExecutionSettlementRepository implements RemoteMcpConnectionExecutionSettlementRepository
{
	/** Use the transaction owned by the settlement unit of work. */
	constructor(private readonly transaction: Prisma.TransactionClient) {}

	/** Close Pending rows, while a Claimed row keeps credential cleanup waiting. */
	async isSettled(record: McpConnectionRecord, toolInvocations: McpToolInvocationTransactionParticipant): Promise<boolean>
	{
		const executions = await this.transaction.mcpRuntimeExecution.findMany({
			where: { transport: McpExecutionTransport.RemoteHttp, siloId: record.siloId, connectionId: record.id, connectionGeneration: record.generation, connectionOwnerPrincipalId: record.ownerPrincipalId, endpointDigest: record.endpointDigest, serverRevision: { mcpServerId: record.serverId } },
			select: { id: true, commandState: true, toolInvocationId: true },
		});
		if (executions.some(execution => execution.commandState === McpExecutorCommandState.Claimed))
			return false;
		const pending = executions.filter(execution => execution.commandState === McpExecutorCommandState.Pending);
		if (pending.length === 0)
			return true;
		const now = await this._DatabaseNow();
		for (const execution of pending)
		{
			if (execution.toolInvocationId === null)
				return false;
			const invocation = await toolInvocations.findById(execution.toolInvocationId);
			if (invocation === null)
				return false;
			const completed = await toolInvocations.completeUnusedBeforeDispatch(invocation.id, invocation.revision, _CONNECTION_REVOKED_BEFORE_DISPATCH, now);
			if (!completed.changed || completed.invocation?.state !== ToolInvocationStates.Failed)
				return false;
			const terminalPayloadDigest = ___DigestCanonicalJson({ failureCode: _CONNECTION_REVOKED_BEFORE_DISPATCH } as JsonValue);
			const updated = await this.transaction.mcpRuntimeExecution.updateMany({
				where: { id: execution.id, transport: McpExecutionTransport.RemoteHttp, commandState: McpExecutorCommandState.Pending, remoteClaimFence: null, toolInvocationClaimFence: null, toolInvocationClaimRevision: null },
				data: { commandState: McpExecutorCommandState.Failed, terminalOutcome: _CONNECTION_REVOKED_BEFORE_DISPATCH, terminalPayloadDigest, completedAt: now },
			});
			if (updated.count !== 1)
				throw new Error("remote MCP settlement lost its runtime transition");
		}
		const unsettled = await this.transaction.mcpRuntimeExecution.count({
			where: { transport: McpExecutionTransport.RemoteHttp, siloId: record.siloId, connectionId: record.id, connectionGeneration: record.generation, connectionOwnerPrincipalId: record.ownerPrincipalId, endpointDigest: record.endpointDigest, serverRevision: { mcpServerId: record.serverId }, commandState: { in: [McpExecutorCommandState.Pending, McpExecutorCommandState.Claimed] } },
		});
		return unsettled === 0;
	}

	/** Read database time for the unused-work terminal transition. */
	private async _DatabaseNow(): Promise<Date>
	{
		const clock = await this.transaction.mcpRuntimeClock.findUnique({ where: { singleton: 1 } });
		if (clock === null || Number.isNaN(clock.now.getTime()))
			throw new Error("MCP runtime database clock is unavailable");
		return clock.now;
	}
}
