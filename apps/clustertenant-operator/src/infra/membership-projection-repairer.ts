import type { Logger } from "pino";
import type { OrgMemberStatus, PrismaClient } from "@prisma/client";

import { _CutTenant } from "../core/connections/cut-tenant.js";
import { _SetTenantSuspended } from "../core/tenants/tenant-suspension.js";
import type { FleetMembershipReader, FleetMembershipRow, MembershipEnforcementDeps } from "./membership-projection-repairer.types.js";

/** Default interval (seconds) between membership-projection sweeps. */
const _DEFAULT_INTERVAL_SECONDS = 60;

/** The org roles the silo read-model stores (mirrors the Prisma `OrgRole` enum). */
const _ORG_ROLES = ["Owner", "Admin", "Member"] as const;

/** One org role the silo persists. */
type OrgRoleValue = (typeof _ORG_ROLES)[number];

/** Whether a value is one of the three valid org roles. */
function _isOrgRole(value: unknown): value is OrgRoleValue
{
  return typeof value === "string" && (_ORG_ROLES as readonly string[]).includes(value);
}

/**
 * Normalise a wire `status` to the silo enum. The fleet emits `"Active"`/`"Suspended"`; anything
 * absent or unrecognised is treated as `Active` (fail-open on the STATUS field so a schema skew
 * never mass-suspends an org — a genuine suspension is always an explicit `"Suspended"`).
 *
 * @param value - The raw `status` field off the wire row (may be undefined).
 * @param log   - Optional logger; when given, a PRESENT-but-unrecognized value is warned (schema skew).
 * @param ctx   - Optional log context (e.g. `{ clusterTenant, subject }`).
 * @returns The projected `OrgMemberStatus` (`Suspended` only for an exact `"Suspended"`).
 */
function _toMemberStatus(value: unknown, log?: Logger, ctx?: Record<string, unknown>): OrgMemberStatus
{
  if (value === "Suspended") return "Suspended";
  // Absent/empty is the normal pre-status wire shape (an older fleet) → Active, silently.
  // A PRESENT but unrecognized value is fleet schema skew: still fail OPEN to Active (never
  // mass-suspend on an unknown value) but surface it so the drift is visible in telemetry.
  if (value !== undefined && value !== null && value !== "" && value !== "Active")
  {
    log?.warn({ ...ctx, rawStatus: value }, "unrecognized OrgMembership status from fleet; treating as Active (schema skew?)");
  }
  return "Active";
}

/**
 * Build the default HTTP membership reader over the fleet internal endpoint
 * (`GET <fleetInternalUrl>/api/internal/cluster-tenants/<org>/members`).
 *
 * Returns null (⇒ repairer no-op) when the fleet URL is unset — the #151 standalone case,
 * where membership is managed locally and there is no fleet to pull from. Presents the
 * `OPENCRANE_API_TOKEN` bearer when set (the fleet's `/api/internal/*` auth). Any transport
 * error or non-OK status also yields null so an unreachable fleet never crashes the loop or
 * clears the local read-model.
 *
 * @param fleetInternalUrl - Base URL of the fleet internal listener, empty ⇒ standalone (no-op).
 * @param token            - Shared service bearer for the fleet internal API (empty ⇒ omitted).
 * @param log              - Scoped logger.
 * @param fetchImpl        - Injectable fetch (defaults to global `fetch`) for testability.
 */
export function _BuildHttpFleetMembershipReader(fleetInternalUrl: string, token: string, log: Logger,
                                                fetchImpl: typeof fetch = fetch): FleetMembershipReader
{
  const base = fleetInternalUrl.trim().replace(/\/+$/, "");
  return {
    async read(clusterTenant: string): Promise<FleetMembershipRow[] | null>
    {
      // Standalone (#151): no fleet configured ⇒ membership is managed locally; no-op.
      if (!base)
      {
        return null;
      }
      const url = `${base}/api/internal/cluster-tenants/${encodeURIComponent(clusterTenant)}/members`;
      const headers: Record<string, string> = {};
      if (token)
      {
        headers.authorization = `Bearer ${token}`;
      }
      try
      {
        const res = await fetchImpl(url, { headers });
        if (!res.ok)
        {
          log.warn({ clusterTenant, status: res.status }, "fleet membership read returned non-OK; skipping sweep");
          return null;
        }
        const body = await res.json() as { members?: unknown };
        if (!Array.isArray(body.members))
        {
          log.warn({ clusterTenant }, "fleet membership read had no members array; skipping sweep");
          return null;
        }
        return body.members.filter(_isFleetMembershipRow);
      }
      catch (err)
      {
        log.warn({ err, clusterTenant }, "fleet membership read failed; skipping sweep (membership managed locally until fleet is reachable)");
        return null;
      }
    },
  };
}

/** Writes member adoptions through to the fleet — the authoritative `OrgMembership` store (S4). */
export interface FleetMembershipWriter
{
  /**
   * Adopt a member into the org at the fleet (create-if-absent, never downgrade). Returns true
   * when the fleet accepted the write, false on any transport error or non-OK status (the login
   * proceeds regardless — the next login and the projection sweep are the backstops).
   */
  adopt(clusterTenant: string, subject: string): Promise<boolean>;
}

/**
 * Build the HTTP fleet membership writer over the fleet internal adopt endpoint
 * (`POST <fleetInternalUrl>/api/internal/cluster-tenants/<org>/members/adopt`).
 *
 * Returns **null** when the fleet URL is unset — the #151 standalone case, where the silo's own
 * `OrgMembership` is the system-of-record and adoption writes locally instead. A non-null writer
 * means fleet-managed: the fleet owns membership, so adoption must write through here (the
 * projection repairer then mirrors the row straight back), or a silo-local write would be reaped
 * by the next sweep. Presents the `OPENCRANE_API_TOKEN` bearer when set.
 *
 * @param fleetInternalUrl - Base URL of the fleet internal listener; empty ⇒ null (standalone).
 * @param token            - Shared service bearer for the fleet internal API (empty ⇒ omitted).
 * @param log              - Scoped logger.
 * @param fetchImpl        - Injectable fetch (defaults to global `fetch`) for testability.
 */
export function _BuildHttpFleetMembershipWriter(fleetInternalUrl: string, token: string, log: Logger,
                                                fetchImpl: typeof fetch = fetch): FleetMembershipWriter | null
{
  const base = fleetInternalUrl.trim().replace(/\/+$/, "");
  if (!base)
  {
    return null;
  }
  return {
    async adopt(clusterTenant: string, subject: string): Promise<boolean>
    {
      const url = `${base}/api/internal/cluster-tenants/${encodeURIComponent(clusterTenant)}/members/adopt`;
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (token)
      {
        headers.authorization = `Bearer ${token}`;
      }
      try
      {
        const res = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify({ subject }) });
        if (!res.ok)
        {
          log.warn({ clusterTenant, status: res.status }, "fleet member adoption returned non-OK; will retry on next login/sweep");
          return false;
        }
        return true;
      }
      catch (err)
      {
        log.warn({ err, clusterTenant }, "fleet member adoption failed; will retry on next login/sweep");
        return false;
      }
    },
  };
}

/** Narrow an unknown list entry to a `{ subject, role }` row. */
function _isFleetMembershipRow(value: unknown): value is FleetMembershipRow
{
  const row = value as { subject?: unknown; role?: unknown };
  return typeof row?.subject === "string" && row.subject.length > 0 && typeof row?.role === "string";
}

/**
 * Periodic fleet → silo OrgMembership projection repairer.
 *
 * The fleet registry owns the authoritative `OrgMembership` rows; the silo's local
 * `OrgMembership` table is a read-model the org-admin gate + `POST /tenants` membership
 * validation (S1) depend on, but the silo cannot read the fleet DB across the boundary.
 * This loop closes the gap the same way {@link TenantProjectionRepairer} does for Tenants:
 * it periodically pulls the org's authoritative membership from the fleet internal endpoint
 * and upserts the silo's local rows (adding new members, correcting drifted roles, removing
 * members the fleet has dropped).
 *
 * Fail-soft + standalone-safe: when the fleet is unconfigured (#151) or unreachable, the
 * reader returns null and the sweep is a no-op — the local rows are left intact so
 * locally-managed membership survives. Idempotent (a converged org is silent) and a sweep
 * error is logged, not thrown, so the loop and the pod both survive.
 */
export class MembershipProjectionRepairer
{
  /** Prisma client for the silo's OrgMembership read-model. */
  private readonly _prisma: PrismaClient;

  /** Reader over the fleet's authoritative membership. */
  private readonly _reader: FleetMembershipReader;

  /** The org (ClusterTenant) this silo hosts, whose membership is reconciled. */
  private readonly _clusterTenant: string;

  /** Scoped logger. */
  private readonly _log: Logger;

  /** Sweep interval in milliseconds; 0 disables the loop. */
  private readonly _intervalMs: number;

  /** Active interval handle; null when stopped/disabled. */
  private _timer: ReturnType<typeof setInterval> | null = null;

  /** Guards against overlapping sweeps when one runs longer than the interval. */
  private _running = false;

  /**
   * Kubernetes + gateway clients for suspension ENFORCEMENT; null ⇒ enforcement disabled (the
   * projection still runs, but Suspended members are not cut/pod-suspended). Standalone installs
   * with no enforcement wiring stay projection-only.
   */
  private readonly _enforcement: MembershipEnforcementDeps | null;

  /**
   * @param prisma        - Prisma client for the silo OrgMembership rows.
   * @param reader        - Reader over the fleet's authoritative membership.
   * @param clusterTenant - The org whose membership to reconcile (this silo's org).
   * @param log           - Pino logger; a scoped child is derived.
   * @param intervalMs    - Sweep interval in ms (default 60 000; 0 disables).
   * @param enforcement   - K8s/gateway clients for suspension enforcement; null ⇒ projection-only.
   */
  constructor(prisma: PrismaClient, reader: FleetMembershipReader, clusterTenant: string, log: Logger,
              intervalMs = _DEFAULT_INTERVAL_SECONDS * 1000, enforcement: MembershipEnforcementDeps | null = null)
  {
    this._prisma = prisma;
    this._reader = reader;
    this._clusterTenant = clusterTenant;
    this._log = log.child({ component: "membership-projection-repairer" });
    this._intervalMs = intervalMs;
    this._enforcement = enforcement;
  }

  /**
   * Start the periodic repair loop. A sweep fires immediately so a freshly-added member
   * surfaces without waiting a full interval. A non-positive interval OR an empty
   * ClusterTenant disables the loop (nothing to reconcile).
   */
  start(): void
  {
    if (this._intervalMs <= 0)
    {
      this._log.info("membership projection repairer disabled (interval <= 0)");
      return;
    }
    if (!this._clusterTenant.trim())
    {
      this._log.info("membership projection repairer disabled (no cluster tenant configured)");
      return;
    }
    this._log.info({ clusterTenant: this._clusterTenant, intervalMs: this._intervalMs }, "membership projection repairer started");
    const repairer = this;
    this._timer = setInterval(function _tick() { void repairer._sweep(); }, this._intervalMs);
    void this._sweep();
  }

  /** Stop the loop and release the interval handle. */
  stop(): void
  {
    if (this._timer !== null)
    {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * Run one repair sweep: pull the org's authoritative membership from the fleet and
   * reconcile the silo rows to it. A null read (unconfigured/unreachable) is a safe
   * no-op. Skips when a previous sweep is still running; never throws.
   */
  private async _sweep(): Promise<void>
  {
    if (this._running) return;
    this._running = true;
    try
    {
      const fleetRows = await this._reader.read(this._clusterTenant);
      if (fleetRows === null)
      {
        // Source unavailable — leave the local read-model untouched (no destructive wipe).
        return;
      }
      const changed = await this._reconcile(fleetRows);
      if (changed > 0)
      {
        this._log.info({ clusterTenant: this._clusterTenant, changed }, "membership projection reconciled drifted rows");
      }
      // Enforce the projected status: cut + pod-suspend Suspended members, resume Active ones.
      // Best-effort per member; a failure is logged inside and never aborts the sweep.
      await this._enforceStatuses(fleetRows);
    }
    catch (err)
    {
      this._log.warn({ err, clusterTenant: this._clusterTenant }, "membership projection sweep failed; will retry next interval");
    }
    finally
    {
      this._running = false;
    }
  }

  /**
   * Reconcile the silo's OrgMembership rows to the fleet's authoritative set: upsert every
   * fleet row (add/correct role) and delete local rows the fleet no longer has. Returns the
   * count of rows changed (created/updated/deleted) for logging.
   *
   * @param fleetRows - The org's authoritative membership from the fleet.
   * @returns The number of local rows created, updated, or deleted.
   */
  private async _reconcile(fleetRows: FleetMembershipRow[]): Promise<number>
  {
    const clusterTenant = this._clusterTenant;
    const desired = fleetRows.filter(function _valid(row) { return _isOrgRole(row.role); });
    const desiredSubjects = new Set(desired.map(function _sub(row) { return row.subject; }));

    const existing = await this._prisma.orgMembership.findMany({
      where: { clusterTenant },
      select: { subject: true, role: true, status: true },
    });
    const existingBySubject = new Map(existing.map(function _entry(row) { return [row.subject, row]; }));

    let changed = 0;

    // Upsert every desired member: create the missing, correct the drifted role AND status.
    for (const row of desired)
    {
      const status = _toMemberStatus(row.status, this._log, { clusterTenant: this._clusterTenant, subject: row.subject });
      const current = existingBySubject.get(row.subject);
      if (current && current.role === row.role && current.status === status)
      {
        continue;
      }
      await this._prisma.orgMembership.upsert({
        where: { clusterTenant_subject: { clusterTenant, subject: row.subject } },
        create: { clusterTenant, subject: row.subject, role: row.role as OrgRoleValue, status },
        update: { role: row.role as OrgRoleValue, status },
      });
      changed += 1;
    }

    // Remove local rows the fleet no longer lists (offboarded members). Bounded to this org.
    for (const row of existing)
    {
      if (!desiredSubjects.has(row.subject))
      {
        await this._prisma.orgMembership.delete({
          where: { clusterTenant_subject: { clusterTenant, subject: row.subject } },
        });
        changed += 1;
      }
    }

    return changed;
  }

  /**
   * Enforce each member's projected lifecycle status (#126). For a SUSPENDED member: cut their
   * live sessions/devices (per-subject `_CutTenant`) and suspend their workspace pod (patch the
   * member's Tenant CR `spec.suspended: true` — the TenantOperator scales suspended→0). For an
   * ACTIVE member: clear `spec.suspended` so a reactivated member's pod comes back. Idempotent and
   * best-effort per member — a failure on one member is logged, not thrown, so the sweep and the
   * pod both survive.
   *
   * Enforcement is a no-op when the enforcement clients were not wired (standalone/projection-only)
   * OR when a member has no per-member Tenant workspace in this silo (the cut/patch key the Tenant
   * CR + pod off the member's own tenant; a member with no workspace has nothing to enforce).
   *
   * @param fleetRows - The org's authoritative membership from the fleet (carrying status).
   */
  private async _enforceStatuses(fleetRows: FleetMembershipRow[]): Promise<void>
  {
    const enforcement = this._enforcement;
    if (!enforcement)
    {
      return;
    }

    for (const row of fleetRows)
    {
      if (!_isOrgRole(row.role))
      {
        continue;
      }
      const suspended = _toMemberStatus(row.status, this._log, { clusterTenant: this._clusterTenant, subject: row.subject }) === "Suspended";

      // 1. Locate this member's own workspace tenant in the silo, keyed on the member's OIDC
      //    subject (the Tenant.subject binding) scoped to this org. The Tenant CR name + pod are
      //    keyed off it; a member with no workspace (e.g. an admin who never provisioned one) has
      //    nothing to cut or suspend, so skip.
      const tenant = await this._prisma.tenant.findFirst({
        where: { clusterTenantRef: this._clusterTenant, subject: row.subject },
        select: { name: true },
      });
      const tenantName = tenant?.name;
      if (!tenantName)
      {
        continue;
      }

      try
      {
        if (suspended)
        {
          // 2a. Sever the member's live sessions/devices (per-subject scope — does NOT delete the
          //     shared pod), then suspend their workspace pod via the Tenant CR flag.
          await _CutTenant(enforcement.coreApi, this._prisma, enforcement.gatewayAdmin, {
            tenant: tenantName,
            namespace: enforcement.namespace,
            subject: row.subject,
            reason: "membership suspended (#126 license lifecycle)",
          });
          await _SetTenantSuspended(enforcement.customApi, enforcement.namespace, tenantName, true);
        }
        else
        {
          // 2b. Reactivated: clear the suspension so the TenantOperator scales the pod back up.
          await _SetTenantSuspended(enforcement.customApi, enforcement.namespace, tenantName, false);
        }
      }
      catch (err)
      {
        this._log.warn({ err, clusterTenant: this._clusterTenant, subject: row.subject, tenant: tenantName, suspended }, "membership suspension enforcement failed for a member; will retry next sweep");
      }
    }
  }
}
