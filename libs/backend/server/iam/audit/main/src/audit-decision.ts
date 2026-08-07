import { AuditDecisionActorKind, AuditDecisionOutcome, WorkloadKind, type Prisma } from "@prisma/client";

import type { AuditDecisionRecord } from "./audit-decision.types.js";

/**
 * Appends target authorization evidence through the caller's active transaction.
 * @param transaction - Driving-domain Prisma transaction that owns the authority change.
 * @param decision - Exact immutable authorization evidence to append atomically.
 */
export async function __AppendAuditDecision(transaction: Prisma.TransactionClient, decision: AuditDecisionRecord): Promise<void>
{
	await transaction.auditDecision.create({
		data: {
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
			workloadKind: decision.workloadKind === undefined ? undefined : decision.workloadKind === "job" ? WorkloadKind.Job : WorkloadKind.Deployment,
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
			outcome: decision.outcome === "allow" ? AuditDecisionOutcome.Allow : decision.outcome === "deny" ? AuditDecisionOutcome.Deny : AuditDecisionOutcome.Error,
			reasonCode: decision.reasonCode,
			decidedAt: decision.decidedAt,
		},
	});
}
