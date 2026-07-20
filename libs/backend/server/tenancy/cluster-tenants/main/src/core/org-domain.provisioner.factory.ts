import type * as k8s from "@kubernetes/client-node";

import { CertManagerClient } from "./cert-manager.client.js";
import { DnsEndpointClient } from "./dns-endpoint.client.js";
import { DefaultOrgDomainProvisioner } from "./org-domain.provisioner.js";
import type { OrgDomainProvisioner, OrgDomainProvisionerConfig } from "./org-domain-provisioner.types.js";

/**
 * Build the concrete {@link OrgDomainProvisioner} from a minimal issuer config, wiring the
 * real cert-manager and external-dns custom-objects clients.
 *
 * Deliberately takes {@link OrgDomainProvisionerConfig} directly (just `issuerName` /
 * `issuerKind`) rather than a caller's full app config type, so this factory has no
 * coupling to any specific app's config shape and can be called from either the
 * (WeOwnAI-repo) fleet operator or a standalone silo's own operator.
 *
 * Both clients are ALWAYS wired: each detects an absent CRD at runtime (fail-closed)
 * rather than at construction, so a cluster without cert-manager and/or external-dns
 * still gets a real provisioner that skips the affected side gracefully. Neither talks
 * to a cloud DNS API directly — the DNS record is declared as a `DNSEndpoint` CR and the
 * external-dns controller reconciles it into whatever provider the platform runs.
 *
 * @param customApi - Kubernetes custom-objects client (Certificate + DNSEndpoint CRDs).
 * @param config - Cert-manager issuer name/kind to stamp on any per-org vanity Certificate.
 * @returns A wired provisioner.
 */
export function _BuildOrgDomainProvisioner(customApi: k8s.CustomObjectsApi, config: OrgDomainProvisionerConfig): OrgDomainProvisioner
{
  return new DefaultOrgDomainProvisioner(
    new CertManagerClient(customApi),
    new DnsEndpointClient(customApi),
    config,
  );
}
