import { createHash } from "crypto";

import * as k8s from "@kubernetes/client-node";
import { Prisma, type PrismaClient } from "@prisma/client";

import { OPENCRANE_API_GROUP, OPENCRANE_API_VERSION, TENANT_CRD_PLURAL, _IsK8sConflict, _IsK8sNotFound } from "@opencrane/infra-api";

/** Suffix appended to an org name to form its first workspace Tenant's name. */
export const _DEFAULT_TENANT_SUFFIX = "-default";

/** Outcome of an {@link _EnsureOwnerDefaultTenant} / {@link _EnsureMemberTenant} call. */
export interface EnsureDefaultTenantResult
{
  /** The workspace tenant name that was ensured. */
  tenantName: string;
  /** Whether a new DB projection row was created on this call (false = already present). */
  created: boolean;
  /** When nothing was created and the row was not already present, why it was skipped. */
  skippedReason?: string;
}

/**
 * Deterministic, stable, DNS-safe workspace-Tenant name for a member: `<org>-u-<hash>`
 * where `<hash>` is the first 10 hex chars of `sha256(subject)`. The subject (an 18-digit
 * Zitadel user id) is itself DNS-safe, but hashing bounds the suffix to a fixed 12 chars so
 * `openclaw-<name>` stays within the 63-char Service-name limit for any org name, and avoids
 * leaking the raw IdP subject into a cluster object name.
 *
 * @param orgName - The owning ClusterTenant (org) name.
 * @param subject - The member's IdP-verified subject (OIDC `sub`).
 */
export function _MemberTenantName(orgName: string, subject: string): string
{
  const hash = createHash("sha256").update(subject).digest("hex").slice(0, 10);
  return `${orgName}-u-${hash}`;
}

/**
 * Dual-write core shared by the owner-default and per-member workspace seeds: ensure a
 * workspace Tenant (the Tenant CRD AND its DB projection row) exists for one org user.
 *
 * Idempotent and recovery-safe:
 *  - returns early when the DB row already exists (the steady-state path);
 *  - enforces the ≥1-model onboarding precondition (LiteLLM `replace` mode requires a model);
 *  - tolerates a pre-existing CRD (AlreadyExists) and still writes the missing DB row;
 *  - tolerates a P2002 row race.
 *
 * The caller supplies the resolved `email` (never recovered here); an empty email is a skip,
 * not an error, so an email-less workspace is never created.
 */
async function _EnsureWorkspaceTenant(opts: {
  customApi: k8s.CustomObjectsApi | null;
  prisma: PrismaClient;
  namespace: string;
  orgName: string;
  tenantName: string;
  displayName: string;
  email: string;
  subject?: string | undefined;
  auditMessage: string;
}): Promise<EnsureDefaultTenantResult>
{
  const { customApi, prisma, namespace, orgName, tenantName, displayName, subject, auditMessage } = opts;
  const email = opts.email.trim();

  // 1. Already projected → nothing to do (idempotent steady state). The unique key is the
  //    tenant name, so this also collapses a concurrent caller down to a single create.
  const existingRow = await prisma.tenant.findUnique({ where: { name: tenantName } });
  if (existingRow)
  {
    return { tenantName, created: false };
  }

  // 2. Onboarding precondition — at least one model must be registered. Tenant pods run LiteLLM
  //    in `replace` mode (the proxy is the ONLY provider — see 2-config-map.ts `models.mode`), so a
  //    silo with no models would provision a pod with an empty allowlist and zero usable models.
  //    Refuse to seed a workspace until a model exists at its scope (Global, or its own
  //    ClusterTenant). Self-heals: registering a model — or setting a provider key, which
  //    auto-seeds one — then re-triggering the seed re-runs this gate.
  const modelCount = await prisma.modelDefinition.count({
    where: { OR: [{ scope: "Global" }, { scope: "ClusterTenant", clusterTenant: orgName }] },
  });
  if (modelCount === 0)
  {
    return { tenantName, created: false, skippedReason: "no models registered for this org — register a model or set a provider key before its workspace can start (LiteLLM replace mode requires ≥1 model)" };
  }

  if (!email)
  {
    return { tenantName, created: false, skippedReason: "no email available for the workspace owner" };
  }

  // 3. Detect a pre-existing CRD so the create step is skipped (recovering a CRD seeded
  //    out-of-band without its DB projection).
  let crdExists = false;
  if (customApi)
  {
    try
    {
      await customApi.getNamespacedCustomObject({
        group: OPENCRANE_API_GROUP, version: OPENCRANE_API_VERSION, namespace, plural: TENANT_CRD_PLURAL, name: tenantName,
      });
      crdExists = true;
    }
    catch (err)
    {
      if (!_IsK8sNotFound(err)) throw err;
    }
  }

  // 4. Dual-write. Create the CRD first (skip when no cluster is wired or it already exists;
  //    tolerate a create-time AlreadyExists race), then the DB projection row.
  if (customApi && !crdExists)
  {
    try
    {
      await customApi.createNamespacedCustomObject({
        group: OPENCRANE_API_GROUP, version: OPENCRANE_API_VERSION, namespace, plural: TENANT_CRD_PLURAL,
        body: {
          apiVersion: `${OPENCRANE_API_GROUP}/${OPENCRANE_API_VERSION}`,
          kind: "Tenant",
          metadata: { name: tenantName, namespace },
          spec: { displayName, email, clusterTenantRef: orgName, ...(subject?.trim() ? { subject: subject.trim() } : {}) },
        },
      });
    }
    catch (err)
    {
      if (!_IsK8sConflict(err)) throw err;
    }
  }

  try
  {
    await prisma.tenant.create({
      data: { name: tenantName, displayName, email, clusterTenantRef: orgName, subject: subject?.trim() || null },
    });
  }
  catch (err)
  {
    // Lost a create race against a concurrent caller — the row now exists, which is the
    // desired end state; treat as already-present rather than an error.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")
    {
      return { tenantName, created: false };
    }
    throw err;
  }

  // Best-effort audit; the FK target (the tenant row) now exists. A failed audit write
  // must never undo or fail the seed itself.
  await prisma.auditEntry.create({
    data: { tenant: tenantName, action: "Created", resource: `Tenant/${tenantName}`, message: auditMessage },
  }).catch(() => { /* audit is non-critical */ });

  return { tenantName, created: true };
}

/**
 * Ensure an org's first workspace Tenant (`<org>-default`, attributed to the owner)
 * exists as a control-plane dual-write: the Tenant CRD AND its DB projection row.
 *
 * This is the single authority for default-tenant creation. The org create handler calls
 * it so a freshly-provisioned customer has a workspace row immediately (the TenantOperator
 * reconciles it to Running once the org's namespace is bound), and the refresh endpoint
 * calls it to self-heal an org that reached ready without a tenant row.
 *
 * The owner email is taken from `ownerEmail` when provided, else recovered from an existing
 * CRD's `spec.email`. Absent both (the dev-auth path carries only a subject), the seed is
 * skipped with a reason rather than creating an email-less Tenant.
 *
 * @returns Whether a DB row was created, and a skip reason when it was not.
 */
export async function _EnsureOwnerDefaultTenant(opts: {
  customApi: k8s.CustomObjectsApi | null;
  prisma: PrismaClient;
  namespace: string;
  orgName: string;
  orgDisplayName: string;
  ownerEmail?: string | undefined;
  ownerSubject?: string | undefined;
}): Promise<EnsureDefaultTenantResult>
{
  const { customApi, prisma, namespace, orgName, orgDisplayName, ownerEmail, ownerSubject } = opts;
  const tenantName = `${orgName}${_DEFAULT_TENANT_SUFFIX}`;

  // Fast idempotent exit before any CRD read (steady state).
  const existingRow = await prisma.tenant.findUnique({ where: { name: tenantName } });
  if (existingRow)
  {
    return { tenantName, created: false };
  }

  // Resolve the owner email: the caller's value wins; otherwise recover it from an
  // already-seeded CRD (the path we are repairing).
  let email = ownerEmail?.trim() ?? "";
  if (!email && customApi)
  {
    try
    {
      const cr = await customApi.getNamespacedCustomObject({
        group: OPENCRANE_API_GROUP, version: OPENCRANE_API_VERSION, namespace, plural: TENANT_CRD_PLURAL, name: tenantName,
      }) as { spec?: { email?: string } };
      email = cr.spec?.email?.trim() ?? "";
    }
    catch (err)
    {
      if (!_IsK8sNotFound(err)) throw err;
    }
  }

  if (!email)
  {
    return { tenantName, created: false, skippedReason: "no owner email available (caller session and CRD both absent)" };
  }

  return _EnsureWorkspaceTenant({
    customApi, prisma, namespace, orgName, tenantName,
    displayName: `${orgDisplayName} workspace`,
    email,
    subject: ownerSubject,
    auditMessage: `Default workspace tenant ${tenantName} created for org ${orgName}`,
  });
}

/**
 * Ensure a subject-bound workspace Tenant for an **adopted member** of an org — the same
 * internal dual-write as the owner seed, keyed by the member's own IdP identity rather than
 * `<org>-default`. Triggered from member adoption (first login through the per-org OIDC
 * client, and/or the member-add API), completing the onboarding funnel so an invited member
 * lands on a running, subject-bound pod (one pod per user per silo).
 *
 * `email` and `subject` come from the member's verified session and are both required; the
 * shared core enforces the ≥1-model precondition and is idempotent (safe to call on every
 * login). The tenant name is {@link _MemberTenantName}, so repeated logins converge on the
 * one workspace row the email→tenant router resolves.
 *
 * @returns Whether a DB row was created, and a skip reason when it was not.
 */
export async function _EnsureMemberTenant(opts: {
  customApi: k8s.CustomObjectsApi | null;
  prisma: PrismaClient;
  namespace: string;
  orgName: string;
  email: string;
  subject: string;
}): Promise<EnsureDefaultTenantResult>
{
  const { customApi, prisma, namespace, orgName, email, subject } = opts;
  const tenantName = _MemberTenantName(orgName, subject);

  // Never create a second workspace for an email that already resolves to one in this silo.
  // The owner logs in through the SAME per-org client and already holds `<org>-default` under
  // their email; a second row would make the email→tenant router (which is 1:1 per (email,
  // silo) and fail-closes on >1 match) refuse to route them. This also covers a legacy/imported
  // workspace already bound to this email under any other name. Idempotent re-logins for a genuine
  // member converge on the same deterministic name below, so this only skips true duplicates.
  const existingForEmail = await prisma.tenant.findFirst({
    where: { email: { equals: email.trim(), mode: "insensitive" }, clusterTenantRef: orgName },
    select: { name: true },
  });
  if (existingForEmail)
  {
    return { tenantName: existingForEmail.name, created: false, skippedReason: "email already has a workspace in this org" };
  }

  return _EnsureWorkspaceTenant({
    customApi, prisma, namespace, orgName, tenantName,
    displayName: `${email} workspace`,
    email,
    subject,
    auditMessage: `Member workspace tenant ${tenantName} created for ${email} in org ${orgName}`,
  });
}
