import { AgentRevisionState, AgentServiceKind, AgentServiceState, AuthorizationBoundaryCoverage, AuthorizationBoundaryKind, PrincipalProvenance } from "@prisma/client";
import type { Prisma } from "@prisma/client";

import { RunInputSnapshotIdentityKinds, type ManagedRunInputBoundaryAttachment } from "@opencrane/contracts";
import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import { __VerifyCurrentFleetMembershipEvidence, PrismaFleetMembershipAuthorityRepository } from "@opencrane/backend/server/iam/membership";
import { RevisionBoundaryCoverages, RevisionBoundaryKinds, type ReviewedIntegrationToolDefinition, type RevisionBoundaryAttachment } from "@opencrane/models/agents";
import type { JsonValue } from "@opencrane/util";

import { __ResolveEffectiveBoundaryAttachments } from "../boundary-attachment-authority";
import { __CreatePrismaBoundaryGrantResolver } from "./prisma-boundary-grant.factory";
import { __ManagedAgentServicePrincipal, MANAGED_AGENT_SERVICE_PRINCIPAL_ISSUER } from "../managed-agent-service-principal";
import type { ManagedExecutionEvidenceAuthority, ManagedExecutionEvidenceCommand, ManagedExecutionEvidenceConfig, ManagedExecutionEvidenceResult, ManagedExecutionEvidenceTransaction } from "../managed-execution-evidence.types";

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
 * `managed-execution-evidence.factory.ts`.
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
	 * in this silo; the agent's principal must have exactly one signed membership assertion in the
	 * issuer's newest revision, and that signature must verify and be within the staleness limit; the
	 * revision must declare no personal boundary; and every declared boundary must be backed by a real
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
				agentService: { select: { principalId: true, principal: { select: { issuer: true, subject: true, provenance: true } } } },
				modelDefinitionId: true,
				budget: true,
				boundaryAttachments: { select: { boundaryKind: true, boundaryGroupId: true, boundaryPrincipalId: true, boundaryCoverage: true } },
				skillAssignments: { select: { skillId: true, skillRevisionId: true } },
				integrationAssignments: { select: { integrationId: true, custodyReferenceId: true, toolDefinitions: true } },
			},
		});
		if (revision === null) return { outcome: "denied", reason: "run_not_admittable" };

		const expectedPrincipalId = __ManagedAgentServicePrincipal(command.agentServiceId);
		const servicePrincipal = revision.agentService.principal;
		if (revision.agentService.principalId !== expectedPrincipalId
			|| servicePrincipal === null
			|| servicePrincipal.provenance !== PrincipalProvenance.Internal
			|| servicePrincipal.issuer !== MANAGED_AGENT_SERVICE_PRINCIPAL_ISSUER
			|| servicePrincipal.subject !== command.agentServiceId) return { outcome: "denied", reason: "identity_unavailable" };
		const principal = revision.agentService.principalId;
		const assertion = await _SelectMembershipAssertion(transaction.prisma, this.config.trustedIssuerId, command.siloId, principal);
		if (assertion === null) return { outcome: "denied", reason: "membership_stale" };
		const membership = await __VerifyCurrentFleetMembershipEvidence(new PrismaFleetMembershipAuthorityRepository(transaction.prisma), this.config.verifier, {
			trustedIssuerId: this.config.trustedIssuerId,
			siloId: command.siloId,
			subjectId: principal,
			assertionId: assertion.assertionId,
			nowEpochMs: transaction.admittedAtEpochMs,
			maximumStalenessMs: this.config.maximumStalenessMs,
		});
		if ("reason" in membership || membership.evidence.subjectId !== principal) return { outcome: "denied", reason: "membership_stale" };

		const declared = revision.boundaryAttachments.map(_Attachment);
		if (declared.some(_IsPersonalAttachment)) return { outcome: "denied", reason: "memory_scope_unavailable" };
		const resolver = __CreatePrismaBoundaryGrantResolver(transaction.prisma);
		const effective = await __ResolveEffectiveBoundaryAttachments(resolver, command.siloId, [principal], declared, transaction.admittedAtEpochMs);
		if (effective.rejected.length > 0) return { outcome: "denied", reason: "memory_scope_unavailable" };
		const attachments = _CanonicalAttachments(effective.authorized);
		const attachmentDigest = __DigestCanonicalJson(attachments as unknown as JsonValue);
		const capabilitySetDigest = __DigestCanonicalJson({
			siloId: command.siloId,
			agentServiceId: command.agentServiceId,
			agentRevisionId: revision.id,
			agentRevisionDigest: revision.digest,
			executionSubjectId: principal,
			fleetMembershipRevision: membership.evidence.revision,
			fleetMembershipPayloadDigest: membership.evidence.payloadDigest,
			effectiveBoundaryAttachments: attachments,
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
					fleetMembershipRevision: membership.evidence.revision,
					fleetMembershipIssuer: membership.evidence.issuerId,
					fleetMembershipIssuerKeyId: membership.evidence.issuerKeyId,
					fleetMembershipAssertionId: membership.evidence.assertionId,
					fleetMembershipPayloadDigest: membership.evidence.payloadDigest,
					fleetMembershipTrustedUntil: new Date(membership.evidence.trustedUntilEpochMs).toISOString(),
					effectiveBoundaryAttachments: attachments,
					effectiveBoundaryAttachmentDigest: attachmentDigest,
				},
				capabilitySetDigest,
			},
		};
	}
}

/**
 * Picks one signed membership assertion for the agent principal, or refuses.
 *
 * Membership proves active silo admission, not a knowledge boundary. Exactly one matching assertion
 * is required; duplicates return null because selecting one would hide ambiguous signed authority.
 *
 * Choosing an assertion only fixes *who* the agent is. What it may reach is decided separately, by
 * intersecting the revision's boundary attachments against the grants actually held.
 *
 * @returns The assertion, or null when membership is absent or ambiguous.
 */
async function _SelectMembershipAssertion(prisma: Prisma.TransactionClient, trustedIssuerId: string, siloId: string, subjectId: string): Promise<{ assertionId: string } | null>
{
	const revision = await prisma.verifiedFleetMembershipRevision.findFirst({
		where: { issuerId: trustedIssuerId, siloId },
		orderBy: { revision: "desc" },
		select: { assertions: { where: { siloId, subjectId }, orderBy: { assertionId: "asc" }, select: { assertionId: true } } },
	});
	const assertions = revision?.assertions ?? [];
	return assertions.length === 1 ? assertions[0]! : null;
}

/** Maps a Prisma attachment into the stable agent-domain contract. */
function _Attachment(value: { boundaryKind: AuthorizationBoundaryKind; boundaryGroupId: string | null; boundaryPrincipalId: string | null; boundaryCoverage: AuthorizationBoundaryCoverage }): RevisionBoundaryAttachment
{
	if (value.boundaryKind === AuthorizationBoundaryKind.Group && value.boundaryGroupId !== null && value.boundaryPrincipalId === null)
	{
		const boundaryCoverage = value.boundaryCoverage === AuthorizationBoundaryCoverage.Descendants ? RevisionBoundaryCoverages.Descendants : RevisionBoundaryCoverages.Exact;
		return { boundaryKind: RevisionBoundaryKinds.Group, boundaryId: value.boundaryGroupId, boundaryCoverage };
	}
	if (value.boundaryKind === AuthorizationBoundaryKind.Personal && value.boundaryPrincipalId !== null && value.boundaryGroupId === null && value.boundaryCoverage === AuthorizationBoundaryCoverage.Exact) return { boundaryKind: RevisionBoundaryKinds.Personal, boundaryId: value.boundaryPrincipalId, boundaryCoverage: RevisionBoundaryCoverages.Exact };
	throw new Error("invalid persisted managed revision boundary attachment");
}

/** Returns whether an attachment would expose personal memory to a managed service. */
function _IsPersonalAttachment(value: RevisionBoundaryAttachment): boolean
{
	return value.boundaryKind === RevisionBoundaryKinds.Personal;
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
 * Copies the authorised attachments and sorts them by boundary kind, id, and coverage.
 *
 * The sort is not cosmetic. RFC 8785 fixes object key order but leaves array order alone, so if this
 * list arrived in whatever order Postgres returned it, the same revision would produce a different
 * digest on different reads.
 * @see https://www.rfc-editor.org/rfc/rfc8785 — why array order must be fixed here rather than by
 *   the JSON serializer.
 */
function _CanonicalAttachments(values: readonly RevisionBoundaryAttachment[]): readonly ManagedRunInputBoundaryAttachment[]
{
	return [...values]
		.map(function _Copy(value): ManagedRunInputBoundaryAttachment { return { boundaryKind: value.boundaryKind, boundaryId: value.boundaryId, boundaryCoverage: value.boundaryCoverage }; })
		.sort(function _ByBoundary(left, right): number { return _CompareCanonicalCoordinate(`${left.boundaryKind}\u0000${left.boundaryId}\u0000${left.boundaryCoverage}`, `${right.boundaryKind}\u0000${right.boundaryId}\u0000${right.boundaryCoverage}`); });
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
