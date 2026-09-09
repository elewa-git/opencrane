import { OrgMemberStatus, PrincipalProvenance, type Prisma } from "@prisma/client";
import { ___StandaloneMembershipSchema, ExecutionSubjectMembershipKinds, type ExecutionSubjectHumanMembershipEvidence } from "@opencrane/contracts";

import type { HumanMembershipEvidenceConfig, HumanMembershipEvidenceRepository } from "./human-membership.types";
import { __SelectCurrentFleetMembershipAssertion } from "./membership-assertion-selection";
import { __VerifyCurrentFleetMembershipEvidence } from "./membership-authority";
import { FleetMembershipAssertionSelectionOutcomes, FleetMembershipDeploymentModes, FleetMembershipEvidenceOutcomes, type FleetMembershipEvidenceConfig } from "./membership-authority.types";
import { PrismaFleetMembershipAuthorityRepository } from "./prisma-membership-authority";

/** Reads the deployment-selected membership authority on the same transaction as run admission. */
export class PrismaHumanMembershipEvidenceRepository implements HumanMembershipEvidenceRepository
{
	/** Shares the caller's transaction; this adapter never creates membership or grants. */
	public constructor(private readonly transaction: Prisma.TransactionClient, private readonly config: HumanMembershipEvidenceConfig)
	{
		if (!Number.isSafeInteger(config.maximumStalenessMs) || config.maximumStalenessMs <= 0 || config.maximumStalenessMs > 86_400_000)
			throw new Error("Human membership requires a trust lifetime between one millisecond and 24 hours");
		if (config.mode === FleetMembershipDeploymentModes.Fleet && !config.trustedIssuerId.trim())
			throw new Error("Fleet membership requires a trusted issuer");
		if (config.mode === FleetMembershipDeploymentModes.Standalone && (!config.siloId.trim() || !config.trustedOidcIssuer.trim()))
			throw new Error("Standalone membership requires a deployment silo and OIDC issuer");
	}

	/** Rechecks current authority without falling back from one configured mode to another. */
	public async load(siloId: string, principalId: string, nowEpochMs: number): Promise<ExecutionSubjectHumanMembershipEvidence | null>
	{
		if (!Number.isSafeInteger(nowEpochMs) || nowEpochMs <= 0 || !Number.isFinite(new Date(nowEpochMs + this.config.maximumStalenessMs).getTime()))
			return null;
		if (this.config.mode === FleetMembershipDeploymentModes.Fleet)
			return this._loadFleet(siloId, principalId, nowEpochMs, this.config);
		if (this.config.mode !== FleetMembershipDeploymentModes.Standalone || siloId !== this.config.siloId)
			return null;
		const principal = await this.transaction.principal.findFirst({
			where: { id: principalId, siloId, provenance: PrincipalProvenance.External, issuer: this.config.trustedOidcIssuer },
			select: { id: true, siloId: true, issuer: true, subject: true, provenance: true },
		});
		if (principal === null || principal.id !== principalId || principal.siloId !== siloId || principal.provenance !== PrincipalProvenance.External || principal.issuer !== this.config.trustedOidcIssuer)
			return null;
		const membership = await this.transaction.orgMembership.findUnique({
			where: { clusterTenant_subject: { clusterTenant: siloId, subject: principal.subject } },
			select: { id: true, clusterTenant: true, subject: true, status: true, updatedAt: true },
		});
		if (membership === null || membership.status !== OrgMemberStatus.Active || membership.clusterTenant !== siloId || membership.subject !== principal.subject)
			return null;
		const result = ___StandaloneMembershipSchema.safeParse({ kind: ExecutionSubjectMembershipKinds.Standalone, principalId, siloId, issuer: principal.issuer, subjectId: principal.subject, membershipId: membership.id, membershipUpdatedAt: membership.updatedAt.toISOString(), observedAt: new Date(nowEpochMs).toISOString(), trustedUntil: new Date(nowEpochMs + this.config.maximumStalenessMs).toISOString() });
		return result.success ? result.data : null;
	}

	/** Retains the signed assertion selector, verifier and monotonic acceptance transaction. */
	private async _loadFleet(siloId: string, principalId: string, nowEpochMs: number, config: FleetMembershipEvidenceConfig): Promise<ExecutionSubjectHumanMembershipEvidence | null>
	{
		const repository = new PrismaFleetMembershipAuthorityRepository(this.transaction);
		const selected = await __SelectCurrentFleetMembershipAssertion(repository, { trustedIssuerId: config.trustedIssuerId, siloId, subjectId: principalId });
		if (selected.outcome === FleetMembershipAssertionSelectionOutcomes.Denied)
			return null;
		const verified = await __VerifyCurrentFleetMembershipEvidence(repository, config.verifier, { trustedIssuerId: config.trustedIssuerId, siloId, subjectId: principalId, assertionId: selected.assertionId, nowEpochMs, maximumStalenessMs: config.maximumStalenessMs });
		if (verified.outcome !== FleetMembershipEvidenceOutcomes.Trusted || verified.evidence.subjectId !== principalId)
			return null;
		const evidence = verified.evidence;
		return { kind: ExecutionSubjectMembershipKinds.Fleet, principalId, siloId, revision: evidence.revision, assertionId: evidence.assertionId, payloadDigest: evidence.payloadDigest, decisionEvidenceId: evidence.assertionId, trustedUntil: new Date(evidence.trustedUntilEpochMs).toISOString() };
	}
}
