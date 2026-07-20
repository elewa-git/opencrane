import type { Request } from "express";
import type { PrismaClient } from "@prisma/client";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ___CreateOidcAuthService } from "../index.js";

/** Minimal OIDC env so the service reports `mode: oidc` and resolves sessions. */
function _enableOidc(): void
{
  process.env.OIDC_ISSUER_URL = "https://idp.test";
  process.env.OIDC_CLIENT_ID = "cid";
  process.env.OIDC_REDIRECT_URI = "https://cp.test/api/v1/auth/callback";
  process.env.OIDC_SESSION_SECRET = "test-secret";
}

/** Clear the OIDC env between tests so config does not leak across cases. */
function _disableOidc(): void
{
  delete process.env.OIDC_ISSUER_URL;
  delete process.env.OIDC_CLIENT_ID;
  delete process.env.OIDC_REDIRECT_URI;
  delete process.env.OIDC_SESSION_SECRET;
}

/** Build a Request-like object carrying a logged-in session user (and an optional org host). */
function _reqWithUser(email: string | undefined, host?: string): Request
{
  return {
    headers: host ? { "x-forwarded-host": host } : {},
    session: {
      authUser: {
        sub: "user-1",
        issuer: "https://idp.test",
        groups: ["acme-users"],
        isPlatformOperator: false,
        isOrgAdmin: false,
        ...(email ? { email } : {}),
        authenticatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
  } as unknown as Request;
}

/** Prisma stub for getStatus: tenant.findMany (email→ref) + orgMembership.findMany (owned orgs). */
function _prismaWith(tenantRows: { clusterTenantRef: string | null }[], membershipRows: { clusterTenant: string; role: string }[]): PrismaClient
{
  return {
    tenant: { findMany: vi.fn().mockResolvedValue(tenantRows) },
    orgMembership: { findMany: vi.fn().mockResolvedValue(membershipRows) },
  } as unknown as PrismaClient;
}

describe("OidcAuthService.getStatus — /auth/me identity surface (WOI.1)", function _suite()
{
  beforeEach(_enableOidc);
  afterEach(_disableOidc);

  it("resolves clusterTenant from the verified email and surfaces groups + isPlatformOperator", async function _resolved()
  {
    const findMany = vi.fn().mockResolvedValue([{ clusterTenantRef: "acme-corp" }]);
    const prisma = { tenant: { findMany } } as unknown as PrismaClient;
    const service = ___CreateOidcAuthService(pino({ enabled: false }), prisma);

    const status = await service.getStatus(_reqWithUser("owner@acme.io"));

    expect(status.authenticated).toBe(true);
    expect(status.user?.groups).toEqual(["acme-users"]);
    expect(status.user?.isPlatformOperator).toBe(false);
    expect(status.user?.clusterTenant).toBe("acme-corp");
    // The lookup is by the verified session email — never request-supplied input.
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { email: { equals: "owner@acme.io", mode: "insensitive" } }, take: 2 }));
  });

  it("returns clusterTenant null when the email maps to more than one tenant (fail-closed)", async function _ambiguous()
  {
    const findMany = vi.fn().mockResolvedValue([{ clusterTenantRef: "a" }, { clusterTenantRef: "b" }]);
    const prisma = { tenant: { findMany } } as unknown as PrismaClient;
    const service = ___CreateOidcAuthService(pino({ enabled: false }), prisma);

    const status = await service.getStatus(_reqWithUser("dup@acme.io"));

    expect(status.user?.clusterTenant).toBeNull();
  });

  it("scopes the lookup to the silo in the request host so a multi-silo owner resolves (WOI.1)", async function _hostScoped()
  {
    // The owner has a workspace in three silos; the host says which one they are viewing.
    // The where clause must carry clusterTenantRef so the email match is no longer ambiguous.
    const findMany = vi.fn().mockResolvedValue([{ clusterTenantRef: "elewa-be" }]);
    const prisma = { tenant: { findMany } } as unknown as PrismaClient;
    const service = ___CreateOidcAuthService(pino({ enabled: false }), prisma);

    const status = await service.getStatus(_reqWithUser("jente@elewa.ke", "elewa-be.dev.opencrane.ai"));

    expect(status.user?.clusterTenant).toBe("elewa-be");
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { email: { equals: "jente@elewa.ke", mode: "insensitive" }, clusterTenantRef: "elewa-be" },
      take: 2,
    }));
  });

  it("returns clusterTenant null when the tenant has no parent ref", async function _noParent()
  {
    const findMany = vi.fn().mockResolvedValue([{ clusterTenantRef: null }]);
    const prisma = { tenant: { findMany } } as unknown as PrismaClient;
    const service = ___CreateOidcAuthService(pino({ enabled: false }), prisma);

    const status = await service.getStatus(_reqWithUser("solo@acme.io"));

    expect(status.user?.clusterTenant).toBeNull();
  });

  it("never hits the DB and reports unauthenticated when there is no session user", async function _noSession()
  {
    const findMany = vi.fn();
    const prisma = { tenant: { findMany } } as unknown as PrismaClient;
    const service = ___CreateOidcAuthService(pino({ enabled: false }), prisma);

    const status = await service.getStatus({ session: {} } as unknown as Request);

    expect(status.authenticated).toBe(false);
    expect(status.user).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("derives isOrgAdmin + ownedOrgs from OrgMembership at read time, even with no org-admin group (ORG-ADMIN.5)", async function _membershipDerived()
  {
    // The session was established with isOrgAdmin=false (no group/operator), but the
    // user later created an org and became its owner — /auth/me must reflect that.
    const prisma = _prismaWith([{ clusterTenantRef: null }], [{ clusterTenant: "acme", role: "Owner" }]);
    const service = ___CreateOidcAuthService(pino({ enabled: false }), prisma);

    const status = await service.getStatus(_reqWithUser("owner@acme.io"));

    expect(status.user?.isOrgAdmin).toBe(true);
    expect(status.user?.ownedOrgs).toEqual([{ clusterTenant: "acme", role: "owner" }]);
  });

  it("reports isOrgAdmin false + empty ownedOrgs for a user who administers no org", async function _notAdmin()
  {
    const prisma = _prismaWith([{ clusterTenantRef: "acme" }], []);
    const service = ___CreateOidcAuthService(pino({ enabled: false }), prisma);

    const status = await service.getStatus(_reqWithUser("member@acme.io"));

    expect(status.user?.isOrgAdmin).toBe(false);
    expect(status.user?.ownedOrgs).toEqual([]);
  });
});
