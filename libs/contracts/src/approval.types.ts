import type { AgentRunId, UserId } from "@opencrane/models/agents";

/** Stable identifier of an approval request. */
export type ApprovalId = string;

/** Where an approval request stands. Only `Approved` permits the action, and only until it is consumed once — `Revoked` means an approval that was granted no longer counts. */
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

/** One paused action waiting for a person's decision. `argumentsDigest` ties the approval to the exact arguments shown to the approver, so approving cannot authorize different arguments later. */
export interface Approval
{
  /** Stable approval identifier. */
  id: ApprovalId;
  /** Run paused at this checkpoint. */
  runId: AgentRunId;
  /** Capability requested by the run. */
  capabilityKey: string;
  /** Digest of the action name plus its normalized arguments. Dispatch recomputes it, so changed arguments invalidate the approval. */
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
