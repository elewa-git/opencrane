import type { Prisma } from "@prisma/client";
import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import { __VerifyCurrentFleetMembershipEvidence, FleetMembershipEvidenceOutcomes, PrismaFleetMembershipAuthorityRepository, type FleetMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";
import { RunInputSnapshotIdentityKinds } from "@opencrane/contracts";
import { AgentServiceKinds } from "@opencrane/models/agents";
import type { JsonValue } from "@opencrane/util";

import type { IdentityEnvelopeInput, IdentityEnvelopeSource, SessionAssemblyCommand, SessionAssemblyLoad } from "./session-assembly.types";
import { PrismaPersonalExecutionIdentityAuthorityRepository } from "./prisma-personal-execution-identity-authority-repository";

/**
 * Verifies the one signed personal-scope assertion for a browser session, inside the admission
 * transaction.
 *
 * All the request supplies is the subject (from the session) and the silo (from the host), both
 * through the assembly command. Everything else — assertion, organisation, scope, capability digest
 * — this source reads from the database inside the transaction. A browser request body never
 * becomes identity evidence.
 */
export class PersonalExecutionIdentityEnvelopeSource implements IdentityEnvelopeSource
{
	/** Fleet-membership trust settings, including the mounted signing key, set once by app composition. */
	private readonly config: FleetMembershipEvidenceConfig;

	/**
	 * Creates the source over the one mounted fleet-membership verifier.
	 *
	 * Validates the configuration at construction rather than per request, so a deployment with a
	 * missing issuer or a nonsensical staleness bound fails at startup instead of admitting runs
	 * against unverifiable membership.
	 *
	 * @param config - Trusted issuer, verifier, and the maximum age a signature may have.
	 * @throws When `trustedIssuerId` is blank, or `maximumStalenessMs` is not a positive safe integer.
	 */
	constructor(config: FleetMembershipEvidenceConfig)
	{
		if (config.trustedIssuerId.trim().length === 0 || !Number.isSafeInteger(config.maximumStalenessMs) || config.maximumStalenessMs <= 0)
		{
			throw new Error("personal execution identity requires a trusted issuer and positive staleness bound");
		}
		this.config = config;
	}

	/**
	 * Verifies one personal assertion and returns the signed identity evidence.
	 *
	 * Refuses when more than one assertion matches rather than picking one: an ambiguous entitlement
	 * means the organisation the run would act for is unclear, and guessing it could cross an
	 * organisation boundary.
	 *
	 * @param command - The admission command. Only `siloId` (from the request host) and
	 * `executionSubjectId` (from the session) are used; nothing from a request body.
	 * @param run - Facts from the run authority. Must be a personal run whose `delegatedUserId`
	 * equals the command's subject.
	 * @param transaction - The admission transaction; the signature check, the re-read, and the grant
	 * read all go through it.
	 * @returns `loaded` with the user identity and a digest over its effective grants. `denied` with
	 * `identity_unavailable` when the run is not a personal run for this subject, or `membership_stale`
	 * when no single assertion was found, verification failed, or the re-read did not match what was
	 * verified.
	 */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<IdentityEnvelopeInput>>
	{
		const prisma = transaction.prisma as Prisma.TransactionClient;
		// 1. Reject a managed service before reading any personal membership or dataset row.
		if (command.identityKind !== "user" || run.agentKind !== AgentServiceKinds.Personal || run.delegatedUserId !== command.executionSubjectId)
		{
			return { outcome: "denied", reason: "identity_unavailable" };
		}

		// 2. Take the one current signed personal scope. Refuse rather than guess when more than one matches.
		const identityAuthority = new PrismaPersonalExecutionIdentityAuthorityRepository(prisma);
		const assertion = await identityAuthority.loadLatestPersonalAssertion(this.config.trustedIssuerId, command.siloId, command.executionSubjectId);
		if (assertion === null) return { outcome: "denied", reason: "membership_stale" };

		// 3. Check the signature, scope, freshness, and the monotonic revision high-watermark in this same transaction.
		const membership = await __VerifyCurrentFleetMembershipEvidence(new PrismaFleetMembershipAuthorityRepository(prisma), this.config.verifier, {
			trustedIssuerId: this.config.trustedIssuerId,
			siloId: command.siloId,
			subjectId: command.executionSubjectId,
			assertionId: assertion.assertionId,
			scope: { kind: "personal", organizationId: assertion.organizationId, userId: command.executionSubjectId },
			nowEpochMs: transaction.admittedAtEpochMs,
			maximumStalenessMs: this.config.maximumStalenessMs,
		});
		if (membership.outcome === FleetMembershipEvidenceOutcomes.Denied)
		{
			return { outcome: "denied", reason: "membership_stale" };
		}
		const verifiedAssertion = await identityAuthority.loadVerifiedPersonalAssertion(membership.evidence.issuerId, command.siloId, membership.evidence.revision, membership.evidence.payloadDigest, command.executionSubjectId);
		if (verifiedAssertion === null || verifiedAssertion.assertionId !== membership.evidence.assertionId || verifiedAssertion.organizationId !== membership.evidence.organizationId)
		{
			return { outcome: "denied", reason: "membership_stale" };
		}

		// 4. Hash the membership and active-revision facts into one digest before later sources add runtime inputs.
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

/**
 * Compares two grants on all their fields, so the capability digest never depends on the order rows
 * came back in.
 *
 * @see https://www.rfc-editor.org/rfc/rfc8785 - JSON Canonicalization Scheme, used by
 * `__DigestCanonicalJson` for `capabilitySetDigest`. It fixes object key order but not array order,
 * so the grants array must be sorted before it is hashed.
 */
function _CompareCanonicalGrant(left: { readonly catalogId: string; readonly catalogRevision: number; readonly catalogDigest: string; readonly capabilityId: string; readonly resourceKind: string; readonly resourceId: string; readonly effect: string; readonly priority: number; readonly validFrom: string; readonly expiresAt: string | null }, right: { readonly catalogId: string; readonly catalogRevision: number; readonly catalogDigest: string; readonly capabilityId: string; readonly resourceKind: string; readonly resourceId: string; readonly effect: string; readonly priority: number; readonly validFrom: string; readonly expiresAt: string | null }): number
{
	const leftKey = `${left.catalogId}\u0000${left.catalogRevision}\u0000${left.catalogDigest}\u0000${left.capabilityId}\u0000${left.resourceKind}\u0000${left.resourceId}\u0000${left.effect}\u0000${left.priority}\u0000${left.validFrom}\u0000${left.expiresAt ?? ""}`;
	const rightKey = `${right.catalogId}\u0000${right.catalogRevision}\u0000${right.catalogDigest}\u0000${right.capabilityId}\u0000${right.resourceKind}\u0000${right.resourceId}\u0000${right.effect}\u0000${right.priority}\u0000${right.validFrom}\u0000${right.expiresAt ?? ""}`;
	if (leftKey < rightKey) return -1;
	if (leftKey > rightKey) return 1;
	return 0;
}
