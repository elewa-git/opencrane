import type * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";

/** Outcome of ensuring an owner or member workspace tenant. */
export interface EnsureDefaultTenantResult
{
  /** The workspace tenant name that was ensured. */
  tenantName: string;
  /** Whether a new DB projection row was created on this call. */
  created: boolean;
  /** Why no tenant was created when the operation was skipped. */
  skippedReason?: string;
}

/** Inputs shared by owner-default and member workspace tenant creation. */
export interface EnsureWorkspaceTenantOptions
{
  /** Kubernetes custom-objects client, or null when cluster writes are disabled. */
  customApi: k8s.CustomObjectsApi | null;
  /** Prisma client used for tenant projection and audit persistence. */
  prisma: PrismaClient;
  /** Kubernetes namespace that owns the tenant resource. */
  namespace: string;
  /** Owning ClusterTenant name. */
  orgName: string;
  /** Deterministic workspace tenant name. */
  tenantName: string;
  /** Human-readable workspace display name. */
  displayName: string;
  /** Verified owner email. */
  email: string;
  /** Optional IdP subject bound to the workspace. */
  subject?: string | undefined;
  /** Audit message written after successful creation. */
  auditMessage: string;
}

/** Inputs for ensuring an organization's owner-default workspace tenant. */
export interface EnsureOwnerDefaultTenantOptions
{
  /** Kubernetes custom-objects client, or null when cluster writes are disabled. */
  customApi: k8s.CustomObjectsApi | null;
  /** Prisma client used for tenant projection and audit persistence. */
  prisma: PrismaClient;
  /** Kubernetes namespace that owns the tenant resource. */
  namespace: string;
  /** Owning ClusterTenant name. */
  orgName: string;
  /** Human-readable organization name used in the workspace label. */
  orgDisplayName: string;
  /** Optional verified owner email supplied by the caller. */
  ownerEmail?: string | undefined;
  /** Optional verified owner IdP subject. */
  ownerSubject?: string | undefined;
}

/** Inputs for ensuring a subject-bound member workspace tenant. */
export interface EnsureMemberTenantOptions
{
  /** Kubernetes custom-objects client, or null when cluster writes are disabled. */
  customApi: k8s.CustomObjectsApi | null;
  /** Prisma client used for tenant projection and audit persistence. */
  prisma: PrismaClient;
  /** Kubernetes namespace that owns the tenant resource. */
  namespace: string;
  /** Owning ClusterTenant name. */
  orgName: string;
  /** Verified member email. */
  email: string;
  /** Verified member IdP subject. */
  subject: string;
}
