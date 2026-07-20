import type * as k8s from "@kubernetes/client-node";
import type { Logger } from "pino";
import { describe, expect, it, vi } from "vitest";

import { _SeedOwnClusterTenant } from "../core/seed-own-cluster-tenant.js";

/** A Kubernetes 404 used to drive the missing-ClusterTenant create path. */
const _NOT_FOUND = Object.assign(new Error("not found"), { code: 404 });

/** Captured ClusterTenant create body shape used by the seed tests. */
type _ClusterTenantCreateBody = { spec?: { owner?: { email?: string; subject?: string } } };

/** Minimal logger stub; the seed logs best-effort outcomes but tests assert API payloads. */
function _log(): Logger
{
  return { info: vi.fn(), warn: vi.fn() } as unknown as Logger;
}

/** Build a CustomObjectsApi fake that records the create body and accepts the status bind. */
function _customApi(createClusterCustomObject: ReturnType<typeof vi.fn>): k8s.CustomObjectsApi
{
  return {
    listClusterCustomObject: vi.fn().mockResolvedValue({ items: [] }),
    getClusterCustomObject: vi.fn().mockRejectedValue(_NOT_FOUND),
    createClusterCustomObject,
    patchClusterCustomObjectStatus: vi.fn().mockResolvedValue({}),
  } as unknown as k8s.CustomObjectsApi;
}

/** Return the first ClusterTenant body sent to Kubernetes. */
function _createdBody(createClusterCustomObject: ReturnType<typeof vi.fn>): _ClusterTenantCreateBody
{
  const call = createClusterCustomObject.mock.calls[0]?.[0] as { body?: _ClusterTenantCreateBody } | undefined;
  return call?.body ?? {};
}

describe("_SeedOwnClusterTenant — standalone self-seed body", function _suite()
{
  it("uses ownerEmail as the CRD-required owner subject when ownerSubject is omitted", async function _emailFallbackSubject()
  {
    const createClusterCustomObject = vi.fn().mockResolvedValue({});
    const result = await _SeedOwnClusterTenant(_customApi(createClusterCustomObject), "opencrane-system", {
      name: "acme",
      displayName: "Acme",
      ownerEmail: " owner@acme.test ",
      tier: "shared",
    }, _log());

    expect(result).toEqual({ name: "acme", created: true });
    expect(_createdBody(createClusterCustomObject).spec?.owner).toEqual({ subject: "owner@acme.test", email: "owner@acme.test" });
  });

  it("keeps an explicit ownerSubject when one is configured", async function _explicitSubject()
  {
    const createClusterCustomObject = vi.fn().mockResolvedValue({});
    await _SeedOwnClusterTenant(_customApi(createClusterCustomObject), "opencrane-system", {
      name: "acme",
      ownerEmail: "owner@acme.test",
      ownerSubject: " sub-42 ",
    }, _log());

    expect(_createdBody(createClusterCustomObject).spec?.owner).toEqual({ subject: "sub-42", email: "owner@acme.test" });
  });
});
