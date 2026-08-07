import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { __AppendAuditDecision } from "./audit-decision.js";
import type { StandaloneFirstUserAdmissionAuditAppender, StandaloneFirstUserAuditClaim } from "./standalone-first-user-audit.types.js";

/** Creates the audit-owned adapter for one standalone first-owner admission transaction. */
export function __CreateStandaloneFirstUserAdmissionAuditAppender(): StandaloneFirstUserAdmissionAuditAppender
{
  return {
    async append(transaction: unknown, claim: StandaloneFirstUserAuditClaim): Promise<void>
    {
      const decisionDigest = ___DigestCanonicalJson({ clusterTenant: claim.clusterTenant, subject: claim.subject, action: "standalone_first_owner_claim" } as JsonValue);
      await __AppendAuditDecision(transaction as Parameters<typeof __AppendAuditDecision>[0], {
        decisionDigest,
        siloId: claim.clusterTenant,
        actorKind: "user",
        actorId: claim.subject,
        resourceKind: "org-membership",
        resourceId: `${claim.clusterTenant}:${claim.subject}`,
        action: "claim-standalone-first-owner",
        catalogId: "standalone-first-user",
        catalogRevision: 1,
        catalogDigest: decisionDigest,
        argumentsDigest: decisionDigest,
        policyRevisionHash: decisionDigest,
        effectiveAuthorizationDigest: decisionDigest,
        outcome: "allow",
        reasonCode: "verified_bootstrap_owner_admitted",
      });
    },
  };
}
