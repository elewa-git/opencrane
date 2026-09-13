import type { Prisma } from "@prisma/client";

import { ExternalActionClaimKinds, ToolInvocationCompletionOutcomes, ToolInvocationStates, type McpToolInvocationTransactionParticipant } from "@opencrane/backend/server/iam/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { McpInvocationCompletionCommand, McpInvocationCompletionRepository, McpInvocationResultParticipant } from "./mcp-invocation-result.types";

/** Saves terminal-safe invocation results through the same transaction as resource custody. */
export class PrismaMcpInvocationCompletionRepository implements McpInvocationCompletionRepository
{
	/** Keep IAM, the immutable tool lookup and the result consumer on the MCP completion transaction. */
	constructor(private readonly transaction: Prisma.TransactionClient, private readonly invocations: McpToolInvocationTransactionParticipant, private readonly results: McpInvocationResultParticipant) {}

	/** Revalidate the exact IAM claim, prepare its result, then require terminal persistence to succeed. */
	async complete(command: McpInvocationCompletionCommand, now: Date): Promise<boolean>
	{
		const invocation = await this.invocations.findById(command.toolClaim.invocationId);
		if (invocation === null || invocation.siloId !== command.siloId || invocation.state !== ToolInvocationStates.Claimed
			|| invocation.claimKind !== ExternalActionClaimKinds.Dispatch || command.toolClaim.kind !== ExternalActionClaimKinds.Dispatch
			|| invocation.claimFence !== command.toolClaim.fence || invocation.revision !== command.toolClaim.revision
			|| invocation.claimExpiresAt === null || invocation.claimExpiresAt <= now)
			return false;
		const tool = await this.transaction.mcpToolRevision.findFirst({ where: { id: invocation.toolRevisionId, siloId: command.siloId, serverRevisionId: command.serverRevisionId }, select: { name: true } });
		if (tool === null)
			return false;
		const prepared = await this.results.prepare({ ...command, invocation, toolName: tool.name });
		const result = prepared as unknown as JsonValue;
		const completedAt = new Date(Math.max(now.getTime(), Date.now()));
		if (completedAt >= invocation.claimExpiresAt || completedAt.getTime() >= command.companionNotAfterEpochMs)
			throw new Error("MCP invocation completion authority expired during result capture");
		const completed = await this.invocations.completeSucceeded(command.toolClaim, result, completedAt);
		// Capture may already have admitted bytes and an Absurd task. A losing result must undo them.
		if (completed.outcome === ToolInvocationCompletionOutcomes.Missing
			|| (completed.outcome === ToolInvocationCompletionOutcomes.Winner && (completed.invocation.state !== ToolInvocationStates.Succeeded
				|| completed.invocation.result === null || ___DigestCanonicalJson(completed.invocation.result) !== ___DigestCanonicalJson(result))))
			throw new Error("MCP invocation completion lost its result fence");
		return true;
	}
}
