import { describe, expect, it, vi } from "vitest";

import { PolicyOperator, type AccessPolicy } from "../index.js";

const _k8sApplyResource = vi.hoisted(function ()
{
  return vi.fn();
});

vi.mock("@kubernetes/client-node", function ()
{
  return {
    KubernetesObjectApi: {
      makeApiClient: vi.fn(),
    },
    CustomObjectsApi: class {},
    Watch: class {},
  };
});

vi.mock("@opencrane/server/_infra/api", function ()
{
  return {
    __K8sApplyResource: _k8sApplyResource,
    _K8sDeleteResource: vi.fn(),
    ACCESS_POLICY_CRD_PLURAL: "accesspolicies",
    OPENCRANE_API_GROUP: "opencrane.io",
    OPENCRANE_API_VERSION: "v1alpha1",
    _RunWatchLoop: vi.fn(),
    K8sWatchEventType: {
      Added: "ADDED",
      Deleted: "DELETED",
      Modified: "MODIFIED",
    },
  };
});

/** Create a policy that requires Cilium FQDN enforcement. */
function _makeDomainPolicy(): AccessPolicy
{
  return {
    apiVersion: "opencrane.io/v1alpha1",
    kind: "AccessPolicy",
    metadata: { name: "domain-egress", namespace: "tenant-jente" },
    spec: {
      description: "Require FQDN egress enforcement",
      tenantSelector: { matchLabels: { "opencrane.io/tenant": "jente" } },
      domains: { allow: ["api.openai.com"] },
    },
  };
}

/** Create only the KubeConfig methods the operator constructs clients from. */
function _makeKubeConfig(): never
{
  return {
    makeApiClient: vi.fn(),
  } as never;
}

/** Create a logger whose child inherits the same no-op logging methods. */
function _makeLogger(): never
{
  const logger = {
    child: function () { return logger; },
    info: vi.fn(),
    warn: vi.fn(),
  };

  return logger as never;
}

describe("PolicyOperator", function ()
{
  it("surfaces Cilium policy apply failures instead of acknowledging an unprotected policy", async function ()
  {
    _k8sApplyResource.mockRejectedValueOnce(new Error("CiliumNetworkPolicy rejected"));
    const operator = new PolicyOperator(_makeKubeConfig(), { watchNamespace: "" }, _makeLogger());

    await expect(operator.reconcilePolicy(_makeDomainPolicy())).rejects.toThrow("CiliumNetworkPolicy rejected");
  });
});
