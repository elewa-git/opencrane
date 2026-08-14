import { describe, expect, it, vi } from "vitest";

import { _ResolveOrgMembershipFacts } from "../index";

/**
 * Unit coverage for the membership-derived org-admin facts (ORG-ADMIN.5): authority
 * is derived purely from OrgMembership rows (owner/admin), keyed on the verified
 * subject, and fails closed on a missing subject or a lookup error.
 */
describe("_ResolveOrgMembershipFacts (ORG-ADMIN.5)", function _suite()
{
  it("derives isOrgAdmin + ownedOrgs from owner/admin rows", async function _derives()
  {
    const findMany = vi.fn().mockResolvedValue([
      { clusterTenant: "acme", role: "Owner" },
      { clusterTenant: "globex", role: "Admin" },
    ]);
    const repository = { findAdminMemberships: findMany };

    const facts = await _ResolveOrgMembershipFacts(repository, "user-1");

    expect(facts.isOrgAdmin).toBe(true);
    expect(facts.ownedOrgs).toEqual([
      { clusterTenant: "acme", role: "owner" },
      { clusterTenant: "globex", role: "admin" },
    ]);
    expect(findMany).toHaveBeenCalledWith("user-1");
  });

  it("returns empty facts (not an admin) when the caller administers no org", async function _noOrgs()
  {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = { findAdminMemberships: findMany };

    const facts = await _ResolveOrgMembershipFacts(repository, "user-2");

    expect(facts.isOrgAdmin).toBe(false);
    expect(facts.ownedOrgs).toEqual([]);
  });

  it("fails closed on a missing subject — never hits the DB", async function _noSubject()
  {
    const findMany = vi.fn();
    const repository = { findAdminMemberships: findMany };

    const facts = await _ResolveOrgMembershipFacts(repository, undefined);

    expect(facts).toEqual({ isOrgAdmin: false, ownedOrgs: [] });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("propagates a lookup error instead of reporting a successful empty authority result", async function _dbError()
  {
    const findMany = vi.fn().mockRejectedValue(new Error("db down"));
    const repository = { findAdminMemberships: findMany };

    await expect(_ResolveOrgMembershipFacts(repository, "user-3")).rejects.toThrow("db down");
  });
});
