import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import { __VerifyCurrentFleetMembershipEvidence, PrismaFleetMembershipAuthorityRepository } from "@opencrane/backend/server/iam/membership";
import type { FleetMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";
import { RunInputSnapshotIdentityKinds } from "@opencrane/contracts";
import { AgentServiceKinds } from "@opencrane/models/agents";
import type { JsonValue } from "@opencrane/util";

import type { IdentityEnvelopeInput, IdentityEnvelopeSource, SessionAssemblyCommand, SessionAssemblyLoad } from "./session-assembly.types.js";
import { PrismaPersonalExecutionIdentityAuthorityRepository } from "./prisma-personal-execution-identity-authority-repository.js";

/**
 * Verifies the sole signed personal-scope assertion for a browser session at the final admission
 * fence.
 *
 * The request contributes only the already session-derived subject and host-derived silo through
 * the assembly command. This source selects the assertion, organisation, scope, and capability
 * digest from durable transaction state; it never turns a browser body into identity evidence.
 */
export class PersonalExecutionIdentityEnvelopeSource implements IdentityEnvelopeSource
{
	/** Mounted-key-backed fleet trust configuration fixed by app composition. */
	private readonly config: FleetMembershipEvidenceConfig;

	/** Creates the source over one fixed, mounted fleet-membership verifier. */
	constructor(config: FleetMembershipEvidenceConfig)
	{
		if (config.trustedIssuerId.trim().length === 0 || !Number.isSafeInteger(config.maximumStalenessMs) || config.maximumStalenessMs <= 0)
		{
			throw new Error("personal execution identity requires a trusted issuer and positive staleness bound");
		}
		this.config = config;
	}

	/** Verifies one unambiguous personal assertion and freezes signer-produced identity evidence. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<IdentityEnvelopeInput>>
	{
		// 1. Reject a managed service before any personal membership or dataset coordinate can be read.
		if (command.identityKind !== "user" || run.agentKind !== AgentServiceKinds.Personal || run.delegatedUserId !== command.executionSubjectId)
		{
			return { outcome: "denied", reason: "identity_unavailable" };
		}

		// 2. Select exactly one current signed personal scope; ambiguous entitlement is never guessed.
		const identityAuthority = new PrismaPersonalExecutionIdentityAuthorityRepository(transaction.prisma);
		const assertion = await identityAuthority.loadLatestPersonalAssertion(this.config.trustedIssuerId, command.siloId, command.executionSubjectId);
		if (assertion === null) return { outcome: "denied", reason: "membership_stale" };

		// 3. Verify signature, scope, freshness, and monotonic high-watermark through this same transaction.
		const membership = await __VerifyCurrentFleetMembershipEvidence(new PrismaFleetMembershipAuthorityRepository(transaction.prisma), this.config.verifier, {
			trustedIssuerId: this.config.trustedIssuerId,
			siloId: command.siloId,
			subjectId: command.executionSubjectId,
			assertionId: assertion.assertionId,
			scope: { kind: "personal", organizationId: assertion.organizationId, userId: command.executionSubjectId },
			nowEpochMs: transaction.admittedAtEpochMs,
			maximumStalenessMs: this.config.maximumStalenessMs,
		});
		if (membership.outcome === "denied")
		{
			return { outcome: "denied", reason: "membership_stale" };
		}
		const verifiedAssertion = await identityAuthority.loadVerifiedPersonalAssertion(membership.evidence.issuerId, command.siloId, membership.evidence.revision, membership.evidence.payloadDigest, command.executionSubjectId);
		if (verifiedAssertion === null || verifiedAssertion.assertionId !== membership.evidence.assertionId || verifiedAssertion.organizationId !== membership.evidence.organizationId)
		{
			return { outcome: "denied", reason: "membership_stale" };
		}

		// 4. Seal the membership and current active revision facts before later sources add runtime inputs.
		const grants = await identityAuthority.loadEffectivePersonalGrants(command.siloId, command.executionSubjectId, membership.evidence.organizationId, new Date(transaction.admittedAt));
		const capabilitySetDigest = __DigestCanonicalJson({
			siloId: command.siloId,
			executionSubjectId: command.executionSubjectId,
			agentServiceId: run.agentServiceId,
			agentRevisionId: run.agentRevisionId,
			effectiveContractDigest: run.effectiveContractDigest,
			organizationId: membership.evidence.organizationId,
			fleetMembershipRevision: membership.evidence.revision,
			fleetMembershipPayloadDigest: membership.evidence.payloadDigest,
			personalScopeUserId: command.executionSubjectId,
			effectivePersonalGrants: grants
				.map(function _CanonicalGrant(grant)
				{
					return { catalogId: grant.catalogId, catalogRevision: grant.catalogRevision, catalogDigest: grant.catalogDigest, capabilityId: grant.capabilityId, resourceKind: grant.resourceKind, resourceId: grant.resourceId, effect: grant.effect, priority: grant.priority, validFrom: grant.validFrom.toISOString(), expiresAt: grant.expiresAt?.toISOString() ?? null };
				})
				.sort(function _ByGrant(left, right): number { return _CompareCanonicalGrant(left, right); }),
		} as JsonValue);
		return {
			outcome: "loaded",
			value: {
				kind: RunInputSnapshotIdentityKinds.User,
				executionSubjectId: membership.evidence.subjectId,
				organizationId: membership.evidence.organizationId,
				fleetMembershipRevision: membership.evidence.revision,
				fleetMembershipIssuer: membership.evidence.issuerId,
				fleetMembershipIssuerKeyId: membership.evidence.issuerKeyId,
				fleetMembershipAssertionId: membership.evidence.assertionId,
				fleetMembershipPayloadDigest: membership.evidence.payloadDigest,
				fleetMembershipTrustedUntil: new Date(membership.evidence.trustedUntilEpochMs).toISOString(),
				capabilitySetDigest,
			},
		};
	}
}

/** Orders capability facts by every stable coordinate before one canonical policy digest is made. */
function _CompareCanonicalGrant(left: { readonly catalogId: string; readonly catalogRevision: number; readonly catalogDigest: string; readonly capabilityId: string; readonly resourceKind: string; readonly resourceId: string; readonly effect: string; readonly priority: number; readonly validFrom: string; readonly expiresAt: string | null }, right: { readonly catalogId: string; readonly catalogRevision: number; readonly catalogDigest: string; readonly capabilityId: string; readonly resourceKind: string; readonly resourceId: string; readonly effect: string; readonly priority: number; readonly validFrom: string; readonly expiresAt: string | null }): number
{
	const leftKey = `${left.catalogId}\u0000${left.catalogRevision}\u0000${left.catalogDigest}\u0000${left.capabilityId}\u0000${left.resourceKind}\u0000${left.resourceId}\u0000${left.effect}\u0000${left.priority}\u0000${left.validFrom}\u0000${left.expiresAt ?? ""}`;
	const rightKey = `${right.catalogId}\u0000${right.catalogRevision}\u0000${right.catalogDigest}\u0000${right.capabilityId}\u0000${right.resourceKind}\u0000${right.resourceId}\u0000${right.effect}\u0000${right.priority}\u0000${right.validFrom}\u0000${right.expiresAt ?? ""}`;
	if (leftKey < rightKey) return -1;
	if (leftKey > rightKey) return 1;
	return 0;
}
