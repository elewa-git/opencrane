import { describe, expect, it, vi } from "vitest";

import { _ResolveOwnedOrgSummaries } from "../index";

/**
 * Unit coverage for membership presentation facts, keyed on the verified subject.
 */
describe("_ResolveOwnedOrgSummaries", function _suite()
{
  it("projects owned organizations from owner and admin rows", async function _derives()
  {
    const findMany = vi.fn().mockResolvedValue([
      { clusterTenant: "acme", role: "Owner" },
      { clusterTenant: "globex", role: "Admin" },
    ]);
    const repository = { findOwnedOrgSummaries: findMany };

    const facts = await _ResolveOwnedOrgSummaries(repository, "user-1");

    expect(facts.ownedOrgs).toEqual([
      { clusterTenant: "acme", role: "owner" },
      { clusterTenant: "globex", role: "admin" },
    ]);
    expect(findMany).toHaveBeenCalledWith("user-1");
  });

  it("returns empty facts when the caller administers no organization", async function _noOrgs()
  {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = { findOwnedOrgSummaries: findMany };

    const facts = await _ResolveOwnedOrgSummaries(repository, "user-2");

    expect(facts.ownedOrgs).toEqual([]);
  });

  it("returns an empty presentation for a missing subject without querying", async function _noSubject()
  {
    const findMany = vi.fn();
    const repository = { findOwnedOrgSummaries: findMany };

    const facts = await _ResolveOwnedOrgSummaries(repository, undefined);

    expect(facts).toEqual({ ownedOrgs: [] });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("propagates a lookup error instead of reporting a successful empty summary", async function _dbError()
  {
    const findMany = vi.fn().mockRejectedValue(new Error("db down"));
    const repository = { findOwnedOrgSummaries: findMany };

    await expect(_ResolveOwnedOrgSummaries(repository, "user-3")).rejects.toThrow("db down");
  });
});
