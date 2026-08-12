/**
 * API types for the audit-log route.
 */

/**
 * One row of the operator-facing audit log, as returned by GET /audit.
 *
 * These are the readable entries written by the group and tenant routes, not the append-only
 * authorization decisions from __AppendAuditDecision. `tenant` is part of the contract but the list
 * route does not populate it today.
 */
export interface AuditEntry
{
  /** ISO-8601 timestamp of the event. */
  timestamp: string;
  /** Tenant name the event relates to, if applicable. */
  tenant?: string;
  /** Action or reason code (e.g. "Created", "Deleted"). */
  action: string;
  /** Resource reference (e.g. "Tenant/my-tenant"). */
  resource: string;
  /** Human-readable event message. */
  message: string;
}
