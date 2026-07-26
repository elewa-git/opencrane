import type { AgentBudget, AgentRevision, AgentRevisionState, AgentRun, AgentRunState, AgentRunTerminalReason, AgentRunTrigger, AgentService, AgentServiceKind, AgentServiceState, GrantScope, GrantSubjectType } from "@opencrane/models/agents";

import type { AgentRevisionRow, AgentRunRow, AgentServiceRow } from "./prisma-agent-mappers.types.js";

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
	if (value === "Personal") return "personal";
	if (value === "Managed") return "managed";
	throw new Error(`unknown AgentService kind: ${value}`);
}

/** Maps a Prisma GrantScope identifier to the canonical scope-attachment vocabulary. */
export function _grantScope(value: string): GrantScope
{
	switch (value)
	{
		case "Org": return "org";
		case "Department": return "department";
		case "Team": return "team";
		case "Project": return "project";
		case "Personal": return "personal";
		default: throw new Error(`unknown GrantScope: ${value}`);
	}
}

/** Maps a Prisma GrantSubjectType identifier to the canonical scope-attachment vocabulary. */
export function _grantSubjectType(value: string): GrantSubjectType
{
	switch (value)
	{
		case "Group": return "group";
		case "Tenant": return "tenant";
		case "User": return "user";
		default: throw new Error(`unknown GrantSubjectType: ${value}`);
	}
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

/** Maps a Prisma AgentRun trigger identifier to the target contract value. */
export function _runTrigger(value: string): AgentRunTrigger
{
	switch (value)
	{
		case "Interactive": return "interactive";
		case "Schedule": return "schedule";
		case "ManagedInvocation": return "managed_invocation";
		default: throw new Error(`unknown AgentRun trigger: ${value}`);
	}
}

/** Maps a Prisma AgentRun lifecycle identifier to the target contract value. */
export function _runState(value: string): AgentRunState
{
	switch (value)
	{
		case "Accepted": return "accepted";
		case "Queued": return "queued";
		case "Assigned": return "assigned";
		case "Running": return "running";
		case "WaitingForApproval": return "waiting_for_approval";
		case "Cancelling": return "cancelling";
		case "Completed": return "completed";
		case "Failed": return "failed";
		case "Cancelled": return "cancelled";
		default: throw new Error(`unknown AgentRun state: ${value}`);
	}
}

/** Maps a Prisma AgentRun terminal-reason identifier to the target contract value, or null. */
export function _runTerminalReason(value: string | null): AgentRunTerminalReason | null
{
	if (value === null) return null;
	switch (value)
	{
		case "Success": return "success";
		case "UserCancelled": return "user_cancelled";
		case "PolicyDenied": return "policy_denied";
		case "BudgetExhausted": return "budget_exhausted";
		case "RuntimeFailure": return "runtime_failure";
		case "InvalidInput": return "invalid_input";
		default: throw new Error(`unknown AgentRun terminal reason: ${value}`);
	}
}

/** Maps one locked Prisma service row to the dependency-light target contract. */
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

/** Maps one locked Prisma revision row and its immutable assignments to the target contract. */
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
		integrationAssignments: row.integrationAssignments.map(assignment => ({ integrationId: assignment.integrationId, custodyReferenceId: assignment.custodyReferenceId, allowedTools: assignment.allowedTools })),
		scopeAttachments: row.scopeAttachments.map(attachment => ({ scope: _grantScope(attachment.scope), subjectType: _grantSubjectType(attachment.subjectType), subjectId: attachment.subjectId })),
		budget: row.budget as unknown as AgentBudget,
		authoredBy: row.authoredBy,
		createdAt: row.createdAt.toISOString(),
		publishedAt: row.publishedAt?.toISOString() ?? null,
	};
}

/** Maps one durable Prisma run row to the dependency-light run-history contract. */
export function _mapRun(row: AgentRunRow): AgentRun
{
	return {
		id: row.id,
		siloId: row.siloId,
		agentServiceId: row.agentServiceId,
		agentRevisionId: row.agentRevisionId,
		threadId: row.threadId,
		trigger: _runTrigger(row.trigger),
		delegatedUserId: row.delegatedUserId,
		requestIdempotencyKey: row.requestIdempotencyKey,
		lineage: { rootRunId: row.rootRunId, parentRunId: row.parentRunId },
		attempt: row.attempt,
		state: _runState(row.state),
		effectiveContractDigest: row.effectiveContractDigest,
		inputSnapshotDigest: row.inputSnapshotDigest,
		acceptedAt: row.acceptedAt.toISOString(),
		startedAt: row.startedAt?.toISOString() ?? null,
		finishedAt: row.finishedAt?.toISOString() ?? null,
		terminalReason: _runTerminalReason(row.terminalReason),
	};
}
