import { AgentRevisionState, AgentServiceKind, AgentServiceState, PersonaRevisionState, type Prisma } from "@prisma/client";

import type { AgentRevisionContent } from "@opencrane/models/agents";
import { __AppendAuditDecision } from "@opencrane/backend/server/iam/audit";
import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";

import { AgentRevisionPersonaSelectionMaterializationCodes, type AgentRevisionPersonaSelectionRepository, type MaterializeAgentRevisionPersonaSelectionCommand, type MaterializeAgentRevisionPersonaSelectionResult, type MaterializePersonalAgentPersonaSelectionCommand, type MaterializePersonalAgentPersonaSelectionResult } from "./agent-revision-persona-selection.types";
import { _AGENT_REVISION_INCLUDE, _AgentRevisionContentFromRow, PrismaAgentRevisionWriterRepository } from "./prisma-agent-revision-writer";

/** Capability catalogue recorded when an approved persona is published into an AgentRevision. */
const _PERSONA_SELECTION_CATALOG_ID = "opencrane-personal-agent-persona-selection";

/**
 * Prisma strategy that changes only the persona selected by a personal AgentRevision.
 *
 * A persona approval transaction calls this after approving its PersonaRevision but before moving
 * the profile pointer. Completed-onboarding repair calls the exact-service method after resolving
 * its existing service. Both paths retain one stable AgentService and one linear immutable revision
 * history; this class never creates a second service or commits the caller's transaction.
 *
 * @implements AgentRevisionPersonaSelectionRepository
 */
export class PrismaAgentRevisionPersonaSelectionRepository implements AgentRevisionPersonaSelectionRepository
{
	/** Transaction-scoped ORM client supplied by the owning unit of work. */
	private readonly transaction: Prisma.TransactionClient;

	/** Creates the strategy over a transaction that the caller will commit or roll back. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Revalidates, copies, publishes, and activates one persona-selected revision. */
	async materialize(command: MaterializeAgentRevisionPersonaSelectionCommand): Promise<MaterializeAgentRevisionPersonaSelectionResult>
	{
		if (!_ValidExactCommand(command)) return _Unavailable(command.expectedSourceRevisionId);

		// 1. Validate the target persona before touching the service lineage.
		const target = await this._ReadOwnedApprovedPersona(command.siloId, command.subjectId, command.targetPersonaRevisionId);
		if (target === null) return _Unavailable(command.expectedSourceRevisionId);

		// 2. Re-read the stable personal service and require the source pointer the caller observed.
		const service = await this.transaction.agentService.findFirst({
			where: { id: command.agentServiceId, siloId: command.siloId, kind: AgentServiceKind.Personal, state: AgentServiceState.Active },
			select: { id: true, activeRevisionId: true },
		});
		if (service === null) return _Unavailable(command.expectedSourceRevisionId);
		if (service.activeRevisionId !== command.expectedSourceRevisionId) return _Stale(command.expectedSourceRevisionId);

		// 3. Load the source and prove the old and new personas belong to the same owner profile.
		const source = await this.transaction.agentRevision.findFirst({
			where: { id: command.expectedSourceRevisionId, agentServiceId: command.agentServiceId, state: AgentRevisionState.Published },
			include: _AGENT_REVISION_INCLUDE,
		});
		if (source === null || source.personaRevisionId === null) return _Unavailable(command.expectedSourceRevisionId);
		const sourcePersona = await this._ReadOwnedApprovedPersona(command.siloId, command.subjectId, source.personaRevisionId);
		if (sourcePersona === null || sourcePersona.personaProfileId !== target.personaProfileId) return _Unavailable(command.expectedSourceRevisionId);

		// 4. Require the source to remain the newest lineage entry before allocating its successor.
		const latest = await this.transaction.agentRevision.findFirst({ where: { agentServiceId: service.id }, orderBy: { revision: "desc" }, select: { id: true } });
		if (latest?.id !== source.id) return _Stale(command.expectedSourceRevisionId);
		if (source.personaRevisionId === command.targetPersonaRevisionId)
		{
			return { status: AgentRevisionPersonaSelectionMaterializationCodes.AlreadyCurrent, agentRevisionId: source.id, sourceRevisionId: source.id };
		}

		// 5. Copy all executable content and replace only the persona revision reference.
		const content: AgentRevisionContent = { ..._AgentRevisionContentFromRow(source), personaRevisionId: command.targetPersonaRevisionId };
		const draft = await new PrismaAgentRevisionWriterRepository(this.transaction).createDraft({
			siloId: command.siloId,
			agentServiceId: command.agentServiceId,
			revision: source.revision + 1,
			parentRevisionId: source.id,
			sourceRevisionId: null,
			content,
			changeMessage: command.changeMessage,
			authoredBy: command.authoredBy,
			createdAt: command.materializedAt,
		});

		// 6. Publish the revision and repoint the service while the caller owns the transaction.
		await this.transaction.agentRevision.update({ where: { id: draft.id }, data: { state: AgentRevisionState.Published, publishedAt: command.materializedAt } });
		const activated = await this.transaction.agentService.updateMany({
			where: { id: service.id, siloId: command.siloId, kind: AgentServiceKind.Personal, state: AgentServiceState.Active, activeRevisionId: source.id },
			data: { activeRevisionId: draft.id, updatedAt: command.materializedAt },
		});
		if (activated.count !== 1) throw new AgentRevisionPersonaSelectionTransactionConflict();
		await __AppendAuditDecision(this.transaction, this._BuildAuditDecision(command, source.id, draft.id, draft.digest));
		return { status: AgentRevisionPersonaSelectionMaterializationCodes.Materialized, agentRevisionId: draft.id, sourceRevisionId: source.id };
	}

	/** Finds at most one personal service through the owner's approved persona history. */
	async materializeForOwner(command: MaterializePersonalAgentPersonaSelectionCommand): Promise<MaterializePersonalAgentPersonaSelectionResult>
	{
		if (!_ValidOwnerCommand(command)) return _Unavailable("");
		const target = await this._ReadOwnedApprovedPersona(command.siloId, command.subjectId, command.targetPersonaRevisionId);
		if (target === null) return _Unavailable("");
		const approvedPersonas = await this.transaction.personaRevision.findMany({
			where: { personaProfileId: target.personaProfileId, state: PersonaRevisionState.Approved, approvedAt: { not: null } },
			select: { id: true },
		});
		const services = await this.transaction.agentService.findMany({
			where: {
				siloId: command.siloId,
				kind: AgentServiceKind.Personal,
				state: AgentServiceState.Active,
				activeRevisionId: { not: null },
				activeRevision: { is: { state: AgentRevisionState.Published, personaRevisionId: { in: approvedPersonas.map(function _PersonaId(persona) { return persona.id; }) } } },
			},
			select: { id: true, activeRevisionId: true },
			orderBy: { id: "asc" },
			take: 2,
		});
		if (services.length === 0) return { status: AgentRevisionPersonaSelectionMaterializationCodes.NotApplicable, sourceRevisionId: null };
		const service = services[0];
		if (services.length !== 1 || service === undefined || service.activeRevisionId === null) return _Unavailable("");
		return this.materialize({ ...command, agentServiceId: service.id, expectedSourceRevisionId: service.activeRevisionId });
	}

	/** Reads one approved persona revision owned by the exact silo subject. */
	private async _ReadOwnedApprovedPersona(siloId: string, subjectId: string, personaRevisionId: string): Promise<{ readonly personaProfileId: string } | null>
	{
		return this.transaction.personaRevision.findFirst({
			where: { id: personaRevisionId, state: PersonaRevisionState.Approved, approvedAt: { not: null }, profile: { is: { siloId, userId: subjectId } } },
			select: { personaProfileId: true },
		});
	}

	/** Builds append-only evidence for the exact persona-only AgentRevision publication. */
	private _BuildAuditDecision(command: MaterializeAgentRevisionPersonaSelectionCommand, sourceRevisionId: string, agentRevisionId: string, agentRevisionDigest: string)
	{
		const argumentsDigest = __DigestCanonicalJson({ agentServiceId: command.agentServiceId, sourceRevisionId, targetPersonaRevisionId: command.targetPersonaRevisionId, materializedAt: command.materializedAt.toISOString() });
		const effectiveAuthorizationDigest = __DigestCanonicalJson({ actor: command.subjectId, siloId: command.siloId, sourceRevisionId, targetPersonaRevisionId: command.targetPersonaRevisionId, agentRevisionDigest });
		const decisionDigest = __DigestCanonicalJson({ argumentsDigest, effectiveAuthorizationDigest, action: "publish", resourceId: command.agentServiceId });
		return {
			decisionDigest,
			siloId: command.siloId,
			actorKind: "user" as const,
			actorId: command.subjectId,
			resourceKind: "agent-service",
			resourceId: command.agentServiceId,
			agentServiceId: command.agentServiceId,
			agentRevisionId,
			action: "publish",
			catalogId: _PERSONA_SELECTION_CATALOG_ID,
			catalogRevision: 1,
			catalogDigest: __DigestCanonicalJson({ catalog: _PERSONA_SELECTION_CATALOG_ID, revision: 1 }),
			argumentsDigest,
			policyRevisionHash: __DigestCanonicalJson({ policy: "personal-agent-persona-selection", revision: 1 }),
			effectiveAuthorizationDigest,
			outcome: "allow" as const,
			reasonCode: "approved_persona_selected",
			decidedAt: command.materializedAt,
		};
	}
}

/** Signals a compare-and-set loss after a revision write so the caller rolls everything back. */
export class AgentRevisionPersonaSelectionTransactionConflict extends Error
{
}

/** Returns an unavailable result bound to the source the caller supplied. */
function _Unavailable(sourceRevisionId: string): MaterializeAgentRevisionPersonaSelectionResult
{
	return { status: AgentRevisionPersonaSelectionMaterializationCodes.Unavailable, sourceRevisionId };
}

/** Returns a stale-source result bound to the source the caller supplied. */
function _Stale(sourceRevisionId: string): MaterializeAgentRevisionPersonaSelectionResult
{
	return { status: AgentRevisionPersonaSelectionMaterializationCodes.StaleSource, sourceRevisionId };
}

/** Validates the common owner, persona, author, message, and timestamp fields. */
function _ValidOwnerCommand(command: MaterializePersonalAgentPersonaSelectionCommand): boolean
{
	return _Present(command.siloId)
		&& _Present(command.subjectId)
		&& _Present(command.targetPersonaRevisionId)
		&& _Present(command.authoredBy)
		&& command.authoredBy === command.subjectId
		&& _Present(command.changeMessage)
		&& !Number.isNaN(command.materializedAt.getTime());
}

/** Validates the known service and source fields in addition to the common owner command. */
function _ValidExactCommand(command: MaterializeAgentRevisionPersonaSelectionCommand): boolean
{
	return _ValidOwnerCommand(command) && _Present(command.agentServiceId) && _Present(command.expectedSourceRevisionId);
}

/** Returns whether a command field carries a non-empty identifier or message. */
function _Present(value: string): boolean
{
	return value.trim().length > 0;
}
