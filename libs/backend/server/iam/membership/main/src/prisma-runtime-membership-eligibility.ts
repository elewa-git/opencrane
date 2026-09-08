import type { Prisma } from "@prisma/client";
import { ___StandaloneMembershipSchema, ExecutionSubjectMembershipKinds, type ExecutionSubjectHumanMembershipEvidence } from "@opencrane/contracts";

import { __SameMembershipBinding } from "./human-membership-evidence";
import type { HumanMembershipEvidenceConfig } from "./human-membership.types";
import { PrismaHumanMembershipEvidenceRepository } from "./prisma-human-membership-evidence";
import type { RuntimeMembershipEligibility, RuntimeMembershipEligibilityCommand } from "./runtime-membership-eligibility.types";

/** Rechecks human membership in the caller's effect transaction; managed service checks remain separate. */
export class PrismaRuntimeMembershipEligibilityAuthority implements RuntimeMembershipEligibility
{
	/** Binds the reusable membership port to the caller's transaction and deployment policy. */
	constructor(private readonly transaction: Prisma.TransactionClient, private readonly config: HumanMembershipEvidenceConfig) {}

	/** Requires current human membership for the requester and any human execution Principal. */
	async isEligible(command: RuntimeMembershipEligibilityCommand): Promise<boolean>
	{
		const subject = command.executionSubject;
		if (subject.siloId !== command.siloId || subject.principalId !== subject.identity.principalId
			|| subject.principalId !== subject.membership.principalId || subject.membership.siloId !== command.siloId
			|| subject.identity.siloId !== command.siloId || subject.requester.siloId !== command.siloId
			|| subject.requester.membership.siloId !== command.siloId
			|| subject.requester.membership.principalId !== subject.requester.requesterPrincipalId)
			return false;
		const repository = new PrismaHumanMembershipEvidenceRepository(this.transaction, this.config);
		if (!await this._matches(repository, subject.requester.membership, command.nowEpochMs))
			return false;
		if (subject.membership.kind === ExecutionSubjectMembershipKinds.Managed)
			return true;
		return this._matches(repository, subject.membership, command.nowEpochMs);
	}

	/** Keeps Fleet's frozen signed revision checks and Standalone's frozen local row version checks. */
	private async _matches(repository: PrismaHumanMembershipEvidenceRepository, stored: ExecutionSubjectHumanMembershipEvidence, nowEpochMs: number): Promise<boolean>
	{
		const expiry = Date.parse(stored.trustedUntil);
		if (!Number.isFinite(expiry) || expiry <= nowEpochMs)
			return false;
		if (stored.kind === ExecutionSubjectMembershipKinds.Standalone && (!___StandaloneMembershipSchema.safeParse(stored).success || Date.parse(stored.observedAt) > nowEpochMs))
			return false;
		const current = await repository.load(stored.siloId, stored.principalId, nowEpochMs);
		if (current === null || !__SameMembershipBinding(stored, current))
			return false;
		if (stored.kind === ExecutionSubjectMembershipKinds.Fleet && current.kind === ExecutionSubjectMembershipKinds.Fleet)
			return stored.revision === current.revision && stored.assertionId === current.assertionId
				&& stored.payloadDigest === current.payloadDigest && stored.trustedUntil === current.trustedUntil;
		return true;
	}
}
