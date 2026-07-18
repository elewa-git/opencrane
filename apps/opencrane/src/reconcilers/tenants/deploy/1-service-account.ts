import type * as k8s from "@kubernetes/client-node";

import type { HostingAdapter } from "../../../hosting/index.js";
import type { Tenant } from "../models/tenant.types.js";
import { _BuildTenantLabels } from "./tenant-labels.js";

/**
 * Build a ServiceAccount for the tenant pod.
 * Identity annotations (e.g. Workload Identity) are provided by the hosting adapter
 * so the builder stays provider-agnostic: on-prem returns an empty annotation map.
 */
export function _BuildServiceAccount(hosting: HostingAdapter, tenant: Tenant, namespace: string): k8s.V1ServiceAccount
{
  const name = tenant.metadata!.name!;

  return {
    apiVersion: "v1",
    kind: "ServiceAccount",
    automountServiceAccountToken: false,
    metadata: {
      name: `openclaw-${name}`,
      namespace,
      labels: _BuildTenantLabels(name),
      annotations: hosting.buildServiceAccountIdentity(name),
    },
  };
}
