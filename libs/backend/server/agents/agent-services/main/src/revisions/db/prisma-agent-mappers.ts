import { AgentServiceKinds, RevisionBoundaryCoverages, RevisionBoundaryKinds, type AgentBudget, type AgentRevision, type AgentRevisionState, type AgentService, type AgentServiceKind, type AgentServiceState, type RevisionBoundaryAttachment } from "@opencrane/models/agents";

import type { AgentRevisionRow, AgentServiceRow } from "./prisma-agent-mappers.types";

/** Maps a Prisma AgentService lifecycle identifier to the target contract value. */
export function _serviceState(value: string): AgentServiceState
{
	switch (value)
	{
		case "Draft": return "draft";
		case "Active": return "active";
		case "Paused": return "paused";
		case "Retired": return "retired";
		default: throw new Error(`unknown AgentService state: ${value}`);
	}
}

/** Maps a Prisma AgentService kind identifier to the target contract value. */
export function _serviceKind(value: string): AgentServiceKind
{
	if (value === "Personal")
		return AgentServiceKinds.Personal;
	if (value === "Managed")
		return AgentServiceKinds.Managed;
	throw new Error(`unknown AgentService kind: ${value}`);
}

/** Maps a stored boundary attachment into the agent-domain contract. */
function _boundaryAttachment(value: AgentRevisionRow["boundaryAttachments"][number]): RevisionBoundaryAttachment
{
	if (value.boundaryKind === "Group" && value.boundaryGroupId !== null && value.boundaryPrincipalId === null)
	{
		if (value.boundaryCoverage !== "Exact" && value.boundaryCoverage !== "Descendants")
			throw new Error("invalid persisted group boundary coverage");
		const boundaryCoverage = value.boundaryCoverage === "Descendants" ? RevisionBoundaryCoverages.Descendants : RevisionBoundaryCoverages.Exact;
		return { boundaryKind: RevisionBoundaryKinds.Group, boundaryId: value.boundaryGroupId, boundaryCoverage };
	}
	if (value.boundaryKind === "Personal" && value.boundaryPrincipalId !== null && value.boundaryGroupId === null && value.boundaryCoverage === "Exact")
	{
		return { boundaryKind: RevisionBoundaryKinds.Personal, boundaryId: value.boundaryPrincipalId, boundaryCoverage: RevisionBoundaryCoverages.Exact };
	}
	throw new Error("invalid persisted agent revision boundary attachment");
}

/** Maps a Prisma AgentRevision lifecycle identifier to the target contract value. */
export function _revisionState(value: string): AgentRevisionState
{
	switch (value)
	{
		case "Draft": return "draft";
		case "Published": return "published";
		case "Rejected": return "rejected";
		case "Retired": return "retired";
		default: throw new Error(`unknown AgentRevision state: ${value}`);
	}
}

/** Maps one Prisma service row to the dependency-light target contract. */
export function _mapService(row: AgentServiceRow): AgentService
{
	return {
		id: row.id,
		siloId: row.siloId,
		kind: _serviceKind(row.kind),
		name: row.name,
		state: _serviceState(row.state),
		activeRevisionId: row.activeRevisionId,
		workloadProfile: row.workloadProfile,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

/** Maps one Prisma revision row and its immutable assignments to the target contract. */
export function _mapRevision(row: AgentRevisionRow): AgentRevision
{
	return {
		id: row.id,
		agentServiceId: row.agentServiceId,
		revision: row.revision,
		parentRevisionId: row.parentRevisionId,
		sourceRevisionId: row.sourceRevisionId,
		changeMessage: row.changeMessage,
		state: _revisionState(row.state),
		digest: row.digest,
		promptPolicyVersion: row.promptPolicyVersion,
		personaRevisionId: row.personaRevisionId,
		modelDefinitionId: row.modelDefinitionId,
		skills: row.skillAssignments.map(assignment => ({ skillId: assignment.skillId, revisionId: assignment.skillRevisionId })),
		mcpToolRevisionIds: row.mcpToolAssignments.map(assignment => assignment.toolRevisionId).sort(),
		boundaryAttachments: row.boundaryAttachments.map(_boundaryAttachment),
		budget: row.budget as unknown as AgentBudget,
		authoredBy: row.authoredBy,
		createdAt: row.createdAt.toISOString(),
		publishedAt: row.publishedAt?.toISOString() ?? null,
	};
}
