/**
 * API types for the audit-log route.
 */

/** Single entry in the audit log. */
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
