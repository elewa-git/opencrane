import { randomUUID } from "node:crypto";

import { McpRuntimeExecutionKind, type Prisma } from "@prisma/client";

import { RuntimeWorkloadClaimClasses } from "@opencrane/backend/agents/runtime/workloads/contract";
import { ExternalActionRecoveryModes, ToolInvocationStates, type McpToolInvocationTransactionParticipant } from "@opencrane/backend/server/iam/authorization";

import { _MCP_CONNECTION_UNAVAILABLE, _McpConnectionOwnerPrincipalId } from "../connections/mcp-connection-readiness";
import type { McpConnectionReadiness } from "../connections/mcp-connection-readiness.types";
import { McpRuntimeExecutionKinds } from "./mcp-runtime.types";
import type { McpRuntimeAuthorityOptions, McpToolInvocationAdmissionRepository } from "./mcp-runtime.types";

/**
 * Persists ready authorization-owned MCP invocations as runtime executions.
 *
 * `PrismaMcpRuntimeUnitOfWork` creates this repository inside the same serializable transaction as
 * its authorization participant. That pairing keeps the readiness check and execution creation in
 * one database decision.
 * @implements {McpToolInvocationAdmissionRepository}
 */
export class PrismaMcpToolInvocationAdmissionRepository implements McpToolInvocationAdmissionRepository
{
	/** Transaction shared with the authorization-owned invocation participant. */
	private readonly _transaction: Prisma.TransactionClient;
	/** Authorization operations bound to this exact transaction. */
	private readonly _toolInvocations: Pick<McpToolInvocationTransactionParticipant, "findById" | "completeUnusedBeforeDispatch">;
	/** Current installation readiness bound to the admission transaction. */
	private readonly _connectionReadiness: McpConnectionReadiness;
	/** Fixed deployment policy for newly admitted MCP work. */
	private readonly _options: McpRuntimeAuthorityOptions;

	/** Binds invocation admission to one serializable MCP transaction. */
	constructor(transaction: Prisma.TransactionClient, toolInvocations: Pick<McpToolInvocationTransactionParticipant, "findById" | "completeUnusedBeforeDispatch">, connectionReadiness: McpConnectionReadiness, options: McpRuntimeAuthorityOptions)
	{
		this._transaction = transaction;
		this._toolInvocations = toolInvocations;
		this._connectionReadiness = connectionReadiness;
		this._options = options;
	}

	/**
	 * Recovers matching executor work or admits one ready, manual-recovery MCP ToolInvocation.
	 *
	 * An existing execution must match the silo, invocation, server revision, profile and idempotency
	 * key. Recovery acknowledges that saved work without resetting its state. New work also requires
	 * a published active server, a ready revision and manual recovery; the companion rechecks current
	 * dispatch authority before receiving a command.
	 * Called by: PrismaMcpRuntimeUnitOfWork and the app-composed conversation proposal transaction.
	 * @see McpToolInvocationAdmissionRepository
	 *
	 * @param toolInvocationRowId - Authorization-owned invocation row selected for admission.
	 * @returns The admission result that tells the authority whether work was created, already exists, or is blocked.
	 */
	async admitInvocation(toolInvocationRowId: string): Promise<"admitted" | "idempotent" | "not_ready" | "not_mcp">
	{
		const invocation = await this._toolInvocations.findById(toolInvocationRowId);
		if (invocation === null || invocation.siloId !== this._options.siloId)
			return "not_mcp";
		const existing = await this._transaction.mcpRuntimeExecution.findUnique({ where: { toolInvocationId: invocation.id }, select: { siloId: true, kind: true, toolInvocationId: true, serverRevisionId: true, profileName: true, idempotencyKey: true } });

		const tool = await this._transaction.mcpToolRevision.findFirst({ where: { id: invocation.toolRevisionId, siloId: invocation.siloId }, select: { serverRevisionId: true } });
		if (tool === null)
			return "not_mcp";
		if (existing !== null)
			return existing.siloId === invocation.siloId && existing.kind === McpRuntimeExecutionKind.Invocation
				&& existing.toolInvocationId === invocation.id && existing.serverRevisionId === tool.serverRevisionId
				&& existing.profileName === this._options.profileName && existing.idempotencyKey === `mcp-invocation:${invocation.id}` ? "idempotent" : "not_mcp";
		if (invocation.state !== ToolInvocationStates.Ready
			|| invocation.recoveryMode !== ExternalActionRecoveryModes.Manual)
			return "not_ready";
		const ownerPrincipalId = _McpConnectionOwnerPrincipalId(invocation);
		const ready = ownerPrincipalId !== null && await this._connectionReadiness.isReady({ siloId: invocation.siloId, toolRevisionId: invocation.toolRevisionId, ownerPrincipalId });
		if (!ready)
		{
			if (invocation.mcpTaskId !== null)
				await this._toolInvocations.completeUnusedBeforeDispatch(invocation.id, invocation.revision, _MCP_CONNECTION_UNAVAILABLE, new Date());
			return "not_ready";
		}

		await this._transaction.mcpRuntimeExecution.create({
			data: {
				siloId: invocation.siloId,
				serverRevisionId: tool.serverRevisionId,
				toolInvocationId: invocation.id,
				kind: McpRuntimeExecutionKind.Invocation,
				idempotencyKey: `mcp-invocation:${invocation.id}`,
				executionReference: `mcp-execution-v1_${randomUUID()}`,
				profileName: this._options.profileName,
			},
			select: { id: true },
		});
		this._options.log.info({ siloId: invocation.siloId, toolInvocationId: invocation.id, workloadClass: RuntimeWorkloadClaimClasses.McpExecutor, executionKind: McpRuntimeExecutionKinds.Invocation }, "admitted MCP tool invocation into durable execution");
		return "admitted";
	}
}
