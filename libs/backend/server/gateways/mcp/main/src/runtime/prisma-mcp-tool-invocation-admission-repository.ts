import { randomUUID } from "node:crypto";

import { McpApprovalStatus, McpRuntimeExecutionKind, McpServerRevisionState, McpServerStatus, type Prisma } from "@prisma/client";

import { RuntimeWorkloadClaimClasses } from "@opencrane/backend/agents/runtime/workloads/contract";
import { ExternalActionRecoveryModes, ToolInvocationStates, type McpToolInvocationTransactionParticipant } from "@opencrane/backend/server/iam/authorization";

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
	private readonly _toolInvocations: McpToolInvocationTransactionParticipant;
	/** Fixed deployment policy for newly admitted MCP work. */
	private readonly _options: McpRuntimeAuthorityOptions;

	/** Binds invocation admission to one serializable MCP transaction. */
	constructor(transaction: Prisma.TransactionClient, toolInvocations: McpToolInvocationTransactionParticipant, options: McpRuntimeAuthorityOptions)
	{
		this._transaction = transaction;
		this._toolInvocations = toolInvocations;
		this._options = options;
	}

	/**
	 * Admits one ready, manual-recovery MCP ToolInvocation into runtime work.
	 *
	 * A disabled server, an unready revision, or another recovery mode returns `not_ready`; an
	 * existing execution is idempotent only when it names the same server revision. This prevents an
	 * invocation from being dispatched under a different revision than the one authorization selected.
	 * Called by: `PrismaMcpRuntimeUnitOfWork` through {@link McpToolInvocationAdmissionRepository}.
	 *
	 * @param toolInvocationRowId - Authorization-owned invocation row selected for admission.
	 * @returns The admission result that tells the authority whether work was created, already exists, or is blocked.
	 */
	async admitInvocation(toolInvocationRowId: string): Promise<"admitted" | "idempotent" | "not_ready" | "not_mcp">
	{
		const invocation = await this._toolInvocations.findById(toolInvocationRowId);
		if (invocation === null || invocation.siloId !== this._options.siloId)
			return "not_mcp";
		const existing = await this._transaction.mcpRuntimeExecution.findUnique({ where: { toolInvocationId: invocation.id }, select: { id: true, serverRevisionId: true } });

		const tool = await this._transaction.mcpToolRevision.findFirst({
			where: { id: invocation.toolRevisionId, siloId: invocation.siloId },
			select: {
				serverRevisionId: true,
				serverRevision: { select: { state: true, server: { select: { status: true, approvalStatus: true } } } },
			},
		});
		if (tool === null)
			return "not_mcp";
		if (invocation.state !== ToolInvocationStates.Ready
			|| invocation.recoveryMode !== ExternalActionRecoveryModes.Manual
			|| tool.serverRevision.state !== McpServerRevisionState.Ready
			|| tool.serverRevision.server.status !== McpServerStatus.Active
			|| tool.serverRevision.server.approvalStatus !== McpApprovalStatus.Published)
			return "not_ready";
		if (existing !== null)
			return existing.serverRevisionId === tool.serverRevisionId ? "idempotent" : "not_mcp";

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
