/** Monitoring severity for a tenant's fleet participation (locked P4B.0 model). */
export type ParticipationSeverity = "ok" | "warning" | "critical";

/** Inputs used to classify one tenant's fleet participation state. */
export interface ClassifyParticipationArgs
{
  /** Most recent participation timestamp in epoch milliseconds, or null when unseen. */
  lastSeenAtMs: number | null;
  /** Contract version reported by the tenant, or null when no version was reported. */
  runningVersion: string | null;
  /** Contract version the current rollout expects the tenant to run. */
  expectedVersion: string;
  /** Number of policy-violating executions recorded for the tenant. */
  policyViolations: number;
  /** Current time in epoch milliseconds, injected for deterministic classification. */
  nowMs: number;
  /** Maximum interval since the last event before the tenant is non-participating. */
  stalenessWindowMs: number;
}

/** Participation flags and monitoring severity derived for one tenant. */
export interface ParticipationClassification
{
  /** Whether the tenant has participated within the configured staleness window. */
  participating: boolean;
  /** Whether the tenant's reported contract differs from its expected contract. */
  drifted: boolean;
  /** Resulting monitoring severity. */
  severity: ParticipationSeverity;
}

/** A fleet participation event ingested from a claw (P4B.5). */
export interface ParticipationEventInput
{
  /** Emitting tenant (derived from the projected-token identity, not the body). */
  tenant: string;
  /** Event kind. */
  kind: "agent_card" | "skill_execution" | "heartbeat";
  /** At-least-once idempotency key; a redelivery with the same key is deduped. */
  idempotencyKey: string;
  /** When the event occurred (claw clock); defaults to now when omitted. */
  occurredAt?: string;
  /** The awareness contract version the claw reports running (drift signal). */
  contractVersion?: string;
  /** For `skill_execution`: `ok` or `policy-violation`. */
  outcome?: "ok" | "policy-violation";
  /** Kind-specific payload (Agent Card manifest, skill digest/name, …). */
  payload?: Record<string, unknown>;
}

/** Outcome of ingesting a participation event. */
export interface RecordParticipationResult
{
  /** Whether a new event row was recorded. */
  recorded: boolean;
  /** Whether the event was a duplicate (idempotency key already seen). */
  duplicate: boolean;
}

/** Per-tenant participation status with its monitoring severity. */
export interface TenantParticipationStatus
{
  /** Tenant name. */
  tenant: string;
  /** Most recent event time (ISO), or null if never seen. */
  lastSeenAt: string | null;
  /** The contract version the tenant reports running. */
  runningContractVersion: string | null;
  /** The contract version the rollout expects this tenant to run. */
  expectedContractVersion: string;
  /** Whether the tenant is participating (seen within the staleness window). */
  participating: boolean;
  /** Whether the running version differs from the expected version. */
  drifted: boolean;
  /** Count of policy-violating skill executions. */
  policyViolations: number;
  /** Monitoring severity: policy-violation → critical; non-participation/drift → warning. */
  severity: ParticipationSeverity;
}

/** Fleet-wide participation report. */
export interface FleetParticipationReport
{
  /** Total tenants considered. */
  total: number;
  /** Number participating (seen within the window). */
  participating: number;
  /** Number whose running version drifted from expected. */
  drifted: number;
  /** Number with at least one policy violation (critical). */
  critical: number;
  /** Number at warning severity (non-participation or drift, no violations). */
  warning: number;
  /** Per-tenant statuses. */
  tenants: TenantParticipationStatus[];
}
