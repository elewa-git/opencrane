/**
 * Types for the idempotent Zitadel reconcile/backfill (S3d).
 *
 * A ClusterTenant can carry a missing or partial Zitadel org — `zitadelOrgId`,
 * `zitadelClientId`, `zitadelAppId`, or `zitadelProjectId` null — when it was created
 * before Zitadel was configured, or when a provision half-failed. The reconcile route
 * re-runs `provisionOrg` for the gaps and heals the drift. These shapes describe its
 * request body and its per-CT outcome summary.
 */

import type { PrismaClient } from "../../generated/prisma/index.js";

/** A `cluster_tenants` row as returned by Prisma `findMany`/`findUnique`. */
export type ClusterTenantRow = NonNullable<Awaited<ReturnType<PrismaClient["clusterTenant"]["findUnique"]>>>;

/** Optional request body for the reconcile route: scope the run to a single ClusterTenant. */
export interface ZitadelReconcileRequest
{
  /** When set, reconcile ONLY this ClusterTenant (by name); when absent, scan the whole fleet. */
  name?: string;
}

/** A single skipped ClusterTenant and the reason it was not reconciled. */
export interface ZitadelReconcileSkip
{
  /** The ClusterTenant name. */
  name: string;
  /** Why it was skipped (`already-provisioned` or `no-owner`). */
  reason: ZitadelReconcileSkipReason;
}

/** The reasons a ClusterTenant is skipped during reconcile. */
export type ZitadelReconcileSkipReason = "already-provisioned" | "no-owner";

/** A single ClusterTenant whose reconcile FAILED, with the error detail. */
export interface ZitadelReconcileFailure
{
  /** The ClusterTenant name. */
  name: string;
  /** Human-readable error detail (never key material). */
  error: string;
}

/**
 * Per-org outcome of the membership-adoption backstop: how many Console-invited users were
 * adopted as `Member` (had no local `OrgMembership`) versus skipped (already had one).
 */
export interface ZitadelMemberAdoptionResult
{
  /** The ClusterTenant (org) name. */
  name: string;
  /** Count of Zitadel org users adopted as a new `Member` membership. */
  adopted: number;
  /** Count of Zitadel org users skipped because they already had a membership. */
  skipped: number;
}

/**
 * A single org whose membership-adoption pass FAILED (its `listOrgUsers` call or an adopt
 * write threw). Collected, not fatal — one org's failure never aborts the backstop run.
 */
export interface ZitadelMemberAdoptionFailure
{
  /** The ClusterTenant (org) name. */
  name: string;
  /** Human-readable error detail. */
  error: string;
}

/**
 * Summary of a reconcile run. The FIRST pass provisions incomplete Zitadel orgs: each
 * ClusterTenant lands in exactly one of `reconciled` (provisionOrg ran + ids persisted),
 * `skipped` (already complete, or no Owner membership), or `failed` (provisionOrg or the
 * persist threw — collected, not fatal). The SECOND pass (`memberAdoption`) is the
 * Zitadel→OrgMembership backstop: for every fully-provisioned org it adopts Console-invited
 * users who have no local membership as `Member`; per-org failures land in `memberAdoptionFailed`.
 */
export interface ZitadelReconcileSummary
{
  /** Names of ClusterTenants whose Zitadel ids were (re-)provisioned and persisted. */
  reconciled: string[];
  /** ClusterTenants left untouched, with the reason. */
  skipped: ZitadelReconcileSkip[];
  /** ClusterTenants whose reconcile threw (a per-CT failure never aborts the run). */
  failed: ZitadelReconcileFailure[];
  /** Per-org adoption counts from the Zitadel→OrgMembership backstop pass. */
  memberAdoption: ZitadelMemberAdoptionResult[];
  /** Orgs whose adoption pass threw (best-effort; never aborts the run). */
  memberAdoptionFailed: ZitadelMemberAdoptionFailure[];
}
