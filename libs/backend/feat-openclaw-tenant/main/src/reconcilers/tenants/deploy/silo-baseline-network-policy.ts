import { isIP } from "node:net";

import * as k8s from "@kubernetes/client-node";

import type { OpenClawTenantOperatorConfig } from "../../../operator-config.types.js";

/** Namespace label every Kubernetes namespace carries (`kubernetes.io/metadata.name`). */
const _NAMESPACE_NAME_LABEL = "kubernetes.io/metadata.name";

/** The cluster DNS namespace whose kube-dns/CoreDNS every pod must be able to reach. */
const _DNS_NAMESPACE = "kube-system";

/** Component label the app-owned Cognee Helm unit gives its pod. */
const _COGNEE_COMPONENT_LABEL = "cognee";

/** Components that legitimately need Kubernetes API egress from inside a silo. */
const _KUBERNETES_API_EGRESS_COMPONENTS = ["opencrane-server", "mcp-gateway"];

/** Build the single-host CIDR form Kubernetes NetworkPolicy expects for an IP. */
function _IpBlockForHost(host: string): k8s.V1IPBlock | undefined
{
  const ipVersion = isIP(host);
  if (ipVersion === 0) return undefined;
  return { cidr: `${host}/${ipVersion === 6 ? 128 : 32}` };
}

/**
 * Build the per-silo baseline NetworkPolicy — the default-deny edge of a
 * ClusterTenant namespace (S2 / silo Phase 1, task_08734d58 + task_d6404452).
 *
 * An empty `podSelector` selects EVERY pod in the silo namespace, and naming both
 * `Ingress` and `Egress` in `policyTypes` flips the namespace to **default-deny**:
 * anything not explicitly allowed below is dropped. The allow-list is the minimum a
 * silo needs to function while staying isolated from every OTHER silo (east-west
 * default-deny — no silo→silo path exists because no rule names another silo):
 *
 * - **Ingress** from the same silo namespace (intra-silo) and from the
 *   opencrane-ui/operator namespace (the super-admin plane is the only principal
 *   allowed to reach in — it brokers the gateway connection).
 * - **Egress** to cluster DNS, and to the same silo namespace + the opencrane-ui
 *   namespace (the shared planes — opencrane-ui, Obot/MCP, LiteLLM, Cognee — live
 *   there in the shared tier).
 *
 * External HTTPS (LLM/MCP/Git) is deliberately NOT in this policy — see
 * {@link _BuildSiloExternalEgressNetworkPolicy}, a separate policy so Cognee can be
 * excluded from it (an unpatched Cognee vuln — topoteretes/cognee#3084 — lets ANY
 * authenticated Cognee user overwrite the process-wide LLM/embedding endpoint with no
 * admin check; unrestricted external egress would let that be pointed at an
 * attacker-controlled host to exfiltrate every tenant's data flowing through this
 * silo's shared Cognee instance). NetworkPolicy is purely additive — a workload
 * covered by this baseline's intra-silo/DNS rules can still be excluded from a
 * DIFFERENT policy's broader grant, but the reverse (one policy narrowing what
 * another already allows) is not expressible in one resource, hence the split.
 *
 * This replaces the old single `opencrane-tenant-default` policy that sat in the
 * install namespace and (mis)selected tenant pods cluster-wide; the operator now
 * emits one correctly-scoped policy per silo namespace it provisions. The companions
 * {@link _BuildGatewayNetworkPolicy} and {@link _BuildSiloExternalEgressNetworkPolicy}
 * narrow/extend on top of this baseline (NetworkPolicy rules are additive, so all
 * three compose).
 *
 * NOTE: this is an L3/L4 namespace-scoped floor — the identity-based (SPIFFE/Cilium)
 * enforcement of the silo model lands later (S5). It only takes effect on a
 * NetworkPolicy-enforcing CNI; GKE Autopilot/Dataplane V2 enforces it inherently.
 *
 * @param namespace - The silo (ClusterTenant) namespace the policy is created in.
 * @param clusterTenantName - Parent ClusterTenant name, recorded as a label.
 * @param config - Operator config; supplies the opencrane-ui/operator namespace.
 * @returns The default-deny baseline NetworkPolicy for the silo namespace.
 */
export function _BuildSiloBaselineNetworkPolicy(
  namespace: string,
  clusterTenantName: string,
  config: OpenClawTenantOperatorConfig,
): k8s.V1NetworkPolicy
{
  // The opencrane-ui + shared planes live in the operator's own namespace in the
  // shared tier; it is the only namespace a silo may talk to besides itself + DNS.
  const platformNamespace = config.operatorNamespace;

  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: {
      name: `opencrane-${clusterTenantName}-silo-baseline`,
      namespace,
      labels: {
        "app.kubernetes.io/part-of": "opencrane",
        "app.kubernetes.io/managed-by": "opencrane-fleet-manager",
        "app.kubernetes.io/component": "silo-isolation",
        "opencrane.io/cluster-tenant": clusterTenantName,
      },
    },
    spec: {
      // Empty selector → every pod in the silo namespace; both types → default-deny.
      podSelector: {},
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        {
          // `_from` (NOT `from`): `from` is an ES reserved word, so the generated
          // client model prefixes it with an underscore and maps it back to the JSON
          // `from` on the wire. Writing `from` here would be dropped by the serializer,
          // leaving an empty `from` that matches ALL sources — a silent fail-open.
          _from: [
            // Intra-silo: pods within this same namespace may talk to each other.
            { podSelector: {} },
            // The opencrane-ui/operator super-admin plane (the only cross-silo principal).
            { namespaceSelector: { matchLabels: { [_NAMESPACE_NAME_LABEL]: platformNamespace } } },
          ],
        },
      ],
      egress: [
        // Cluster DNS — without this every name lookup fails and the pod is dead.
        {
          to: [{ namespaceSelector: { matchLabels: { [_NAMESPACE_NAME_LABEL]: _DNS_NAMESPACE } } }],
          ports: [
            { protocol: "UDP", port: 53 },
            { protocol: "TCP", port: 53 },
          ],
        },
        // Intra-silo + the shared platform planes (opencrane-ui, Obot, skills, LiteLLM, Cognee).
        // Unrestricted by port — this is namespace/platform-scoped only (not an exfiltration
        // path to an external attacker), and Cognee legitimately needs it to reach LiteLLM in
        // the same namespace. External HTTPS is deliberately NOT here — see
        // _BuildSiloExternalEgressNetworkPolicy.
        {
          to: [
            { podSelector: {} },
            { namespaceSelector: { matchLabels: { [_NAMESPACE_NAME_LABEL]: platformNamespace } } },
          ],
        },
      ],
    },
  };
}

/**
 * Build the silo's external-HTTPS egress allowance — split OUT of
 * {@link _BuildSiloBaselineNetworkPolicy} so Cognee can be excluded from it.
 *
 * The baseline's own egress rules (DNS + intra-silo/platform) are safe to leave
 * unrestricted-by-destination because they never leave the cluster. "External HTTPS
 * to anywhere" is different: it is exactly the egress an unpatched Cognee
 * vulnerability (topoteretes/cognee#3084) would need to exploit. That bug lets ANY
 * authenticated Cognee user overwrite the process-wide LLM/embedding endpoint
 * (`POST /api/v1/settings` has no admin/superuser check) — if Cognee could reach an
 * attacker-controlled host on 443, every tenant's prompts/entities/graph data flowing
 * through this silo's shared Cognee instance would be exfiltrated the moment anyone
 * points that endpoint off-cluster. The rest of the silo (the openclaw agent itself)
 * legitimately calls out to LLM/MCP/Git providers over HTTPS, so it keeps this grant —
 * only Cognee's pod is carved out via the `NotIn` match below.
 *
 * @param namespace - The silo (ClusterTenant) namespace the policy is created in.
 * @param clusterTenantName - Parent ClusterTenant name, recorded as a label.
 * @returns The external-HTTPS egress policy, excluding the bundled Cognee pod.
 */
export function _BuildSiloExternalEgressNetworkPolicy(
  namespace: string,
  clusterTenantName: string,
): k8s.V1NetworkPolicy
{
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: {
      name: `opencrane-${clusterTenantName}-external-egress`,
      namespace,
      labels: {
        "app.kubernetes.io/part-of": "opencrane",
        "app.kubernetes.io/managed-by": "opencrane-fleet-manager",
        "app.kubernetes.io/component": "silo-isolation",
        "opencrane.io/cluster-tenant": clusterTenantName,
      },
    },
    spec: {
      // Every pod in the namespace EXCEPT Cognee (see the doc comment above for why).
      podSelector: {
        matchExpressions: [
          { key: "app.kubernetes.io/component", operator: "NotIn", values: [_COGNEE_COMPONENT_LABEL] },
        ],
      },
      policyTypes: ["Egress"],
      egress: [
        {
          ports: [{ protocol: "TCP", port: 443 }],
        },
      ],
    },
  };
}

/**
 * Build the silo control-plane Kubernetes API egress allowance.
 *
 * The baseline policy intentionally flips the whole silo namespace to default-deny.
 * In standalone mode that namespace also contains the in-silo operator and Obot
 * gateway. Both use their Kubernetes service-account identity, and the API service
 * may be enforced as either service port 443 or backend port 6443 depending on the
 * CNI/kube-proxy path. Keep this as a separate, component-scoped policy so tenant
 * pods do not gain a Kubernetes API egress grant.
 *
 * @param namespace - The silo (ClusterTenant) namespace the policy is created in.
 * @param clusterTenantName - Parent ClusterTenant name, recorded as a label.
 * @returns The Kubernetes API egress policy for in-silo control-plane pods.
 */
export function _BuildSiloKubernetesApiEgressNetworkPolicy(
  namespace: string,
  clusterTenantName: string,
  kubernetesServiceHost = process.env["KUBERNETES_SERVICE_HOST"] ?? "",
): k8s.V1NetworkPolicy
{
  const kubernetesServiceIpBlock = _IpBlockForHost(kubernetesServiceHost);
  const kubernetesServiceRule: k8s.V1NetworkPolicyEgressRule = kubernetesServiceIpBlock
    ? { to: [{ ipBlock: kubernetesServiceIpBlock }], ports: [{ protocol: "TCP", port: 443 }] }
    : { ports: [{ protocol: "TCP", port: 443 }] };

  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: {
      name: `opencrane-${clusterTenantName}-kube-api-egress`,
      namespace,
      labels: {
        "app.kubernetes.io/part-of": "opencrane",
        "app.kubernetes.io/managed-by": "opencrane-fleet-manager",
        "app.kubernetes.io/component": "silo-isolation",
        "opencrane.io/cluster-tenant": clusterTenantName,
      },
    },
    spec: {
      podSelector: {
        matchExpressions: [
          { key: "app.kubernetes.io/component", operator: "In", values: _KUBERNETES_API_EGRESS_COMPONENTS },
        ],
      },
      policyTypes: ["Egress"],
      egress: [
        kubernetesServiceRule,
        {
          // Standard NetworkPolicy cannot select the Kubernetes Service by name, and some
          // CNIs enforce the apiserver connection after kube-proxy has translated it to
          // the backend 6443 port. Keep this fallback component-scoped; Kubernetes RBAC is
          // still the authorization boundary for what these pods may do once connected.
          ports: [
            { protocol: "TCP", port: 6443 },
          ],
        },
      ],
    },
  };
}
