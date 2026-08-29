import { AuditDecisionActorKind, AuditDecisionOutcome, WorkloadKind, type Prisma } from "@prisma/client";

import type { AuditDecisionRecord, AuditDecisionWriterRepository } from "./audit-decision.types";

function _WorkloadKind(value: AuditDecisionRecord["workloadKind"]): WorkloadKind | undefined
{
	if (value === undefined)
		return undefined;
	if (value === "job")
		return WorkloadKind.Job;
	return WorkloadKind.Deployment;
}

function _Outcome(value: AuditDecisionRecord["outcome"]): AuditDecisionOutcome
{
	switch (value)
	{
		case "allow":
			return AuditDecisionOutcome.Allow;
		case "deny":
			return AuditDecisionOutcome.Deny;
		case "error":
			return AuditDecisionOutcome.Error;
	}
}

/** Writes append-only authorization decisions through the caller's existing transaction. */
export class PrismaAuditDecisionWriterRepository implements AuditDecisionWriterRepository
{
	/** Open transaction that commits the decision with the authorized effect. */
	private readonly transaction: Prisma.TransactionClient;

	/** @param transaction - The open transaction of the change being recorded. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/**
	 * Writes one final decision row into the append-only log.
	 *
	 * Called by: the central authorization authority, fleet membership authority, and standalone
	 * first-owner admission adapter.
	 * @param decision - The final decision to record; nothing rewrites this row.
	 */
	async append(decision: AuditDecisionRecord): Promise<void>
	{
		await this.transaction.auditDecision.create({ data: {
			decisionDigest: decision.decisionDigest,
			siloId: decision.siloId,
			actorKind: {
				user: AuditDecisionActorKind.User,
				"agent-service": AuditDecisionActorKind.AgentService,
				workload: AuditDecisionActorKind.Workload,
				system: AuditDecisionActorKind.System,
			}[decision.actorKind],
			actorId: decision.actorId,
			audience: decision.audience,
			namespace: decision.namespace,
			serviceAccountName: decision.serviceAccountName,
			workloadKind: _WorkloadKind(decision.workloadKind),
			workloadUid: decision.workloadUid,
			podUid: decision.podUid,
			runId: decision.runId,
			attempt: decision.attempt,
			agentServiceId: decision.agentServiceId,
			agentRevisionId: decision.agentRevisionId,
			proofKeyId: decision.proofKeyId,
			proofKeyThumbprint: decision.proofKeyThumbprint,
			resourceKind: decision.resourceKind,
			resourceId: decision.resourceId,
			action: decision.action,
			catalogId: decision.catalogId,
			catalogRevision: decision.catalogRevision,
			catalogDigest: decision.catalogDigest,
			argumentsDigest: decision.argumentsDigest,
			policyRevisionHash: decision.policyRevisionHash,
			effectiveAuthorizationDigest: decision.effectiveAuthorizationDigest,
			membershipRevision: decision.membershipRevision,
			outcome: _Outcome(decision.outcome),
			reasonCode: decision.reasonCode,
			decidedAt: decision.decidedAt,
		} });
	}
}
