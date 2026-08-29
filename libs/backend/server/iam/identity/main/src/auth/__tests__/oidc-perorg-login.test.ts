import type { Request } from "express";
import type * as k8s from "@kubernetes/client-node";
import { OrgMemberStatus, OrgRole, type PrismaClient } from "@prisma/client";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock openid-client so buildLoginUrl runs without real network discovery. `discovery`
// echoes back the client_id it was called with so the test can assert which client (per-org
// vs masters) was selected; `buildAuthorizationUrl` captures the scope it was handed.
const _discoveryCalls: Array<{ clientId: string }> = [];
let _lastAuthParams: Record<string, unknown> = {};
// The client_id of the discovered config handed to authorizationCodeGrant — lets the
// completeLogin test assert the SAME client resolved at buildLoginUrl is used at token exchange.
let _grantClientId: string | undefined;
vi.mock("openid-client", function _mockClient()
{
  return {
    randomPKCECodeVerifier() { return "verifier"; },
    async calculatePKCECodeChallenge() { return "challenge"; },
    randomState() { return "state"; },
    randomNonce() { return "nonce"; },
    async discovery(_issuer: URL, clientId: string)
    {
      _discoveryCalls.push({ clientId });
      return { clientId } as unknown;
    },
    buildAuthorizationUrl(config: { clientId: string }, params: Record<string, unknown>)
    {
      _lastAuthParams = params;
      return new URL(`https://idp.test/authorize?client=${config.clientId}`);
    },
    async authorizationCodeGrant(config: { clientId: string })
    {
      _grantClientId = config.clientId;
      return { claims() { return { sub: "user-1", email: "u@acme.io", email_verified: true, exp: Math.floor(Date.now() / 1000) + 3600 }; }, access_token: undefined, id_token: "id-tok" };
    },
    async fetchUserInfo(_config: unknown, _accessToken: string, sub: string)
    {
      return { sub };
    },
  };
});

import { ___CreateOidcAuthService } from "../oidc.service";
import { PrismaAuthenticatedPrincipalCapabilityUnitOfWork } from "../../authenticated-principals/prisma-authenticated-principal-capability-unit-of-work";
import type { StandaloneFirstUserAdmissionAuditPort } from "../../standalone-first-user/standalone-first-user-admission.types";

/** Minimal OIDC env so the service is enabled and uses `cid` as the masters client. */
function _enableOidc(): void
{
  process.env.OIDC_ISSUER_URL = "https://idp.test";
  process.env.OIDC_CLIENT_ID = "cid";
  process.env.OIDC_REDIRECT_URI = "https://platform.dev.opencrane.ai/api/v1/auth/callback";
  process.env.OIDC_SESSION_SECRET = "test-secret";
  process.env.OIDC_SCOPES = "openid email profile";
}

/** Clear the OIDC env between tests so config does not leak across cases. */
function _disableOidc(): void
{
  delete process.env.OIDC_ISSUER_URL;
  delete process.env.OIDC_CLIENT_ID;
  delete process.env.OIDC_REDIRECT_URI;
  delete process.env.OIDC_SESSION_SECRET;
  delete process.env.OIDC_SCOPES;
}

/** A Request-like object on `host` with a save-able session. */
function _reqOnHost(host: string): Request
{
  const session: Record<string, unknown> = { save(cb: (err?: Error) => void) { cb(); } };
  return { headers: { "x-forwarded-host": host }, session } as unknown as Request;
}

/** Minimal Prisma stub — per-org login no longer reads Prisma (it reads the CR via customApi). */
function _prismaStub(): PrismaClient
{
  const prisma = {
    $transaction: vi.fn(async function _Transaction(callback: (transaction: unknown) => Promise<unknown>) { return callback(prisma); }),
    orgMembership: { findMany: vi.fn().mockResolvedValue([]) },
    principal: {
      upsert: vi.fn().mockResolvedValue({ id: "principal-1" }),
      findUnique: vi.fn().mockResolvedValue({ id: "principal-1", siloId: "acme" }),
    },
    group: { findMany: vi.fn().mockResolvedValue([]) },
    groupMembership: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), createMany: vi.fn().mockResolvedValue({ count: 0 }) },
  };
  return prisma as unknown as PrismaClient;
}

/** Prisma stub that persists the exact one-time owner claim made by a standalone callback. */
function _standaloneAdmissionPrisma(existingOwner: { subject: string; role: OrgRole; status: OrgMemberStatus } | null = null): { prisma: PrismaClient; created: Array<{ clusterTenant: string; subject: string }> }
{
  const created: Array<{ clusterTenant: string; subject: string }> = [];
  const prisma = {
    $transaction: vi.fn(async function _transaction(callback: (transaction: unknown) => Promise<unknown>) { return callback(prisma); }),
    principal: { upsert: vi.fn().mockResolvedValue({ id: "principal-1" }) },
    group: { findMany: vi.fn().mockResolvedValue([]) },
    groupMembership: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    orgMembership: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(existingOwner),
      create: vi.fn(async function _create(args: { data: { clusterTenant: string; subject: string } })
      {
        created.push({ clusterTenant: args.data.clusterTenant, subject: args.data.subject });
      }),
    },
    auditDecision: { create: vi.fn().mockResolvedValue(undefined) },
  } as unknown as PrismaClient;
  return { prisma, created };
}

/** Audit adapter fixture; transactional persistence is unit-tested at the audit boundary. */
function _standaloneFirstUserAudit(): StandaloneFirstUserAdmissionAuditPort
{
  return { append: vi.fn().mockResolvedValue(undefined) };
}

/**
 * CustomObjectsApi stub returning the ClusterTenant CR for `name` (a `get` for any other name
 * 404s). Pass `null` zitadel ids to model an unprovisioned org. `null` → no cluster wired.
 */
function _apiWithCr(name: string, zitadel: { clientId: string | null; orgId: string | null } | null): k8s.CustomObjectsApi
{
  const cr = zitadel === null
    ? null
    : { metadata: { name }, spec: { zitadel: { clientId: zitadel.clientId, orgId: zitadel.orgId, redirectUri: null } } };
  return {
    getClusterCustomObject: vi.fn().mockImplementation(function _get(args: { name: string })
    {
      return args.name === name && cr ? Promise.resolve(cr) : Promise.reject(Object.assign(new Error("not found"), { code: 404 }));
    }),
    listClusterCustomObject: vi.fn().mockResolvedValue({ items: cr ? [cr] : [] }),
  } as unknown as k8s.CustomObjectsApi;
}

describe("OidcAuthService.buildLoginUrl — per-org client resolution (S3b)", function _suite()
{
  beforeEach(function _reset() { _enableOidc(); _discoveryCalls.length = 0; _lastAuthParams = {}; });
  afterEach(_disableOidc);

  it("uses the per-org client + org-restriction scope for a provisioned org host", async function _perOrg()
  {
    const api = _apiWithCr("acme", { clientId: "client-acme", orgId: "org-acme" });
    const service = ___CreateOidcAuthService(pino({ enabled: false }), _prismaStub(), api);
    const req = _reqOnHost("acme.dev.opencrane.ai");

    const url = await service.buildLoginUrl(req, "/");

    // Discovery + the authorization request both used the org's client, not the masters one.
    expect(_discoveryCalls).toEqual([{ clientId: "client-acme" }]);
    expect(url).toContain("client=client-acme");
    // The Zitadel org-restriction scope is appended so only acme's user pool may log in.
    expect(_lastAuthParams.scope).toBe("openid email profile urn:zitadel:iam:org:id:org-acme");
    // completeLogin must reuse the same client → the per-org client_id is recorded in the flow.
    expect((req.session as { oidcFlow?: { clientId?: string } }).oidcFlow?.clientId).toBe("client-acme");
  });

  it("keeps the per-org restriction when registration is requested", async function _PerOrgRegistration()
  {
    const api = _apiWithCr("acme", { clientId: "client-acme", orgId: "org-acme" });
    const service = ___CreateOidcAuthService(pino({ enabled: false }), _prismaStub(), api);
    const req = _reqOnHost("acme.dev.opencrane.ai");

    await service.buildLoginUrl(req, "/invite?token=opaque", { prompt: "create" });

    expect(_lastAuthParams.prompt).toBe("create");
    expect(_lastAuthParams.scope).toBe("openid email profile urn:zitadel:iam:org:id:org-acme");
  });

  it("uses the masters client (no org scope) for the platform host", async function _platform()
  {
    const api = _apiWithCr("acme", null); // no CR for "platform" → 404 + empty list
    const service = ___CreateOidcAuthService(pino({ enabled: false }), _prismaStub(), api);
    const req = _reqOnHost("platform.dev.opencrane.ai");

    const url = await service.buildLoginUrl(req, "/");

    // "platform" is not a provisioned CT → fall through to the masters client; no org scope.
    expect(_discoveryCalls).toEqual([{ clientId: "cid" }]);
    expect(url).toContain("client=cid");
    expect(_lastAuthParams.scope).toBe("openid email profile");
    expect((req.session as { oidcFlow?: { clientId?: string } }).oidcFlow?.clientId).toBeUndefined();
  });

  it("rejects an unprovisioned org host instead of falling through to masters", async function _unprovisioned()
  {
    // The CR exists but has no client_id yet (mid-provisioning / unconfigured Zitadel).
    const api = _apiWithCr("acme", { clientId: null, orgId: null });
    const service = ___CreateOidcAuthService(pino({ enabled: false }), _prismaStub(), api);
    const req = _reqOnHost("acme.dev.opencrane.ai");

    await expect(service.buildLoginUrl(req, "/")).rejects.toThrow("provisioned tenant client");
    expect(_discoveryCalls).toEqual([]);
  });
});

describe("OidcAuthService.getStatus — product capabilities", function _CapabilitySuite()
{
  beforeEach(_enableOidc);
  afterEach(function _Reset()
  {
    vi.restoreAllMocks();
    _disableOidc();
  });

  it("returns organization administration from the central authorization projection", async function _ProjectsCapability()
  {
    const prisma = _prismaStub();
    vi.mocked(prisma.orgMembership.findMany).mockResolvedValue([{ clusterTenant: "acme", role: OrgRole.Owner }] as never);
    vi.spyOn(PrismaAuthenticatedPrincipalCapabilityUnitOfWork.prototype, "canAdministerOrganization").mockResolvedValue(true);
    const service = ___CreateOidcAuthService(pino({ enabled: false }), prisma, _apiWithCr("acme", { clientId: "client-acme", orgId: "org-acme" }));
    const req = _reqOnHost("acme.dev.opencrane.ai");
    req.session.authUser = { sub: "user-1", issuer: "https://idp.test", groups: [], authorizationExpiresAt: new Date(Date.now() + 60_000).toISOString(), isPlatformOperator: false, isOrgAdmin: false, authenticatedAt: new Date().toISOString() };

    const status = await service.getStatus(req);

    expect(status.user).toMatchObject({ clusterTenant: "acme", productCapabilities: { administerOrganization: true } });
  });
});

/** A callback Request carrying an in-flight oidcFlow (with optional per-org clientId). */
function _callbackReq(flowClientId: string | undefined, host = "acme.dev.opencrane.ai"): Request
{
  const session: Record<string, unknown> = {
    oidcFlow: { codeVerifier: "verifier", state: "state", nonce: "nonce", returnTo: "/", ...(flowClientId ? { clientId: flowClientId } : {}) },
    regenerate(cb: (err?: Error) => void) { cb(); },
    save(cb: (err?: Error) => void) { cb(); },
    destroy(cb: (err?: Error) => void) { cb(); },
  };
  return { headers: { "x-forwarded-host": host }, originalUrl: "/api/v1/auth/callback?code=c&state=state", protocol: "https", session } as unknown as Request;
}

describe("OidcAuthService.completeLogin — token exchange uses the per-org client (S3b)", function _completeSuite()
{
  beforeEach(function _reset() { _enableOidc(); _discoveryCalls.length = 0; _grantClientId = undefined; });
  afterEach(_disableOidc);

  it("exchanges the code against the per-org client recorded at buildLoginUrl", async function _perOrgExchange()
  {
    const service = ___CreateOidcAuthService(pino({ enabled: false }), _prismaStub(), _apiWithCr("acme", { clientId: "client-acme", orgId: "org-acme" }));

    await service.completeLogin(_callbackReq("client-acme"));

    // The token exchange used the per-org client, not the masters one — the auth-request
    // and token-exchange client_ids match, so the issued code is honoured.
    expect(_grantClientId).toBe("client-acme");
  });

  it("exchanges the code against the masters client when no per-org client was recorded", async function _mastersExchange()
  {
    const service = ___CreateOidcAuthService(pino({ enabled: false }), _prismaStub());

    await service.completeLogin(_callbackReq(undefined, "platform.dev.opencrane.ai"));

    expect(_grantClientId).toBe("cid");
  });

  it("claims the configured verified standalone owner and saves org-admin session state", async function _claimsStandaloneOwner()
  {
    const { prisma, created } = _standaloneAdmissionPrisma();
    const service = ___CreateOidcAuthService(pino({ enabled: false }), prisma, null, { clusterTenant: "acme", email: "u@acme.io", issuer: "https://idp.test" }, _standaloneFirstUserAudit());
    const req = _callbackReq("client-acme");

    await service.completeLogin(req);

    expect(created).toEqual([{ clusterTenant: "acme", subject: "user-1" }]);
    expect((req.session as { authUser?: { isOrgAdmin?: boolean } }).authUser?.isOrgAdmin).toBe(true);
  });

  it("preserves an unprivileged session after another subject has claimed the owner slot", async function _AllowsInvitedIdentity()
  {
    const { prisma } = _standaloneAdmissionPrisma({ subject: "existing-owner", role: OrgRole.Owner, status: OrgMemberStatus.Active });
    const service = ___CreateOidcAuthService(pino({ enabled: false }), prisma, null, { clusterTenant: "acme", email: "u@acme.io", issuer: "https://idp.test" }, _standaloneFirstUserAudit());
    const req = _callbackReq("client-acme");
    const destroy = vi.fn(function _destroy(callback: (error?: Error) => void) { callback(); });
    (req.session as unknown as { destroy: typeof destroy }).destroy = destroy;

    await expect(service.completeLogin(req)).resolves.toBe("/");

    expect(destroy).not.toHaveBeenCalled();
    expect((req.session as { authUser?: { isOrgAdmin?: boolean } }).authUser?.isOrgAdmin).not.toBe(true);
  });

  it("destroys the regenerated session when an empty owner slot rejects an ineligible login", async function _DestroysDeniedAdmissionSession()
  {
    const { prisma } = _standaloneAdmissionPrisma();
    const service = ___CreateOidcAuthService(pino({ enabled: false }), prisma, null, { clusterTenant: "acme", email: "different@acme.io", issuer: "https://idp.test" }, _standaloneFirstUserAudit());
    const req = _callbackReq("client-acme");
    const destroy = vi.fn(function _destroy(callback: (error?: Error) => void) { callback(); });
    (req.session as unknown as { destroy: typeof destroy }).destroy = destroy;

    await expect(service.completeLogin(req)).rejects.toThrow(/standalone first-user admission denied/);

    expect(destroy).toHaveBeenCalledTimes(1);
  });

	 it("destroys the regenerated session when owner admission infrastructure fails", async function _DestroysFailedAdmissionSession()
	 {
		 const { prisma } = _standaloneAdmissionPrisma();
		 prisma.$transaction = vi.fn().mockRejectedValue(new Error("database unavailable"));
		 const service = ___CreateOidcAuthService(pino({ enabled: false }), prisma, null, { clusterTenant: "acme", email: "u@acme.io", issuer: "https://idp.test" }, _standaloneFirstUserAudit());
		 const req = _callbackReq("client-acme");
		 const destroy = vi.fn(function _destroy(callback: (error?: Error) => void) { callback(); });
		 (req.session as unknown as { destroy: typeof destroy }).destroy = destroy;

		 await expect(service.completeLogin(req)).rejects.toThrow("database unavailable");

		 expect(destroy).toHaveBeenCalledTimes(1);
	 });
});
