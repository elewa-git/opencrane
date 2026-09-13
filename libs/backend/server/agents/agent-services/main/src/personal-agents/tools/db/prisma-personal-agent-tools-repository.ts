import { randomUUID } from "node:crypto";

import { AgentRevisionState, AgentServiceKind, AgentServiceState, McpApprovalStatus, McpServerRevisionState, McpServerStatus, PersonaRevisionState, type Prisma } from "@prisma/client";

import { PrismaAuthorizationAuthority, type AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { PersonalAgentSelectedResourceKinds, type PersonalAgentCurrentResources, type PersonalAgentProductCaller, type PersonalAgentProductEffects } from "../../personal-agent-product-effects.types";
import { PersonalAgentProductEffectDenied, PrismaPersonalAgentProductEffectsAuthority } from "../../db/prisma-personal-agent-product-effects";
import { _AGENT_REVISION_INCLUDE, _AgentRevisionContentFromRow, PrismaAgentRevisionWriterRepository } from "../../../revisions/db/prisma-agent-revision-writer";
import { PersonalAgentToolsConflict, PersonalAgentToolsDenied, PersonalAgentToolsUnavailable } from "../personal-agent-tools.errors";
import type { PersonalAgentToolsCaller, PersonalAgentToolsCommand, PersonalAgentToolsRepository, PersonalAgentToolsSelection } from "../personal-agent-tools.types";
import { ___PersonalAgentToolsSchema } from "../personal-agent-tools.validator";

/**
 * Reads and replaces the tool selection on a person's active agent revision.
 *
 * The personal-tools unit of work gives each operation a fresh transaction. A changed
 * selection commits its authorization decisions, managed grants, successor revision, publication,
 * and active pointer together. The unit of work retries only transactions that PostgreSQL proves
 * were rolled back. If a commit response is lost, the caller must read again; replaying the old
 * `expectedActiveRevisionId` conflicts after the committed successor becomes active.
 */
export class PrismaPersonalAgentToolsRepository implements PersonalAgentToolsRepository
{
	/** Product-effect authority bound to this repository transaction. */
	private readonly productEffects: PersonalAgentProductEffects;
	/** Read-decision authority bound to this repository transaction. */
	private readonly authorization: AuthorizationAuthority;

	/** Binds revision persistence and every authorization effect to one caller-owned transaction. */
	public constructor(private readonly transaction: Prisma.TransactionClient, productEffects?: PersonalAgentProductEffects, authorization?: AuthorizationAuthority)
	{
		this.productEffects = productEffects ?? new PrismaPersonalAgentProductEffectsAuthority(this.transaction);
		this.authorization = authorization ?? new PrismaAuthorizationAuthority(this.transaction);
	}

	/** Reads the current selection after resolving the owner and checking current service Edit. */
	public async getTools(requestCaller: PersonalAgentToolsCaller, now: Date): Promise<PersonalAgentToolsSelection>
	{
		const caller = await this._ResolveCaller(requestCaller);
		const service = await this._CurrentPersonalAgent(caller);
		const decision = await this.authorization.decidePrincipal({ siloId: caller.siloId, principalId: caller.principalId, resource: { kind: ProductAuthorizationResourceKinds.AgentService, id: service.id }, action: ProductAuthorizationActions.Edit, nowEpochMs: now.getTime() });
		if (decision.outcome !== AuthorizationDecisionOutcomes.Allow)
			throw new PersonalAgentToolsDenied();
		return _Selection(service.id, service.activeRevision);
	}

	/**
	 * Checks the owner and active source, then saves the complete requested tool selection.
	 *
	 * An identical request repairs this owner's managed grants and rechecks Edit and Assign without
	 * creating a revision. A changed request copies the source, reconciles the old and new tool IDs in
	 * sorted order, publishes the successor, and moves the service pointer only if the source remains
	 * active. Any denial, persistence error, or lost pointer comparison escapes to the unit of work,
	 * which rolls back every decision, grant, and revision write in this attempt.
	 *
	 * @throws {PersonalAgentToolsDenied} When the owner, Edit permission, requested tool, or Assign permission is unavailable.
	 * @throws {PersonalAgentToolsConflict} When the caller's source is stale, a later revision exists, or the active pointer changes.
	 */
	public async setTools(requestCaller: PersonalAgentToolsCaller, command: PersonalAgentToolsCommand, now: Date): Promise<PersonalAgentToolsSelection>
	{
		// 1. Reject malformed or stale input before any decision or write; a retry must start from the current active lineage.
		if (!___PersonalAgentToolsSchema.safeParse(command).success)
			throw new PersonalAgentToolsDenied();
		const caller = await this._ResolveCaller(requestCaller);
		const service = await this._CurrentPersonalAgent(caller);
		const source = service.activeRevision;
		if (source.id !== command.expectedActiveRevisionId)
			throw new PersonalAgentToolsConflict();
		const latest = await this.transaction.agentRevision.findFirst({ where: { siloId: caller.siloId, agentServiceId: service.id }, orderBy: { revision: "desc" }, select: { id: true } });
		if (latest?.id !== source.id)
			throw new PersonalAgentToolsConflict();

		// 2. Sort before availability checks so later Assign decisions and grant locks use a stable order.
		const toolRevisionIds = [...command.toolRevisionIds].sort();
		const tools = await this.transaction.mcpToolRevision.findMany({ where: { id: { in: toolRevisionIds }, siloId: caller.siloId, serverRevision: { is: { siloId: caller.siloId, state: McpServerRevisionState.Ready, server: { is: { siloId: caller.siloId, status: McpServerStatus.Active, approvalStatus: McpApprovalStatus.Published } } } } }, select: { id: true } });
		if (tools.length !== toolRevisionIds.length)
			throw new PersonalAgentToolsDenied();

		// 3. Reuse the source ID for an identical selection so the product-effect owner repairs current
		// grants; a new ID marks the changed path whose old/new tool union is reconciled at publication.
		const previousToolIds = source.mcpToolAssignments.map(assignment => assignment.toolRevisionId).sort();
		const revisionId = previousToolIds.length === toolRevisionIds.length && previousToolIds.every((id, index) => id === toolRevisionIds[index]) ? source.id : randomUUID();
		const sourceResources = _Resources(service.id, source.id, service.personaProfileId, source.modelDefinitionId, previousToolIds);
		const targetResources = _Resources(service.id, revisionId, service.personaProfileId, source.modelDefinitionId, toolRevisionIds);
		const productCommand = {
			caller,
			source: sourceResources,
			target: targetResources,
			now,
			selectedResource: PersonalAgentSelectedResourceKinds.Tool,
			argumentsValue: { agentServiceId: service.id, expectedActiveRevisionId: command.expectedActiveRevisionId, toolRevisionIds },
		} as const;
		try
		{
			await this.productEffects.admitRevisionSelection(productCommand);
		}
		catch (error)
		{
			if (error instanceof PersonalAgentProductEffectDenied)
				throw new PersonalAgentToolsDenied();
			throw error;
		}
		// 4. Finish an authorized identical request after grant repair, without a publication effect.
		if (revisionId === source.id)
			return _Selection(service.id, source);

		// 5. Reconcile the sorted old/new tool union after drafting so removed grants roll back if publication is denied.
		await new PrismaAgentRevisionWriterRepository(this.transaction).createDraft({ agentRevisionId: revisionId, siloId: caller.siloId, agentServiceId: service.id, revision: source.revision + 1, parentRevisionId: source.id, sourceRevisionId: null, content: { ..._AgentRevisionContentFromRow(source), mcpToolRevisionIds: toolRevisionIds }, changeMessage: "Owner replaced personal agent tool assignments", authoredBy: caller.subjectId, createdAt: now });
		try
		{
			await this.productEffects.admitRevisionPublication(productCommand);
		}
		catch (error)
		{
			if (error instanceof PersonalAgentProductEffectDenied)
				throw new PersonalAgentToolsDenied();
			throw error;
		}
		// 6. Publish before moving the pointer so the service never selects a draft; a lost source comparison rolls both writes back.
		await this.transaction.agentRevision.update({ where: { id_siloId: { id: revisionId, siloId: caller.siloId } }, data: { state: AgentRevisionState.Published, publishedAt: now } });
		const updated = await this.transaction.agentService.updateMany({ where: { id: service.id, siloId: caller.siloId, kind: AgentServiceKind.Personal, state: AgentServiceState.Active, activeRevisionId: source.id }, data: { activeRevisionId: revisionId, updatedAt: now } });
		if (updated.count !== 1)
			throw new PersonalAgentToolsConflict();
		return { agentServiceId: service.id, activeRevisionId: revisionId, toolRevisionIds };
	}

	/** Resolves the request subject to exactly one same-silo product caller. */
	private async _ResolveCaller(caller: PersonalAgentToolsCaller): Promise<PersonalAgentProductCaller>
	{
		const resolved = await this.productEffects.resolveCaller(caller.siloId, caller.subjectId);
		if (resolved === null)
			throw new PersonalAgentToolsDenied();
		return resolved;
	}

	/** Loads exactly one active personal service whose approved persona belongs to the subject. */
	private async _CurrentPersonalAgent(caller: PersonalAgentProductCaller)
	{
		const personas = await this.transaction.personaRevision.findMany({ where: { state: PersonaRevisionState.Approved, approvedAt: { not: null }, profile: { is: { siloId: caller.siloId, userId: caller.subjectId } } }, select: { id: true, personaProfileId: true } });
		const personaProfileByRevisionId = new Map(personas.map(persona => [persona.id, persona.personaProfileId]));
		const services = await this.transaction.agentService.findMany({
			where: { siloId: caller.siloId, kind: AgentServiceKind.Personal, state: AgentServiceState.Active, activeRevisionId: { not: null }, activeRevision: { is: { siloId: caller.siloId, state: AgentRevisionState.Published, publishedAt: { not: null }, personaRevisionId: { in: [...personaProfileByRevisionId.keys()] } } } },
			include: { activeRevision: { include: _AGENT_REVISION_INCLUDE } },
			orderBy: { id: "asc" },
			take: 2,
		});
		const service = services[0];
		const revision = service?.activeRevision;
		const personaProfileId = revision?.personaRevisionId === null || revision?.personaRevisionId === undefined ? undefined : personaProfileByRevisionId.get(revision.personaRevisionId);
		if (services.length !== 1 || service === undefined || revision === null || revision === undefined || personaProfileId === undefined || service.activeRevisionId !== revision.id || revision.agentServiceId !== service.id || revision.siloId !== caller.siloId)
			throw new PersonalAgentToolsUnavailable();
		return { ...service, personaProfileId, activeRevision: revision };
	}
}

/** Maps an included revision row to the public canonical selection. */
function _Selection(agentServiceId: string, revision: { readonly id: string; readonly mcpToolAssignments: readonly { readonly toolRevisionId: string }[] }): PersonalAgentToolsSelection
{
	return { agentServiceId, activeRevisionId: revision.id, toolRevisionIds: revision.mcpToolAssignments.map(assignment => assignment.toolRevisionId).sort() };
}

/** Constructs the complete product-effect resource set for one revision. */
function _Resources(agentServiceId: string, agentRevisionId: string, personaProfileId: string, modelDefinitionId: string, mcpToolRevisionIds: readonly string[]): PersonalAgentCurrentResources
{
	return { agentServiceId, agentRevisionId, personaProfileId, modelDefinitionId, mcpToolRevisionIds };
}
