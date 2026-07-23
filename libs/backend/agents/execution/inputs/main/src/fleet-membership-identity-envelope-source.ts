import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { __VerifyCurrentFleetMembershipEvidence, PrismaFleetMembershipAuthorityRepository } from "@opencrane/backend/server/iam/membership";
import type { FleetMembershipAdmissionExpectation, FleetMembershipSignatureVerifier } from "@opencrane/backend/server/iam/membership";
import { ___IsSha256Digest } from "@opencrane/util";

import type { CapabilitySetDigestSource, IdentityEnvelopeInput, IdentityEnvelopeSource, SessionAssemblyCommand, SessionAssemblyLoad } from "./session-assembly.types.js";

/**
 * Identity source that derives snapshot evidence only from a signed membership revision accepted in
 * the admission transaction. It never accepts caller-assembled identity fields: membership evidence,
 * capability digest, and the run either commit together or all roll back.
 */
export class FleetMembershipIdentityEnvelopeSource implements IdentityEnvelopeSource
{
	/** Signed fleet membership expectation configured by the owning control-plane composition. */
	private readonly expectation: FleetMembershipAdmissionExpectation;
	/** Cryptographic verifier for exact signed fleet revision envelopes. */
	private readonly verifier: FleetMembershipSignatureVerifier;
	/** Same-transaction capability digest authority. */
	private readonly capabilitySet: CapabilitySetDigestSource;

	/** Creates an identity source that cannot accept caller-assembled membership evidence. */
	constructor(expectation: FleetMembershipAdmissionExpectation, verifier: FleetMembershipSignatureVerifier, capabilitySet: CapabilitySetDigestSource)
	{
		this.expectation = expectation;
		this.verifier = verifier;
		this.capabilitySet = capabilitySet;
	}

	/** Verifies membership, advances its high-watermark, and freezes the resulting signed evidence into one input. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<IdentityEnvelopeInput>>
	{
		// 1. Resolve the capability digest within the final transaction so a concurrent revocation cannot leave stale grants in the snapshot.
		const capabilitySet = await this.capabilitySet.load(command, run, transaction);
		if (capabilitySet.outcome === "denied") return capabilitySet;
		if (!___IsSha256Digest(capabilitySet.value)) return { outcome: "denied", reason: "identity_unavailable" };

		// 2. Verify the exact membership assertion and update the issuer/silo high-watermark through this same transaction client.
		const membership = await __VerifyCurrentFleetMembershipEvidence(new PrismaFleetMembershipAuthorityRepository(transaction.prisma), this.verifier, {
			trustedIssuerId: this.expectation.trustedIssuerId,
			siloId: command.siloId,
			subjectId: command.executionSubjectId,
			assertionId: this.expectation.assertionId,
			scope: this.expectation.scope,
			nowEpochMs: transaction.admittedAtEpochMs,
			maximumStalenessMs: this.expectation.maximumStalenessMs,
		});
		if (membership.outcome === "denied") return { outcome: "denied", reason: "membership_stale" };

		// 3. Project only verifier-produced facts so the persisted snapshot cannot be fabricated by the admission caller.
		return {
			outcome: "loaded",
			value: {
				executionSubjectId: membership.evidence.subjectId,
				fleetMembershipRevision: membership.evidence.revision,
				fleetMembershipIssuer: membership.evidence.issuerId,
				fleetMembershipIssuerKeyId: membership.evidence.issuerKeyId,
				fleetMembershipAssertionId: membership.evidence.assertionId,
				fleetMembershipPayloadDigest: membership.evidence.payloadDigest,
				fleetMembershipTrustedUntil: new Date(membership.evidence.trustedUntilEpochMs).toISOString(),
				capabilitySetDigest: capabilitySet.value,
			},
		};
	}
}
