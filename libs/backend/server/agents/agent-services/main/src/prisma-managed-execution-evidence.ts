import { AgentRevisionState, AgentServiceKind, AgentServiceState, FleetMembershipScopeKind, GrantScope, GrantSubjectType } from "@prisma/client";
import type { Prisma } from "@prisma/client";

import { RunInputSnapshotIdentityKinds, type ManagedRunInputScopeAttachment } from "@opencrane/contracts";
import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import { __VerifyCurrentFleetMembershipEvidence, PrismaFleetMembershipAuthorityRepository } from "@opencrane/backend/server/iam/membership";
import type { AuthorizationScope } from "@opencrane/models/authorization";
import type { ReviewedIntegrationToolDefinition, RevisionScopeAttachment } from "@opencrane/models/agents";
import type { JsonValue } from "@opencrane/util";

import { __ResolveEffectiveScopeAttachments } from "./scope-attachment-authority.js";
import { PrismaScopeGrantResolver } from "./prisma-scope-grant-resolver.js";
import type { ManagedExecutionEvidenceAuthority, ManagedExecutionEvidenceCommand, ManagedExecutionEvidenceConfig, ManagedExecutionEvidenceResult, ManagedExecutionEvidenceTransaction } from "./managed-execution-evidence.types.js";

/**
 * Builds the principal name a managed agent acts as: `agent-service:<id>`.
 *
 * A managed agent has no human behind it, so grants, membership, and audit rows are all recorded
 * against this derived name rather than a user id. Everything that has to agree on that name calls
 * this function instead of formatting the string itself, so the prefix can never drift between the
 * writer and the reader.
 *
 * Called by: {@link PrismaManagedExecutionEvidenceAuthority.load} in this file, and
 * `ManagedExecutionIdentityEnvelopeSource` in
 * libs/backend/agents/execution/inputs/main/src/managed-execution-identity-envelope-source.ts, which
 * checks the snapshot's execution subject against it before trusting a run.
 *
 * @param agentServiceId - The managed service's id.
 * @returns The principal name used for grants, membership lookups, and audit rows.
 */
export function __ManagedAgentServicePrincipal(agentServiceId: string): string
{
	return `agent-service:${agentServiceId}`;
}

/**
 * Checks a managed service's membership and access against Postgres, inside the caller's transaction.
 *
 * Reading the service, the revision, the newest signed membership, and the grants under one
 * transaction is what stops any of them changing between the check and the run being written.
 *
 * A managed agent acts as itself, not on behalf of whoever pressed run-now, so nothing about the
 * human requester reaches this class — the access it grants must be the agent's own.
 *
 * Called by: `ManagedExecutionIdentityEnvelopeSource` in
 * libs/backend/agents/execution/inputs/main/src/managed-execution-identity-envelope-source.ts;
 * constructed by `_CreateManagedExecutionEvidenceAuthority` in
 * `prisma-managed-execution-evidence.factory.ts`.
 */
export class PrismaManagedExecutionEvidenceAuthority implements ManagedExecutionEvidenceAuthority
{
	/** Trusted membership configuration fixed by app composition. */
	private readonly config: ManagedExecutionEvidenceConfig;

	/**
	 * @param config - Trusted issuer, staleness limit, and signature verifier, fixed at composition.
	 * @throws Error when the issuer id is blank or the staleness limit is not a positive safe integer.
	 *   Failing here rather than per request means a misconfigured deployment cannot silently accept
	 *   membership evidence of any age.
	 */
	constructor(config: ManagedExecutionEvidenceConfig)
	{
		if (config.trustedIssuerId.trim().length === 0 || !Number.isSafeInteger(config.maximumStalenessMs) || config.maximumStalenessMs <= 0) throw new Error("managed execution evidence requires a trusted issuer and positive staleness bound");
		this.config = config;
	}

	/**
	 * Re-reads everything a managed run's access depends on, inside the caller's transaction.
	 *
	 * In order: the revision must still be the published active revision of an active managed service
	 * in this silo; the agent's principal must have exactly one organisation's signed membership in the
	 * issuer's newest revision, and that signature must verify and be within the staleness limit; the
	 * revision must declare no `personal` scope; and every declared scope must be backed by a real
	 * grant. Only then are the identity and capability digest built.
	 *
	 * @param command - Silo, service, and the revision the caller believes is active.
	 * @param transaction - The caller's open transaction and the admission time.
	 * @returns `loaded` with the run's identity and its capability digest, or `denied` — see
	 *   {@link ManagedExecutionEvidenceResult} for what each reason means and whether to retry.
	 * @throws Whatever the database or the signature verifier throws. A throw is not a denial; the
	 *   caller's transaction rolls back and no run is admitted.
	 */
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
				integrationAssignments: { select: { integrationId: true, custodyReferenceId: true, toolDefinitions: true } },
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
 * Picks one signed membership assertion for the agent principal, or refuses.
 *
 * An agent may legitimately hold several membership scopes within one organisation, so the
 * lowest-sorting assertion id is chosen to make the choice repeatable. If the assertions span more
 * than one organisation, this returns null and the run is denied: there would be no single
 * organisation to record on the run.
 *
 * Choosing an assertion only fixes *who* the agent is. What it may reach is decided separately, by
 * intersecting the revision's scope attachments against the grants actually held.
 *
 * @returns The chosen assertion, or null when the principal has no membership or spans organisations.
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

/** Reads one assertion's organisation id, so the caller can check that all of them agree. */
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

/**
 * Compares two strings by raw code unit, not by locale.
 *
 * `String.prototype.localeCompare` and the default `Array.sort` comparator can order the same two
 * strings differently on different builds or locales. Sorting is what makes the capability digest
 * reproducible, so the comparison has to be one that never varies.
 */
function _CompareCanonicalCoordinate(left: string, right: string): number
{
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

/**
 * Copies the authorised attachments and sorts them by scope, then subject type, then subject id.
 *
 * The sort is not cosmetic. RFC 8785 fixes object key order but leaves array order alone, so if this
 * list arrived in whatever order Postgres returned it, the same revision would produce a different
 * digest on different reads.
 * @see https://www.rfc-editor.org/rfc/rfc8785 — why array order must be fixed here rather than by
 *   the JSON serializer.
 */
function _CanonicalAttachments(values: readonly RevisionScopeAttachment[]): readonly ManagedRunInputScopeAttachment[]
{
	return [...values]
		.map(function _Copy(value): ManagedRunInputScopeAttachment { return { scope: value.scope, subjectType: value.subjectType, subjectId: value.subjectId }; })
		.sort(function _ByTriple(left, right): number { return _CompareCanonicalCoordinate(`${left.scope}\u0000${left.subjectType}\u0000${left.subjectId}`, `${right.scope}\u0000${right.subjectType}\u0000${right.subjectId}`); });
}

/** Sorts the assigned skill revisions by skill id, then revision id, so the capability digest does not depend on database row order. */
function _CanonicalSkillAssignments(values: readonly { skillId: string; skillRevisionId: string }[]): JsonValue
{
	return [...values].sort(function _BySkill(left, right): number { return _CompareCanonicalCoordinate(`${left.skillId}\u0000${left.skillRevisionId}`, `${right.skillId}\u0000${right.skillRevisionId}`); }) as JsonValue;
}

/** Rebuilds each integration assignment with only the fields that affect access — custody reference and reviewed tool definitions — and sorts both the tools by name and the integrations by id, so the capability digest does not depend on database row order. */
function _CanonicalIntegrationAssignments(values: readonly { integrationId: string; custodyReferenceId: string; toolDefinitions: Prisma.JsonValue }[]): JsonValue
{
	return [...values]
		.map(function _Copy(value)
		{
			const toolDefinitions = value.toolDefinitions as unknown as readonly ReviewedIntegrationToolDefinition[];
			return {
				integrationId: value.integrationId,
				custodyReferenceId: value.custodyReferenceId,
				toolDefinitions: [...toolDefinitions]
					.map(function _Tool(tool) { return { name: tool.name, description: tool.description, parametersSchema: tool.parametersSchema, parametersSchemaDigest: tool.parametersSchemaDigest }; })
					.sort(function _ByTool(left, right): number { return _CompareCanonicalCoordinate(left.name, right.name); }),
			};
		})
		.sort(function _ByIntegration(left, right): number { return _CompareCanonicalCoordinate(`${left.integrationId}\u0000${left.custodyReferenceId}`, `${right.integrationId}\u0000${right.custodyReferenceId}`); }) as JsonValue;
}
