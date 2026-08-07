import { AgentRevisionState, AgentServiceKind, AgentServiceState, FleetMembershipScopeKind, GrantScope, GrantSubjectType } from "@prisma/client";
import type { Prisma } from "@prisma/client";

import { RunInputSnapshotIdentityKinds, type ManagedRunInputScopeAttachment } from "@opencrane/contracts";
import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import { __VerifyCurrentFleetMembershipEvidence, PrismaFleetMembershipAuthorityRepository } from "@opencrane/backend/server/iam/membership";
import type { AuthorizationScope } from "@opencrane/models/authorization";
import type { RevisionScopeAttachment } from "@opencrane/models/agents";
import type { JsonValue } from "@opencrane/util";

import { __ResolveEffectiveScopeAttachments } from "./scope-attachment-authority.js";
import { PrismaScopeGrantResolver } from "./prisma-scope-grant-resolver.js";
import type { ManagedExecutionEvidenceAuthority, ManagedExecutionEvidenceCommand, ManagedExecutionEvidenceConfig, ManagedExecutionEvidenceResult, ManagedExecutionEvidenceTransaction } from "./managed-execution-evidence.types.js";

/** Canonical principal exercised by one managed AgentService. */
export function __ManagedAgentServicePrincipal(agentServiceId: string): string
{
	return `agent-service:${agentServiceId}`;
}

/**
 * Resolves signed membership and effective revision capabilities for one managed service.
 *
 * The service, revision, membership high-water mark, grants, and final snapshot all share the
 * caller's admission transaction. The human requester is deliberately absent from this authority.
 */
export class PrismaManagedExecutionEvidenceAuthority implements ManagedExecutionEvidenceAuthority
{
	/** Trusted membership configuration fixed by app composition. */
	private readonly config: ManagedExecutionEvidenceConfig;

	/** Creates the production evidence authority. */
	constructor(config: ManagedExecutionEvidenceConfig)
	{
		if (config.trustedIssuerId.trim().length === 0 || !Number.isSafeInteger(config.maximumStalenessMs) || config.maximumStalenessMs <= 0) throw new Error("managed execution evidence requires a trusted issuer and positive staleness bound");
		this.config = config;
	}

	/** Loads exact current service, membership, attachment, and assignment evidence. */
	async load(command: ManagedExecutionEvidenceCommand, transaction: ManagedExecutionEvidenceTransaction): Promise<ManagedExecutionEvidenceResult>
	{
		const revision = await transaction.prisma.agentRevision.findFirst({
			where: {
				id: command.agentRevisionId,
				agentServiceId: command.agentServiceId,
				state: AgentRevisionState.Published,
				agentService: { is: { id: command.agentServiceId, siloId: command.siloId, kind: AgentServiceKind.Managed, state: AgentServiceState.Active, activeRevisionId: command.agentRevisionId } },
			},
			select: {
				id: true,
				digest: true,
				modelDefinitionId: true,
				budget: true,
				scopeAttachments: { select: { scope: true, subjectType: true, subjectId: true } },
				skillAssignments: { select: { skillId: true, skillRevisionId: true } },
				integrationAssignments: { select: { integrationId: true, custodyReferenceId: true, allowedTools: true } },
			},
		});
		if (revision === null) return { outcome: "denied", reason: "run_not_admittable" };

		const principal = __ManagedAgentServicePrincipal(command.agentServiceId);
		const assertion = await _SelectMembershipAssertion(transaction.prisma, this.config.trustedIssuerId, command.siloId, principal);
		if (assertion === null) return { outcome: "denied", reason: "membership_stale" };
		const membership = await __VerifyCurrentFleetMembershipEvidence(new PrismaFleetMembershipAuthorityRepository(transaction.prisma), this.config.verifier, {
			trustedIssuerId: this.config.trustedIssuerId,
			siloId: command.siloId,
			subjectId: principal,
			assertionId: assertion.assertionId,
			scope: _Scope(assertion.scopeKind, assertion.organizationId, assertion.scopeResourceId),
			nowEpochMs: transaction.admittedAtEpochMs,
			maximumStalenessMs: this.config.maximumStalenessMs,
		});
		if ("reason" in membership || membership.evidence.subjectId !== principal) return { outcome: "denied", reason: "membership_stale" };

		const declared = revision.scopeAttachments.map(_Attachment);
		if (declared.some(_IsPersonalAttachment)) return { outcome: "denied", reason: "memory_scope_unavailable" };
		const effective = await __ResolveEffectiveScopeAttachments(new PrismaScopeGrantResolver(transaction.prisma), [principal], declared);
		if (effective.rejected.length > 0) return { outcome: "denied", reason: "memory_scope_unavailable" };
		const attachments = _CanonicalAttachments(effective.authorized);
		const attachmentDigest = __DigestCanonicalJson(attachments as unknown as JsonValue);
		const capabilitySetDigest = __DigestCanonicalJson({
			siloId: command.siloId,
			agentServiceId: command.agentServiceId,
			agentRevisionId: revision.id,
			agentRevisionDigest: revision.digest,
			executionSubjectId: principal,
			organizationId: membership.evidence.organizationId,
			fleetMembershipRevision: membership.evidence.revision,
			fleetMembershipPayloadDigest: membership.evidence.payloadDigest,
			effectiveScopeAttachments: attachments,
			modelDefinitionId: revision.modelDefinitionId,
			budget: revision.budget,
			skillAssignments: _CanonicalSkillAssignments(revision.skillAssignments),
			integrationAssignments: _CanonicalIntegrationAssignments(revision.integrationAssignments),
		} as unknown as JsonValue);
		return {
			outcome: "loaded",
			value: {
				identity: {
					kind: RunInputSnapshotIdentityKinds.Service,
					executionSubjectId: principal,
					agentServiceId: command.agentServiceId,
					organizationId: membership.evidence.organizationId,
					fleetMembershipRevision: membership.evidence.revision,
					fleetMembershipIssuer: membership.evidence.issuerId,
					fleetMembershipIssuerKeyId: membership.evidence.issuerKeyId,
					fleetMembershipAssertionId: membership.evidence.assertionId,
					fleetMembershipPayloadDigest: membership.evidence.payloadDigest,
					fleetMembershipTrustedUntil: new Date(membership.evidence.trustedUntilEpochMs).toISOString(),
					effectiveScopeAttachments: attachments,
					effectiveScopeAttachmentDigest: attachmentDigest,
				},
				capabilitySetDigest,
			},
		};
	}
}

/**
 * Selects the lowest stable assertion identifier inside one organization.
 *
 * Multiple same-organization membership scopes are valid. This choice freezes one exact signed
 * membership assertion as identity evidence; executable knowledge scope remains the separate
 * intersection of revision attachments and effective grants.
 */
async function _SelectMembershipAssertion(prisma: Prisma.TransactionClient, trustedIssuerId: string, siloId: string, subjectId: string): Promise<{ assertionId: string; scopeKind: FleetMembershipScopeKind; organizationId: string; scopeResourceId: string | null } | null>
{
	const revision = await prisma.verifiedFleetMembershipRevision.findFirst({
		where: { issuerId: trustedIssuerId, siloId },
		orderBy: { revision: "desc" },
		select: { assertions: { where: { siloId, subjectId }, orderBy: { assertionId: "asc" }, select: { assertionId: true, scopeKind: true, organizationId: true, scopeResourceId: true } } },
	});
	const assertions = revision?.assertions ?? [];
	if (assertions.length === 0 || new Set(assertions.map(_OrganizationId)).size !== 1) return null;
	return assertions[0] ?? null;
}

/** Returns the organization coordinate for ambiguity detection. */
function _OrganizationId(assertion: { organizationId: string }): string
{
	return assertion.organizationId;
}

/** Maps a stored assertion scope into the signed authorization contract. */
function _Scope(kind: FleetMembershipScopeKind, organizationId: string, resourceId: string | null): AuthorizationScope
{
	switch (kind)
	{
		case FleetMembershipScopeKind.Organization: return { kind: "organization", organizationId };
		case FleetMembershipScopeKind.Department: return { kind: "department", organizationId, departmentId: resourceId ?? "" };
		case FleetMembershipScopeKind.Team: return { kind: "team", organizationId, teamId: resourceId ?? "" };
		case FleetMembershipScopeKind.Project: return { kind: "project", organizationId, projectId: resourceId ?? "" };
		case FleetMembershipScopeKind.Personal: return { kind: "personal", organizationId, userId: resourceId ?? "" };
		case FleetMembershipScopeKind.DirectUser: return { kind: "direct-user", organizationId, userId: resourceId ?? "" };
	}
}

/** Maps a Prisma attachment into the stable agent-domain contract. */
function _Attachment(value: { scope: GrantScope; subjectType: GrantSubjectType; subjectId: string }): RevisionScopeAttachment
{
	const scopes = { [GrantScope.Org]: "org", [GrantScope.Department]: "department", [GrantScope.Team]: "team", [GrantScope.Project]: "project", [GrantScope.Personal]: "personal" } as const;
	const subjectTypes = { [GrantSubjectType.Group]: "group", [GrantSubjectType.User]: "user" } as const;
	return { scope: scopes[value.scope], subjectType: subjectTypes[value.subjectType], subjectId: value.subjectId };
}

/** Returns whether an attachment would expose personal memory to a managed service. */
function _IsPersonalAttachment(value: RevisionScopeAttachment): boolean
{
	return value.scope === "personal";
}

/** Compares canonical ASCII coordinates without locale- or ICU-dependent collation. */
function _CompareCanonicalCoordinate(left: string, right: string): number
{
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

/** Canonicalizes effective attachments before persistence and digesting. */
function _CanonicalAttachments(values: readonly RevisionScopeAttachment[]): readonly ManagedRunInputScopeAttachment[]
{
	return [...values]
		.map(function _Copy(value): ManagedRunInputScopeAttachment { return { scope: value.scope, subjectType: value.subjectType, subjectId: value.subjectId }; })
		.sort(function _ByTriple(left, right): number { return _CompareCanonicalCoordinate(`${left.scope}\u0000${left.subjectType}\u0000${left.subjectId}`, `${right.scope}\u0000${right.subjectType}\u0000${right.subjectId}`); });
}

/** Canonicalizes revision skill coordinates for capability digesting. */
function _CanonicalSkillAssignments(values: readonly { skillId: string; skillRevisionId: string }[]): JsonValue
{
	return [...values].sort(function _BySkill(left, right): number { return _CompareCanonicalCoordinate(`${left.skillId}\u0000${left.skillRevisionId}`, `${right.skillId}\u0000${right.skillRevisionId}`); }) as JsonValue;
}

/** Canonicalizes integration custody and exact tool allowances for capability digesting. */
function _CanonicalIntegrationAssignments(values: readonly { integrationId: string; custodyReferenceId: string; allowedTools: readonly string[] }[]): JsonValue
{
	return [...values]
		.map(function _Copy(value) { return { integrationId: value.integrationId, custodyReferenceId: value.custodyReferenceId, allowedTools: [...value.allowedTools].sort() }; })
		.sort(function _ByIntegration(left, right): number { return _CompareCanonicalCoordinate(`${left.integrationId}\u0000${left.custodyReferenceId}`, `${right.integrationId}\u0000${right.custodyReferenceId}`); }) as JsonValue;
}
