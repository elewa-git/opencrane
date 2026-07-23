import type { AgentRevisionId, AgentRunId, AgentServiceId, MessageId, PersonaRevisionId, ThreadId } from "@opencrane/models/agents";
import type { ArtifactRevisionId, SkillRevisionId } from "@opencrane/models/artifacts";
import type { JsonValue } from "@opencrane/util";
import type { MemoryFactReference } from "./memory.types.js";

/** Immutable identity facts resolved before a runtime receives the snapshot. */
export interface RunInputSnapshotIdentity
{
  /** Subject that caused this exact run to execute. */
  executionSubjectId: string;
  /** Highest verified fleet-membership revision accepted for this run. */
  fleetMembershipRevision: number;
  /** Issuer that signed the accepted fleet-membership revision. */
  fleetMembershipIssuer: string;
  /** Signing key that verified the exact accepted fleet-membership revision. */
  fleetMembershipIssuerKeyId: string;
  /** Stable signed assertion identifier bound to the execution subject. */
  fleetMembershipAssertionId: string;
  /** Digest of the verified signed membership payload. */
  fleetMembershipPayloadDigest: string;
  /** UTC expiry after which the pinned membership evidence must not admit work. */
  fleetMembershipTrustedUntil: string;
}

/** One immutable artifact revision introduced by a particular conversation message. */
export interface MessageArtifactAttachmentReference
{
  /** Message that introduced this exact multimodal input. */
  readonly messageId: MessageId;
  /** Published artifact revision selected at admission, never a mutable artifact pointer. */
  readonly artifactRevisionId: ArtifactRevisionId;
  /** Zero-based order among artifact references on the message. */
  readonly ordinal: number;
}

/** Deterministic, immutable inputs compiled before a runtime assignment. */
export interface RunInputSnapshot
{
  /** Run receiving the snapshot. */
  runId: AgentRunId;
  /** Silo in which every identity and durable input is valid. */
  siloId: string;
  /** AgentService receiving the run. */
  agentServiceId: AgentServiceId;
  /** Immutable AgentRevision being executed. */
  agentRevisionId: AgentRevisionId;
  /** Monotonically versioned snapshot contract shape. */
  snapshotVersion: number;
  /** Thread supplying ordered conversation history, or null for a non-conversational run. */
  threadId: ThreadId | null;
  /** Ordered persisted messages included in the prompt. */
  messageIds: readonly MessageId[];
  /** Ordered immutable artifact references introduced by the selected message history. */
  messageArtifactAttachments: readonly MessageArtifactAttachmentReference[];
  /** Approved persona revision compiled into the prompt, when personal. */
  personaRevisionId: PersonaRevisionId | null;
  /** Ordered durable preference facts considered for this run. */
  preferenceFactIds: readonly string[];
  /** Immutable artifact revisions made available to the run. */
  artifactRevisionIds: readonly ArtifactRevisionId[];
  /** Immutable skill revisions made available to the run. */
  skillRevisionIds: readonly SkillRevisionId[];
  /** Scoped durable memory facts included in the prompt. */
  memoryFacts: readonly MemoryFactReference[];
  /** Authorised memory retrieval policy selected for this run. */
  memoryQueryPolicy: JsonValue;
  /** Immutable grants that expose tools to the selected revision. */
  toolGrantIds: readonly string[];
  /** Server-selected model route without provider credentials. */
  modelRoute: JsonValue;
  /** Immutable token, cost, time, and tool limits. */
  budgetPolicy: JsonValue;
  /** Execution identity and verified fleet-membership evidence. */
  identitySnapshot: RunInputSnapshotIdentity;
  /** Digest of the effective proof-bound capability set. */
  capabilitySetDigest: string;
  /** Digest of the effective contract accepted at run admission. */
  effectiveContractDigest: string;
  /** Version of the deterministic prompt compiler that will consume this input. */
  promptCompilerVersion: string;
  /** SHA-256 digest of the complete canonical snapshot in `sha256:<hex>` form. */
  digest: string;
  /** ISO-8601 compilation time. */
  compiledAt: string;
}
