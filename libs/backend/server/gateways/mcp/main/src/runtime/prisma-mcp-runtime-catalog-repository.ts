import { randomUUID } from "node:crypto";

import { McpRuntimeExecutionKind, McpServerRevisionState, McpServerStatus, McpServerTransport, OciImageValidationState, type Prisma } from "@prisma/client";

import { RuntimeWorkloadClaimClasses } from "@opencrane/backend/agents/runtime/workloads/contract";
import { ExternalActionRecoveryModes, ToolInvocationStates, type McpToolInvocationTransactionParticipant } from "@opencrane/backend/server/iam/authorization";

import { McpRuntimeExecutionKinds } from "./mcp-runtime.types";
import type { McpOciServerPromotionCaller, McpOciServerPromotionCommand, McpOciServerPromotionResult, McpRuntimeAuthorityOptions, McpRuntimeCatalogRepository } from "./mcp-runtime.types";

/** Writes catalogue promotion and ToolInvocation admission inside one MCP transaction. */
export class PrismaMcpRuntimeCatalogRepository implements McpRuntimeCatalogRepository
{
	/** Transaction shared with any authorization-owned ToolInvocation write. */
	private readonly _transaction: Prisma.TransactionClient;
	/** Authorization operations bound to this transaction. */
	private readonly _toolInvocations: McpToolInvocationTransactionParticipant;
	/** Fixed deployment policy for newly admitted MCP work. */
	private readonly _options: McpRuntimeAuthorityOptions;

	/** Bind catalogue and invocation work to one serializable transaction. */
	constructor(transaction: Prisma.TransactionClient, toolInvocations: McpToolInvocationTransactionParticipant, options: McpRuntimeAuthorityOptions)
	{
		this._transaction = transaction;
		this._toolInvocations = toolInvocations;
		this._options = options;
	}

	/** Promote one imported image into a draft server and its first discovery execution. */
	async promoteImportedValidation(caller: McpOciServerPromotionCaller, validationId: string, command: McpOciServerPromotionCommand): Promise<McpOciServerPromotionResult>
	{
		// 1. Load only an image inside the authenticated silo, because an identifier never grants cross-silo access.
		const validation = await this._transaction.ociImageValidation.findFirst({ where: { id: validationId, siloId: caller.siloId }, select: { id: true, siloId: true, state: true, registryReference: true } });
		if (validation === null)
			return { outcome: "not_found" };
		if (validation.state !== OciImageValidationState.Imported || validation.registryReference === null)
			return { outcome: "not_imported" };

		// 2. Treat an exact replay as success and reject a second catalogue identity for the same image.
		const existingRevision = await this._transaction.mcpServerRevision.findFirst({ where: { ociImageValidationId: validation.id, siloId: caller.siloId }, include: { server: { select: { id: true, name: true, description: true } }, executions: { where: { kind: McpRuntimeExecutionKind.Discovery }, select: { id: true }, take: 1 } } });
		if (existingRevision !== null)
		{
			const execution = existingRevision.executions[0];
			if (existingRevision.server.name !== command.name || existingRevision.server.description !== command.description || execution === undefined)
				return { outcome: "conflict" };
			return { outcome: "idempotent", serverId: existingRevision.server.id, serverRevisionId: existingRevision.id, executionId: execution.id };
		}
		const nameOwner = await this._transaction.mcpServer.findUnique({ where: { siloId_name: { siloId: caller.siloId, name: command.name } }, select: { id: true } });
		if (nameOwner !== null)
			return { outcome: "conflict" };

		// 3. Save the immutable revision and its discovery workload together, so no draft can be stranded without work.
		const server = await this._transaction.mcpServer.create({
			data: {
				siloId: caller.siloId,
				name: command.name,
				description: command.description,
				endpoint: validation.registryReference,
				transport: McpServerTransport.OciImage,
				status: McpServerStatus.Draft,
			},
			select: { id: true },
		});
		const revision = await this._transaction.mcpServerRevision.create({ data: { siloId: caller.siloId, mcpServerId: server.id, ociImageValidationId: validation.id, revision: 1, registryReference: validation.registryReference, state: McpServerRevisionState.Discovering }, select: { id: true } });
		const executionId = randomUUID();
		await this._transaction.mcpRuntimeExecution.create({ data: { id: executionId, siloId: caller.siloId, serverRevisionId: revision.id, kind: McpRuntimeExecutionKind.Discovery, idempotencyKey: `mcp-discovery:${validation.id}`, executionReference: `mcp-execution-v1_${randomUUID()}`, profileName: this._options.profileName }, select: { id: true } });
		await this._transaction.auditEntry.create({ data: { action: "mcp.oci_server.promoted", resource: server.id, message: "Imported OCI image promoted into MCP discovery", metadata: { siloId: caller.siloId, actorPrincipalId: caller.principalId, validationId: validation.id, serverRevisionId: revision.id, executionId } }, select: { id: true } });
		this._options.log.info({ siloId: caller.siloId, serverId: server.id, serverRevisionId: revision.id, principalId: caller.principalId }, "promoted imported OCI image into MCP discovery");
		return { outcome: "created", serverId: server.id, serverRevisionId: revision.id, executionId };
	}

	/** Admit a ready MCP ToolInvocation into one durable invocation execution. */
	async admitInvocation(toolInvocationRowId: string): Promise<"admitted" | "idempotent" | "not_ready" | "not_mcp">
	{
		// 1. Ask authorization for the invocation, so MCP storage never owns its arguments or lifecycle.
		const invocation = await this._toolInvocations.findById(toolInvocationRowId);
		if (invocation === null || invocation.siloId !== this._options.siloId)
			return "not_mcp";
		const existing = await this._transaction.mcpRuntimeExecution.findUnique({ where: { toolInvocationId: invocation.id }, select: { id: true, serverRevisionId: true } });

		// 2. Resolve the selected immutable tool only inside the invocation's silo and ready server revision.
		const tool = await this._transaction.mcpToolRevision.findFirst({ where: { id: invocation.toolRevisionId, siloId: invocation.siloId }, select: { serverRevisionId: true, serverRevision: { select: { state: true } } } });
		if (tool === null)
			return "not_mcp";
		if (invocation.state !== ToolInvocationStates.Ready || invocation.recoveryMode !== ExternalActionRecoveryModes.Manual || tool.serverRevision.state !== McpServerRevisionState.Ready)
			return "not_ready";
		if (existing !== null)
			return existing.serverRevisionId === tool.serverRevisionId ? "idempotent" : "not_mcp";

		// 3. Store only the invocation identity and immutable revision; authorization retains the effect data.
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
