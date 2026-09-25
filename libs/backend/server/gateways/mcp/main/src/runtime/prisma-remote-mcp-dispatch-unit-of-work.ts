import { Prisma, type PrismaClient } from "@prisma/client";

import type { McpToolInvocationTransactionParticipantFactory } from "@opencrane/backend/server/iam/authorization";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";
import type { McpToolCallResult } from "@opencrane/contracts";

import { PrismaMcpConnectionReadinessRepository } from "../connections/prisma-mcp-connection-readiness-repository";
import { PrismaMcpTaskToolInvocationLifecycleRepository } from "../mcp-tasks/prisma-mcp-task-tool-invocation-lifecycle";
import type { McpInvocationResultParticipantFactory } from "./mcp-invocation-result.types";
import { PrismaRemoteMcpDispatchRepository } from "./prisma-remote-mcp-dispatch-repository";
import { _RemoteMcpClaimLeaseMilliseconds } from "./remote-mcp-invocation-executor";
import type { RemoteMcpDispatchAuthority, RemoteMcpDispatchClaim, RemoteMcpDispatchClaimResult, RemoteMcpDispatchCommand } from "./remote-mcp-invocation.types";

/** Opens serializable transactions for server-mediated remote MCP claim and completion. */
export class PrismaRemoteMcpDispatchUnitOfWork implements RemoteMcpDispatchAuthority
{
	/** Claim duration that reserves bounded credential, provider, and completion work. */
	private readonly claimLeaseMilliseconds: number;

	/** Bind the root client, transaction participants, and remote request timeout policy. */
	constructor(private readonly prisma: PrismaClient, private readonly toolInvocations: McpToolInvocationTransactionParticipantFactory, private readonly invocationResults: McpInvocationResultParticipantFactory, requestTimeoutMilliseconds: number)
	{
		this.claimLeaseMilliseconds = _RemoteMcpClaimLeaseMilliseconds(requestTimeoutMilliseconds);
	}

	/** Claim the current connection and ToolInvocation before any Secret or provider access. */
	claim(command: RemoteMcpDispatchCommand): Promise<RemoteMcpDispatchClaimResult>
	{
		const prisma = this.prisma;
		const toolInvocations = this.toolInvocations;
		const invocationResults = this.invocationResults;
		const claimLeaseMilliseconds = this.claimLeaseMilliseconds;
		return ___DoWithTrace("mcp.remote_invocation.claim", {}, async function _TraceClaim(): Promise<RemoteMcpDispatchClaimResult>
		{
			return ___RunInPrismaUnitOfWork(prisma, async function _ClaimInTransaction(transaction): Promise<RemoteMcpDispatchClaimResult>
			{
				const tasks = new PrismaMcpTaskToolInvocationLifecycleRepository(transaction);
				const participant = toolInvocations.__ForTransaction(transaction, tasks);
				const results = invocationResults.__ForTransaction(transaction);
				const readiness = new PrismaMcpConnectionReadinessRepository(transaction);
				const repository = new PrismaRemoteMcpDispatchRepository(transaction, participant, readiness, results, claimLeaseMilliseconds);
				return repository.claim(command.target, command.workload);
			}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, operation: "remote MCP invocation claim", attemptLimit: 3, timeout: 10_000 });
		});
	}

	/** Save a checked provider result with its runtime and ToolInvocation terminal state. */
	completeSucceeded(claim: RemoteMcpDispatchClaim, result: McpToolCallResult): Promise<boolean>
	{
		return this._complete("mcp.remote_invocation.complete", function _Complete(repository) { return repository.completeSucceeded(claim, result); });
	}

	/** Save a failure proven before request dispatch. */
	completeFailed(claim: RemoteMcpDispatchClaim, failureCode: string): Promise<boolean>
	{
		return this._complete("mcp.remote_invocation.fail", function _Fail(repository) { return repository.completeFailed(claim, failureCode); });
	}

	/** Save manual recovery after the peer may have received the request. */
	completeAmbiguous(claim: RemoteMcpDispatchClaim, failureCode: string): Promise<boolean>
	{
		return this._complete("mcp.remote_invocation.recovery", function _Recover(repository) { return repository.completeAmbiguous(claim, failureCode); });
	}

	/** Close one remote invocation after its workflow reaches the final retry. */
	settleExhausted(target: RemoteMcpDispatchCommand["target"]): Promise<boolean>
	{
		return this._complete("mcp.remote_invocation.exhaustion", function _Exhaust(repository) { return repository.settleExhausted(target); });
	}

	/** Run one terminal transition with fresh transaction-scoped participants. */
	private _complete(spanName: string, work: (repository: PrismaRemoteMcpDispatchRepository) => Promise<boolean>): Promise<boolean>
	{
		const prisma = this.prisma;
		const toolInvocations = this.toolInvocations;
		const invocationResults = this.invocationResults;
		const claimLeaseMilliseconds = this.claimLeaseMilliseconds;
		return ___DoWithTrace(spanName, {}, async function _TraceCompletion(): Promise<boolean>
		{
			return ___RunInPrismaUnitOfWork(prisma, async function _CompleteInTransaction(transaction): Promise<boolean>
			{
				const tasks = new PrismaMcpTaskToolInvocationLifecycleRepository(transaction);
				const participant = toolInvocations.__ForTransaction(transaction, tasks);
				const results = invocationResults.__ForTransaction(transaction);
				const readiness = new PrismaMcpConnectionReadinessRepository(transaction);
				const repository = new PrismaRemoteMcpDispatchRepository(transaction, participant, readiness, results, claimLeaseMilliseconds);
				return work(repository);
			}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, operation: "remote MCP invocation completion", attemptLimit: 3, timeout: 10_000 });
		});
	}
}
