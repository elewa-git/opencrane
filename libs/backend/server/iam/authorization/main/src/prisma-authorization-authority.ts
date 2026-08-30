import type { Prisma } from "@prisma/client";

import { PrismaAuditDecisionWriterRepository, type AuditDecisionWriterRepository } from "@opencrane/backend/server/iam/audit-writer";
import { AuthorizationDecisionOutcomes, __ProductAuthorizationCapability } from "@opencrane/models/authorization";

import { __AuthorizationAuthority } from "./authorization-authority";
import type { AdmitProductAuthorizationCommand, AdmitProductAuthorizationResult, AuthorizationAuthority, ProductAuthorizationDecisionRecorder } from "./authorization-authority.types";
import { PrismaAuthorizationResourceGrantRetirementRepository } from "./prisma-authorization-resource-grant-retirement-repository";
import { PrismaAuthorizationGrantRepository } from "./prisma-authorization-grants";
import { PrismaManagedAuthorizationGrantRepository } from "./prisma-managed-authorization-grant-repository";

/** Writes one authority-derived decision into the shared append-only audit log. */
class _PrismaProductAuthorizationDecisionRecorder implements ProductAuthorizationDecisionRecorder
{
	/** Writer already bound to the protected domain transaction. */
	private readonly auditDecisions: AuditDecisionWriterRepository;

	constructor(auditDecisions: AuditDecisionWriterRepository)
	{
		this.auditDecisions = auditDecisions;
	}

	/** @inheritdoc */
	async record(command: AdmitProductAuthorizationCommand, result: AdmitProductAuthorizationResult): Promise<void>
	{
		if (result.evidence === null || result.rule === null)
		{
			throw new Error("cannot record authorization admission without derived evidence");
		}
		const capability = __ProductAuthorizationCapability(command.resource.kind, command.action);
		if (capability === null)
		{
			throw new Error("cannot record authorization admission without catalogue capability");
		}
		await this.auditDecisions.append({
			decisionDigest: result.evidence.decisionDigest,
			siloId: command.siloId,
			actorKind: command.actorKind,
			actorId: command.actorId,
			resourceKind: command.resource.kind,
			resourceId: command.resource.id,
			action: command.action,
			catalogId: capability.catalog.catalogId,
			catalogRevision: capability.catalog.revision,
			catalogDigest: capability.catalog.digest,
			argumentsDigest: command.argumentsDigest,
			policyRevisionHash: result.evidence.policyRevisionHash,
			effectiveAuthorizationDigest: result.evidence.effectiveAuthorizationDigest,
			membershipRevision: command.membershipRevision,
			outcome: result.outcome === AuthorizationDecisionOutcomes.Allow ? "allow" : "deny",
			reasonCode: result.reason,
			decidedAt: new Date(command.nowEpochMs),
		});
	}
}

/** Central authorization authority bound to a domain UnitOfWork's Prisma transaction. */
export class PrismaAuthorizationAuthority extends __AuthorizationAuthority implements AuthorizationAuthority
{
	/**
	 * Creates the authority over the transaction that owns the protected domain operation.
	 * @param transaction - Prisma transaction shared with the protected product write.
	 */
	constructor(transaction: Prisma.TransactionClient)
	{
		const repository = new PrismaAuthorizationGrantRepository(transaction);
		const recorder = new _PrismaProductAuthorizationDecisionRecorder(new PrismaAuditDecisionWriterRepository(transaction));
		const managedGrants = new PrismaManagedAuthorizationGrantRepository(transaction);
		const resourceGrantRetirement = new PrismaAuthorizationResourceGrantRetirementRepository(transaction);
		super(repository, recorder, managedGrants, resourceGrantRetirement);
	}
}
