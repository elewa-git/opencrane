import { describe, expect, it, vi } from "vitest";

import { _ResolveOrgMembershipFacts } from "../index";

/**
 * Unit coverage for membership presentation facts, keyed on the verified subject.
 */
describe("_ResolveOrgMembershipFacts (ORG-ADMIN.5)", function _suite()
{
  it("projects owned organizations from owner and admin rows", async function _derives()
  {
    const findMany = vi.fn().mockResolvedValue([
      { clusterTenant: "acme", role: "Owner" },
      { clusterTenant: "globex", role: "Admin" },
    ]);
    const repository = { findAdminMemberships: findMany };

    const facts = await _ResolveOrgMembershipFacts(repository, "user-1");

    expect(facts.ownedOrgs).toEqual([
      { clusterTenant: "acme", role: "owner" },
      { clusterTenant: "globex", role: "admin" },
    ]);
    expect(findMany).toHaveBeenCalledWith("user-1");
  });

  it("returns empty facts when the caller administers no organization", async function _noOrgs()
  {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = { findAdminMemberships: findMany };

    const facts = await _ResolveOrgMembershipFacts(repository, "user-2");

    expect(facts.ownedOrgs).toEqual([]);
  });

  it("fails closed on a missing subject — never hits the DB", async function _noSubject()
  {
    const findMany = vi.fn();
    const repository = { findAdminMemberships: findMany };

    const facts = await _ResolveOrgMembershipFacts(repository, undefined);

    expect(facts).toEqual({ ownedOrgs: [] });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("propagates a lookup error instead of reporting a successful empty authority result", async function _dbError()
  {
    const findMany = vi.fn().mockRejectedValue(new Error("db down"));
    const repository = { findAdminMemberships: findMany };

    await expect(_ResolveOrgMembershipFacts(repository, "user-3")).rejects.toThrow("db down");
  });
});
