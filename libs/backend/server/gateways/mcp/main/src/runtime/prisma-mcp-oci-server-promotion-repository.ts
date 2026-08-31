import { randomUUID } from "node:crypto";

import { McpRuntimeExecutionKind, McpServerRevisionState, McpServerStatus, McpServerTransport, OciImageValidationState, type Prisma } from "@prisma/client";

import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";

import { __RequireMcpOrganizationAdministration } from "../core/mcp-operator-authorization";
import type { McpOciServerPromotionCaller, McpOciServerPromotionCommand, McpOciServerPromotionRepository, McpOciServerPromotionResult, McpRuntimeAuthorityOptions } from "./mcp-runtime.types";

/**
 * Persists promotion of an imported OCI validation and the discovery execution that follows it.
 *
 * `PrismaMcpRuntimeUnitOfWork` creates this repository inside its serializable transaction, so the
 * catalogue rows, discovery work, and audit entry either commit together or none of them do.
 * @implements {McpOciServerPromotionRepository}
 */
export class PrismaMcpOciServerPromotionRepository implements McpOciServerPromotionRepository
{
	/** Transaction that atomically creates catalogue records and discovery work. */
	private readonly _transaction: Prisma.TransactionClient;
	/** Product authorization authority bound to the same serializable transaction. */
	private readonly _authorization: AuthorizationAuthority;
	/** Fixed deployment policy used to pin the discovery workload profile. */
	private readonly _options: McpRuntimeAuthorityOptions;

	/** Binds OCI catalogue promotion to the caller's serializable MCP transaction. */
	constructor(transaction: Prisma.TransactionClient, authorization: AuthorizationAuthority, options: McpRuntimeAuthorityOptions)
	{
		this._transaction = transaction;
		this._authorization = authorization;
		this._options = options;
	}

	/**
	 * Promotes an imported validation into a draft server and its first discovery execution.
	 *
	 * Repeating the same request returns the existing execution only when its server name and
	 * description still match; a changed request returns `conflict` rather than rewriting the draft.
	 * Called by: `PrismaMcpRuntimeUnitOfWork` through {@link McpOciServerPromotionRepository}.
	 *
	 * @param caller - Authenticated administrator whose silo scopes the validation lookup.
	 * @param validationId - Imported OCI validation to promote.
	 * @param command - New server name and description.
	 * @returns The created or existing discovery execution, or a reason promotion cannot proceed.
	 */
	async promoteImportedValidation(caller: McpOciServerPromotionCaller, validationId: string, command: McpOciServerPromotionCommand): Promise<McpOciServerPromotionResult>
	{
		await __RequireMcpOrganizationAdministration(this._authorization, caller, { operation: "mcp-oci-image-validation-promote", validationId, name: command.name, description: command.description });
		const validation = await this._transaction.ociImageValidation.findFirst({ where: { id: validationId, siloId: caller.siloId }, select: { id: true, siloId: true, state: true, registryReference: true } });
		if (validation === null)
			return { outcome: "not_found" };
		if (validation.state !== OciImageValidationState.Imported || validation.registryReference === null)
			return { outcome: "not_imported" };

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
		await this._transaction.auditEntry.create({ data: { siloId: caller.siloId, action: "mcp.oci_server.promoted", resource: server.id, message: "Imported OCI image promoted into MCP discovery", metadata: { actorPrincipalId: caller.principalId, validationId: validation.id, serverRevisionId: revision.id, executionId } }, select: { id: true } });
		this._options.log.info({ siloId: caller.siloId, serverId: server.id, serverRevisionId: revision.id, principalId: caller.principalId }, "promoted imported OCI image into MCP discovery");
		return { outcome: "created", serverId: server.id, serverRevisionId: revision.id, executionId };
	}
}
