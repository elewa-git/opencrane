import { describe, expect, it, vi } from "vitest";

import { __CreateStandaloneFirstUserAdmissionAuditAppender } from "../standalone-first-user-audit";

describe("__CreateStandaloneFirstUserAdmissionAuditAppender", function _suite()
{
  it("records one immutable allow decision through the supplied transaction", async function _append()
  {
    const transaction = { auditDecision: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) } };
    const appender = __CreateStandaloneFirstUserAdmissionAuditAppender();

    await appender.append(transaction as never, { clusterTenant: "testv2", subject: "subject-jente" });

    expect(transaction.auditDecision.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        siloId: "testv2",
        actorId: "subject-jente",
        action: "claim-standalone-first-owner",
        reasonCode: "verified_bootstrap_owner_admitted",
      }),
    }));
  });
});
