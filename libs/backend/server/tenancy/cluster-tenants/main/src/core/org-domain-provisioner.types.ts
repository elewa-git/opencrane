/**
 * Per-org domain provisioning seam (#151 item 2), silo side.
 *
 * This repo's fixed topology is SINGLE-HOST-PER-ORG: an org (ClusterTenant) is served at
 * its DERIVED apex `<org>.<platformBase>` and every user in the org connects through that
 * ONE host — the in-process gateway proxy routes each connection to the right pod, so
 * there is NO per-user `<user>.<org>.<base>` subdomain (see `_ResolveOrgServingDomain`).
 * That collapses the per-org domain work to two minimal, idempotent side effects, both
 * declared as namespaced custom resources the reconciler owns — NO cloud SDK, NO direct
 * DNS-provider calls:
 *
 *   1. DNS — one EXPLICIT A record `<org>.<base>` → the cluster ingress IP, declared as an
 *      external-dns `DNSEndpoint` CR and reconciled into whatever DNS provider the platform
 *      runs (Cloud DNS, Route53, Cloudflare, RFC2136, …).
 *   2. TLS — the canonical host `<org>.<base>` is one label under the platform base, so it
 *      is already covered by the platform's own `*.<base>` / opencrane-ui certificate; the
 *      ONLY per-org certificate issued here is for an optional customer-VANITY host (a
 *      CNAME the customer points at the ingress), via cert-manager HTTP-01.
 *
 * Ported from the (now fleet-owned, WeOwnAI-repo) `fleet-operator`'s OrgDomainProvisioner so
 * a STANDALONE silo (no external fleet) can provision its own org's domain. The concrete
 * implementation is `DefaultOrgDomainProvisioner` (`org-domain.provisioner.js`), wired by
 * `_BuildOrgDomainProvisioner` from the caller's cert-manager issuer config. It is
 * RUNTIME-GATED by real capability detection — when cert-manager is absent (the Certificate
 * CRD is not served) AND external-dns is absent (the DNSEndpoint CRD is not served), it
 * returns `{ ready:false, skipped:true }` rather than throwing, so a silo without either
 * backend installed still reconciles cleanly.
 */

/** Inputs the reconciler passes when provisioning an org's domain + TLS. */
export interface OrgDomainProvisionRequest
{
  /**
   * Org (ClusterTenant) name — the single DNS label, e.g. `acme`. Sourced from the
   * ClusterTenant CR's `metadata.name`, which Kubernetes already validates as an
   * RFC 1123 subdomain, so it is safe to use unescaped in derived hostnames, the
   * bound-namespace name, and Certificate label values.
   */
  orgName: string;
  /**
   * The org's bound namespace, where the per-org `DNSEndpoint`/`Certificate` are created.
   * Passed in rather than re-derived so namespace derivation lives in exactly one place.
   */
  boundNamespace: string;
  /** Platform base domain the org hangs off, e.g. `weownai.eu`. */
  platformBaseDomain: string;
  /**
   * Optional customer-vanity domain CNAMEd onto the org apex (`<name>.<base>`). When
   * present, the implementation issues a per-org Certificate for it. DNS for the vanity
   * name itself is the customer's CNAME at their own provider — never created here.
   */
  vanityDomain?: string;
  /**
   * Cluster ingress external IP the org's A record must point at. Optional: when unset,
   * the DNS side effect is skipped (no zone target) and only the Certificate (if a
   * vanity domain is set) is applied — the caller still surfaces the skip.
   */
  ingressIp?: string;
}

/** Result reported back to the caller so it can stamp the org's status/logs. */
export interface OrgDomainProvisionResult
{
  /** Canonical org host the record (and any vanity cert) were provisioned for (`<name>.<base>`). */
  orgDomain: string;
  /** Name of the per-org vanity TLS Secret, when a vanity cert was issued. */
  tlsSecretName?: string;
  /** Whether the org-host DNS record (and any vanity cert) is ready. */
  ready: boolean;
  /**
   * True when the backend (cert-manager / DNS) was unavailable and the step was
   * skipped gracefully. The caller may surface this as a status condition or log line;
   * the org still reaches `ready` because the namespace boundary is the attachment gate.
   */
  skipped: boolean;
  /** Human-readable detail, set when skipped or while issuance is in flight. */
  message?: string;
}

/** Backend that materialises an org's DNS record + optional vanity TLS certificate. */
export interface OrgDomainProvisioner
{
  /**
   * Provision (idempotently) the per-org DNS record and any vanity TLS certificate.
   * Called by the reconciler on every reconcile; safe to re-invoke.
   * MUST NOT throw on backend-unavailable — return `{ ready: false, skipped: true }`.
   *
   * @param req - Org coordinates, platform base, optional vanity domain, ingress IP.
   * @returns The provisioned apex, vanity TLS secret name, readiness, and skip flag.
   */
  provisionOrgDomain(req: OrgDomainProvisionRequest): Promise<OrgDomainProvisionResult>;

  /**
   * Tear down the per-org DNS record + vanity certificate when the org is deleted.
   * Idempotent: a missing record / Certificate / CRD are all no-ops.
   *
   * @param orgName - The org (ClusterTenant) name being deprovisioned.
   * @param platformBaseDomain - The platform base domain the org hung off.
   * @param boundNamespace - The org's bound namespace the DNSEndpoint/Certificate live in.
   */
  deprovisionOrgDomain(orgName: string, platformBaseDomain: string, boundNamespace: string): Promise<void>;
}

/** The readiness a cert-manager Certificate reports once issuance completes. */
export interface CertificateReadiness
{
  /** Whether the Certificate's `Ready` condition is `True` (issuance complete). */
  ready: boolean;
  /** Whether cert-manager is installed (the Certificate CRD is served). */
  certManagerInstalled: boolean;
  /** Human-readable reason when not ready (condition message, or CRD-absent note). */
  reason?: string;
}

/**
 * Minimal interface over the cert-manager Certificate operations the
 * OrgDomainProvisioner needs. Injected so unit tests can substitute a fake without a
 * live cluster or the CustomObjectsApi.
 */
export interface CertManagerOperations
{
  /**
   * Apply (create-or-replace) a Certificate CR, idempotently. A re-apply carries the
   * live resourceVersion so it never conflicts. Surfaces `certManagerInstalled: false`
   * (fail-closed, never throws) when the Certificate CRD is absent.
   *
   * @param namespace - Namespace the Certificate (and its Secret) live in.
   * @param manifest  - The Certificate manifest to apply.
   * @returns The Certificate's readiness, including whether cert-manager is installed.
   */
  applyCertificate(namespace: string, manifest: Record<string, unknown>): Promise<CertificateReadiness>;

  /**
   * Delete the named Certificate if present; absence (404) and a missing CRD are both
   * no-ops (idempotent teardown).
   *
   * @param namespace - Namespace the Certificate lives in.
   * @param name      - Certificate name.
   */
  deleteCertificate(namespace: string, name: string): Promise<void>;
}

/** Whether an external-dns DNSEndpoint was declared (so the record will be reconciled). */
export interface DnsEndpointReadiness
{
  /** True when the DNSEndpoint was applied; false when external-dns's CRD is absent. */
  applied: boolean;
  /** Human-readable reason when not applied (CRD-absent note). */
  reason?: string;
}

/**
 * Minimal interface over the external-dns `DNSEndpoint` operations the
 * OrgDomainProvisioner needs. The reconciler declares the desired records as a namespaced
 * custom resource and external-dns reconciles them into the configured DNS provider — so
 * no cloud DNS SDK is carried here. Injected so unit tests can substitute a fake.
 */
export interface DnsEndpointOperations
{
  /**
   * Apply (create-or-replace) a DNSEndpoint CR, idempotently. A re-apply carries the
   * live resourceVersion so it never conflicts. Surfaces `applied: false` (fail-closed,
   * never throws) when external-dns's DNSEndpoint CRD is absent.
   *
   * @param namespace - Namespace the DNSEndpoint lives in (the org's bound namespace).
   * @param manifest  - The DNSEndpoint manifest to apply.
   * @returns Whether the DNSEndpoint was applied (false when external-dns is absent).
   */
  applyDnsEndpoint(namespace: string, manifest: Record<string, unknown>): Promise<DnsEndpointReadiness>;

  /**
   * Delete the named DNSEndpoint if present; absence (404) and a missing CRD are both
   * no-ops (idempotent teardown).
   *
   * @param namespace - Namespace the DNSEndpoint lives in.
   * @param name      - DNSEndpoint name.
   */
  deleteDnsEndpoint(namespace: string, name: string): Promise<void>;
}

/**
 * Static config the provisioner needs to author the per-org vanity Certificate, supplied
 * from the caller's cert-manager issuer config (chart `certManager.issuerName` / kind).
 * Injected so the provisioner carries no environment reads. The bound namespace is NOT
 * here — it arrives per-request (`OrgDomainProvisionRequest.boundNamespace`).
 */
export interface OrgDomainProvisionerConfig
{
  /** cert-manager issuer name the Certificate references (chart `certManager.issuerName`). */
  issuerName: string;
  /** Issuer kind: a cluster-singleton `ClusterIssuer` (default) or namespaced `Issuer`. */
  issuerKind: "ClusterIssuer" | "Issuer";
}
