import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { __AppendAuditDecision } from "./audit-decision.js";
import type { StandaloneFirstUserAdmissionAuditAppender, StandaloneFirstUserAuditClaim } from "./standalone-first-user-audit.types.js";

/**
 * Builds the audit adapter identity uses when it admits a standalone silo's first owner.
 *
 * It exists so identity never imports the audit tables: identity owns the port, this package owns
 * the row. The row records the claim (silo, subject, action) and deliberately does not keep the
 * bootstrap email that made the subject eligible.
 *
 * Called by: apps/opencrane/src/app/public-app.ts, which passes the result into
 * ___CreateOidcAuthService.
 * @returns An appender that writes the first-owner row inside identity's own transaction.
 */
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
