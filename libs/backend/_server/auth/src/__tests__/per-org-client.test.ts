import type * as k8s from "@kubernetes/client-node";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";

import { _OrgScope, _ResolvePerOrgClient } from "../index.js";

/** Silent structured logger injected into the resolver under test. */
const _log = pino({ enabled: false });

/** A Kubernetes 404 the way @kubernetes/client-node surfaces a missing cluster-scoped object. */
function _notFound(): Error
{
  return Object.assign(new Error("not found"), { code: 404 });
}

/**
 * Build a CustomObjectsApi stub. `byName` maps a CR name → its CR object (a `get` for any
 * other name rejects 404); `list` is the full set returned by a cluster-wide list (for the
 * vanity-domain fallback).
 */
function _apiReturning(opts: {
  byName?: Record<string, unknown>;
  list?: unknown[];
}): { api: k8s.CustomObjectsApi; getClusterCustomObject: ReturnType<typeof vi.fn>; listClusterCustomObject: ReturnType<typeof vi.fn> }
{
  const byName = opts.byName ?? {};
  const getClusterCustomObject = vi.fn().mockImplementation(function _get(args: { name: string })
  {
    const cr = byName[args.name];
    return cr ? Promise.resolve(cr) : Promise.reject(_notFound());
  });
  const listClusterCustomObject = vi.fn().mockResolvedValue({ items: opts.list ?? [] });
  const api = { getClusterCustomObject, listClusterCustomObject } as unknown as k8s.CustomObjectsApi;
  return { api, getClusterCustomObject, listClusterCustomObject };
}

/** A fully-provisioned ClusterTenant CR for the org `name`. */
function _cr(name: string, vanityDomain?: string): Record<string, unknown>
{
  return {
    metadata: { name },
    spec: {
      ...(vanityDomain ? { vanityDomain } : {}),
      zitadel: { clientId: `client-${name}`, orgId: `org-${name}`, redirectUri: `https://${name}.dev.opencrane.ai/api/v1/auth/callback` },
    },
  };
}

describe("_OrgScope — Zitadel org-restriction login scope (S3b)", function _scopeSuite()
{
  it("builds the urn:zitadel:iam:org:id scope for an org id", function _builds()
  {
    expect(_OrgScope("org-123")).toBe("urn:zitadel:iam:org:id:org-123");
  });
});

describe("_ResolvePerOrgClient — host→ClusterTenant CR→per-org client (Option A)", function _resolveSuite()
{
  it("resolves a per-org host to its client_id + org id + redirect URI from the CR", async function _resolves()
  {
    const { api, getClusterCustomObject } = _apiReturning({ byName: { acme: _cr("acme") } });

    const resolved = await _ResolvePerOrgClient(api, "acme.dev.opencrane.ai", _log);

    expect(resolved).toEqual({
      clusterTenant: "acme",
      clientId: "client-acme",
      orgId: "org-acme",
      ownerEmail: null,
      ownerSubject: null,
      redirectUri: "https://acme.dev.opencrane.ai/api/v1/auth/callback",
    });
    // The CR is read by the host's first DNS label — never request-supplied input.
    expect(getClusterCustomObject).toHaveBeenCalledWith(expect.objectContaining({ name: "acme" }));
  });

  it("resolves a customer-vanity host via spec.vanityDomain on a listed CR (Option A)", async function _resolvesVanity()
  {
    // The first-label `get` ("ai") 404s; the full host matches a listed CR's spec.vanityDomain.
    const { api, getClusterCustomObject, listClusterCustomObject } = _apiReturning({
      list: [_cr("acme", "ai.client-company.com")],
    });

    const resolved = await _ResolvePerOrgClient(api, "ai.client-company.com", _log);

    expect(resolved).toMatchObject({ clusterTenant: "acme", clientId: "client-acme", orgId: "org-acme" });
    expect(getClusterCustomObject).toHaveBeenCalledWith(expect.objectContaining({ name: "ai" }));
    expect(listClusterCustomObject).toHaveBeenCalled();
  });

  it("returns null when no cluster client is wired (dev/test) — masters fallback", async function _noApi()
  {
    expect(await _ResolvePerOrgClient(null, "acme.dev.opencrane.ai", _log)).toBeNull();
  });

  it("returns null for no host (no derivable silo) — masters fallback", async function _noHost()
  {
    const { api, getClusterCustomObject } = _apiReturning({});
    expect(await _ResolvePerOrgClient(api, undefined, _log)).toBeNull();
    expect(getClusterCustomObject).not.toHaveBeenCalled();
  });

  it("returns null for the platform host — its label matches no ClusterTenant CR (fail-closed)", async function _platformHost()
  {
    const { api } = _apiReturning({});
    expect(await _ResolvePerOrgClient(api, "platform.dev.opencrane.ai", _log)).toBeNull();
  });

  it("returns null for an unknown host label that matches no ClusterTenant CR (fail-closed)", async function _unknownHost()
  {
    const { api } = _apiReturning({});
    expect(await _ResolvePerOrgClient(api, "ghost.dev.opencrane.ai", _log)).toBeNull();
  });

  it("returns null when the CR has no provisioned client_id (fail-closed)", async function _noClientId()
  {
    const cr = { metadata: { name: "acme" }, spec: { zitadel: { clientId: null, orgId: "org-acme" } } };
    const { api } = _apiReturning({ byName: { acme: cr } });
    expect(await _ResolvePerOrgClient(api, "acme.dev.opencrane.ai", _log)).toBeNull();
  });

  it("returns null when the CR has no provisioned org id (fail-closed)", async function _noOrgId()
  {
    const cr = { metadata: { name: "acme" }, spec: { zitadel: { clientId: "client-acme", orgId: null } } };
    const { api } = _apiReturning({ byName: { acme: cr } });
    expect(await _ResolvePerOrgClient(api, "acme.dev.opencrane.ai", _log)).toBeNull();
  });
});
