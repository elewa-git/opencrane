import { randomUUID } from "node:crypto";
import { AgentRevisionState, AgentServiceKind, AgentServiceState, McpApprovalStatus, McpServerRevisionState, McpServerStatus, PrincipalProvenance, type Prisma } from "@prisma/client";
import type { AuthorizationAuthority, ManagedAuthorizationGrantRepository } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson } from "@opencrane/util";

import type { CompanyAssistantProvisioningCaller, CompanyAssistantToolsCommand, CompanyAssistantToolsRepository, CompanyAssistantToolsSelection } from "../company-assistant-provisioning.types";
import { ___CompanyAssistantToolsSchema } from "../company-assistant-provisioning.validator";
import { CompanyAssistantProvisioningDenied, CompanyAssistantToolsConflict, CompanyAssistantToolsUnavailable } from "../company-assistant.errors";
import { _AdmitCompanyAssistantChange, _CompanyAssistantGrant } from "../company-assistant-permissions";
import { __CompanyAssistantServiceId } from "../managed-agent-identity";
import { _AGENT_REVISION_INCLUDE, _AgentRevisionContentFromRow, PrismaAgentRevisionWriterRepository } from "../../revisions/db/prisma-agent-revision-writer";

/**
 * Replaces the company's selected tools without changing its identity or saved execution budget.
 *
 * Called by: the company assistant repository inside the caller's transaction. Replacements use
 * serializable isolation: authorization evidence, the successor, and its own grants commit together.
 * The active revision comparison rejects stale edits and causes every losing write to roll back.
 * Grant reconciliation visits tool IDs in sorted order before the final service update, so concurrent
 * edits acquire those resource locks in the same order. The outer transaction retries proven rollbacks.
 */
export class PrismaCompanyAssistantToolsRepository implements CompanyAssistantToolsRepository
{
	/** Uses the caller's transaction and central authorization ports; it never opens its own transaction. */
	public constructor(private readonly transaction: Prisma.TransactionClient, private readonly authorization: AuthorizationAuthority, private readonly grants: ManagedAuthorizationGrantRepository) {}

	/** Reads current assignment eligibility without recording an effect admission or revealing credentials. */
	public async getTools(caller: CompanyAssistantProvisioningCaller, now: Date): Promise<CompanyAssistantToolsSelection>
	{
		const decision = await this.authorization.decidePrincipal({ ...caller, resource: { kind: ProductAuthorizationResourceKinds.Organization, id: caller.siloId }, action: ProductAuthorizationActions.Administer, nowEpochMs: now.getTime() });
		if (decision.outcome !== AuthorizationDecisionOutcomes.Allow)
			throw new CompanyAssistantProvisioningDenied();
		const service = await this._CurrentCompany(caller.siloId);
		return { agentServiceId: service.id, activeRevisionId: service.activeRevision.id, toolRevisionIds: service.activeRevision.mcpToolAssignments.map(assignment => assignment.toolRevisionId).sort() };
	}

	/**
	 * Publishes an immutable replacement and the exact grants for its own principal in the caller's transaction.
	 * A stale expected revision always conflicts, including a retry after an uncertain successful commit.
	 * An unchanged selection still requires current administrator permission and permission to assign each tool.
	 */
	public async setTools(caller: CompanyAssistantProvisioningCaller, command: CompanyAssistantToolsCommand, now: Date): Promise<CompanyAssistantToolsSelection>
	{
		// 1. Bind the administrator decision to this exact selection before reading or changing it.
		if (!___CompanyAssistantToolsSchema.safeParse(command).success)
			throw new CompanyAssistantProvisioningDenied();
		const toolRevisionIds = [...command.toolRevisionIds].sort();
		const argumentsDigest = ___DigestCanonicalJson({ agentServiceId: __CompanyAssistantServiceId(caller.siloId), expectedActiveRevisionId: command.expectedActiveRevisionId, toolRevisionIds });
		await _AdmitCompanyAssistantChange(this.authorization, caller, { kind: ProductAuthorizationResourceKinds.Organization, id: caller.siloId }, ProductAuthorizationActions.Administer, argumentsDigest, now);
		const service = await this._CurrentCompany(caller.siloId);
		const source = service.activeRevision;
		if (source.id !== command.expectedActiveRevisionId)
			throw new CompanyAssistantToolsConflict();
		// 2. Even an unchanged selection must still contain available tools the caller may assign.
		const tools = await this.transaction.mcpToolRevision.findMany({ where: { id: { in: toolRevisionIds }, siloId: caller.siloId, serverRevision: { is: { siloId: caller.siloId, state: McpServerRevisionState.Ready, server: { is: { siloId: caller.siloId, status: McpServerStatus.Active, approvalStatus: McpApprovalStatus.Published } } } } }, select: { id: true } });
		if (tools.length !== toolRevisionIds.length)
			throw new CompanyAssistantProvisioningDenied();
		for (const toolRevisionId of toolRevisionIds)
			await _AdmitCompanyAssistantChange(this.authorization, caller, { kind: ProductAuthorizationResourceKinds.McpToolRevision, id: toolRevisionId }, ProductAuthorizationActions.Assign, argumentsDigest, now);
		const previousToolIds = source.mcpToolAssignments.map(assignment => assignment.toolRevisionId).sort();
		if (previousToolIds.length === toolRevisionIds.length && previousToolIds.every((id, index) => id === toolRevisionIds[index]))
			return { agentServiceId: service.id, activeRevisionId: source.id, toolRevisionIds };
		// 3. Copy the saved policy and budget, then reconcile only this assistant's managed grants.
		const revisionId = randomUUID();
		await new PrismaAgentRevisionWriterRepository(this.transaction).createDraft({ agentRevisionId: revisionId, siloId: caller.siloId, agentServiceId: service.id, revision: source.revision + 1, parentRevisionId: source.id, sourceRevisionId: null, content: { ..._AgentRevisionContentFromRow(source), mcpToolRevisionIds: toolRevisionIds }, changeMessage: "Administrator replaced company assistant tool assignments", authoredBy: caller.principalId, createdAt: now });
		for (const toolRevisionId of [...new Set([...previousToolIds, ...toolRevisionIds])].sort())
		{
			const resource = { kind: ProductAuthorizationResourceKinds.McpToolRevision, id: toolRevisionId };
			const grants = toolRevisionIds.includes(toolRevisionId) ? [ProductAuthorizationActions.Use, ProductAuthorizationActions.Invoke].map(action => _CompanyAssistantGrant(service.principalId, caller.principalId, resource, action)) : [];
			await this.grants.reconcileManagedResourceGrants({ siloId: caller.siloId, managerId: `company-assistant:${service.id}`, resource, now, grants });
		}
		// 4. Publish and move the active pointer together; a lost comparison rolls back every write.
		await this.transaction.agentRevision.update({ where: { id_siloId: { id: revisionId, siloId: caller.siloId } }, data: { state: AgentRevisionState.Published, publishedAt: now } });
		const updated = await this.transaction.agentService.updateMany({ where: { id: service.id, siloId: caller.siloId, kind: AgentServiceKind.Managed, state: AgentServiceState.Active, activeRevisionId: source.id }, data: { activeRevisionId: revisionId, updatedAt: now } });
		if (updated.count !== 1)
			throw new CompanyAssistantToolsConflict();
		return { agentServiceId: service.id, activeRevisionId: revisionId, toolRevisionIds };
	}

	/** Loads the company assistant with its internal principal and currently published revision. */
	private async _CurrentCompany(siloId: string)
	{
		const service = await this.transaction.agentService.findFirst({ where: { id: __CompanyAssistantServiceId(siloId), siloId, kind: AgentServiceKind.Managed, state: AgentServiceState.Active, principal: { is: { siloId, provenance: PrincipalProvenance.Internal } } }, include: { activeRevision: { include: _AGENT_REVISION_INCLUDE } } });
		const revision = service?.activeRevision;
		if (service === null || service.principalId === null || revision === null || revision === undefined || service.activeRevisionId !== revision.id || revision.siloId !== siloId || revision.agentServiceId !== service.id || revision.state !== AgentRevisionState.Published || revision.publishedAt === null)
			throw new CompanyAssistantToolsUnavailable();
		return { ...service, principalId: service.principalId, activeRevision: revision };
	}
}
