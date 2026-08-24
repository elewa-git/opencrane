import { AuditDecisionActorKind, AuditDecisionOutcome, WorkloadKind, type Prisma } from "@prisma/client";

import type { AuditDecisionRecord } from "./audit-decision.types";

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

/**
 * Writes one row into the append-only decision log, using the transaction the caller is already in.
 *
 * It takes a transaction client, not a Prisma client, precisely so it cannot be called on its own:
 * the audit row commits with the change it describes or not at all. It also translates the plain
 * string fields (`actorKind`, `workloadKind`, `outcome`) into the Prisma enums, so callers do not
 * import generated enums.
 *
 * Called by: libs/backend/server/iam/authorization/main/src/prisma-runtime-authority.ts,
 * libs/backend/server/iam/membership/main/src/prisma-membership-authority.ts,
 * libs/backend/server/agents/agent-services/main/src/db/prisma-agent-publication.ts, and
 * standalone-first-user-audit.ts in this package.
 * @param transaction - The open transaction of the change being recorded.
 * @param decision - The decision to record; treat it as final, nothing rewrites these rows.
 * @throws Error propagated from Prisma when the insert fails, which deliberately rolls the caller's
 *         change back rather than letting it commit unaudited.
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
		},
	});
}
