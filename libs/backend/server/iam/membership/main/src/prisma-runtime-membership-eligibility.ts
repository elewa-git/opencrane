import type { Prisma } from "@prisma/client";

import { __VerifyCurrentFleetMembershipEvidence } from "./membership-authority";
import type { FleetMembershipEvidenceConfig } from "./membership-authority.types";
import { PrismaFleetMembershipAuthorityRepository } from "./prisma-membership-authority";
import type { RuntimeMembershipEligibility, RuntimeMembershipEligibilityCommand } from "./runtime-membership-eligibility.types";

/** Re-runs signed fleet-membership verification on the runtime effect transaction. */
export class PrismaRuntimeMembershipEligibilityAuthority implements RuntimeMembershipEligibility
{
	/** Transaction shared with the ToolInvocation admission. */
	private readonly transaction: Prisma.TransactionClient;
	/** Deployment-owned issuer, key, and maximum signed-revision age. */
	private readonly config: FleetMembershipEvidenceConfig;

	/**
	 * Binds membership verification to the caller's open transaction and trusted deployment key.
	 *
	 * Called by: the OpenCrane runtime composition when it builds external-effect admission.
	 * @param transaction - Transaction that will also persist the admitted ToolInvocation.
	 * @param config - Deployment-owned membership issuer, signature verifier, and staleness limit.
	 */
	constructor(transaction: Prisma.TransactionClient, config: FleetMembershipEvidenceConfig)
	{
		this.transaction = transaction;
		this.config = config;
	}

	/** @inheritdoc */
	async isEligible(command: RuntimeMembershipEligibilityCommand): Promise<boolean>
	{
		const identity = command.identity;
		if (identity.fleetMembershipIssuer !== this.config.trustedIssuerId)
			return false;
		const repository = new PrismaFleetMembershipAuthorityRepository(this.transaction);
		const result = await __VerifyCurrentFleetMembershipEvidence(repository, this.config.verifier, {
			trustedIssuerId: this.config.trustedIssuerId,
			siloId: command.siloId,
			subjectId: identity.executionSubjectId,
			assertionId: identity.fleetMembershipAssertionId,
			nowEpochMs: command.nowEpochMs,
			maximumStalenessMs: this.config.maximumStalenessMs,
		});
		if (result.outcome === "denied")
			return false;
		const trustedUntilEpochMs = Date.parse(identity.fleetMembershipTrustedUntil);
		return Number.isFinite(trustedUntilEpochMs)
			&& trustedUntilEpochMs >= command.nowEpochMs
			&& result.evidence.issuerId === identity.fleetMembershipIssuer
			&& result.evidence.issuerKeyId === identity.fleetMembershipIssuerKeyId
			&& result.evidence.revision === identity.fleetMembershipRevision
			&& result.evidence.assertionId === identity.fleetMembershipAssertionId
			&& result.evidence.subjectId === identity.executionSubjectId
			&& result.evidence.payloadDigest === identity.fleetMembershipPayloadDigest
			&& result.evidence.trustedUntilEpochMs === trustedUntilEpochMs;
	}
}
