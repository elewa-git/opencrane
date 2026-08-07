import type { AgentRunId, UserId } from "@opencrane/models/agents";

/** Stable identifier of an approval request. */
export type ApprovalId = string;

/** Lifecycle status of a proof-bound approval request. */
export enum ApprovalStatus
{
  /** Awaiting an authorized user decision. */
  Pending = "pending",
  /** Authorized user approved the exact action and arguments. */
  Approved = "approved",
  /** Authorized user denied the request. */
  Denied = "denied",
  /** Request expired before a decision. */
  Expired = "expired",
  /** Previously issued approval was revoked before consumption. */
  Revoked = "revoked",
}

/** Proof-bound approval checkpoint for one exact action. */
export interface Approval
{
  /** Stable approval identifier. */
  id: ApprovalId;
  /** Run paused at this checkpoint. */
  runId: AgentRunId;
  /** Capability requested by the run. */
  capabilityKey: string;
  /** Digest binding action name and normalized arguments. */
  actionDigest: string;
  /** Current approval status. */
  status: ApprovalStatus;
  /** User authorized to decide the request. */
  decisionOwnerUserId: UserId;
  /** ISO-8601 expiry time. */
  expiresAt: string;
  /** ISO-8601 decision time when resolved. */
  decidedAt?: string;
}
