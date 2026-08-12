import type { AgentRevisionId, AgentRunId, AgentServiceId, PersonaRevisionId } from "@opencrane/models/agents";
import type { ArtifactRevisionId, SkillRevisionId } from "@opencrane/models/artifacts";
import type { ConversationId, MessageId } from "@opencrane/models/conversations";
import type { JsonValue } from "@opencrane/util";
import type { MemoryFactReference } from "./memory.types.js";

/**
 * Stable execution-identity discriminants serialized in every immutable run snapshot.
 *
 * These values name whether verified authority belongs to a human member or managed service. They
 * never grant authority by themselves; admission must still bind the matching signed evidence.
 */
export enum RunInputSnapshotIdentityKinds
{
	/** Human member identity backed by verified fleet-membership evidence. */
	User = "user",
	/** Managed AgentService identity backed by its derived principal and admitted scopes. */
	Service = "service",
}

/** Signed membership evidence pinned into either kind of execution identity. */
export interface RunInputSnapshotFleetMembershipEvidence
{
	/** Organization selected by the verified fleet-membership assertion. */
	organizationId: string;
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

/** Immutable identity for a run exercised by a human member. */
export interface UserRunInputSnapshotIdentity extends RunInputSnapshotFleetMembershipEvidence
{
	/** Discriminant that prevents a service principal from being mistaken for a user. */
	kind: RunInputSnapshotIdentityKinds.User;
	/** Human subject whose verified membership and grants authorize this exact run. */
	executionSubjectId: string;
}

/** One exact non-personal scope attachment admitted for a managed service. */
export interface ManagedRunInputScopeAttachment
{
	/** Domain scope of the attached resource. */
	scope: string;
	/** Kind of subject named by the attachment. */
	subjectType: string;
	/** Stable identifier of the attached subject. */
	subjectId: string;
}

/** Immutable identity for a run exercised by an active managed AgentService. */
export interface ServiceRunInputSnapshotIdentity extends RunInputSnapshotFleetMembershipEvidence
{
	/** Discriminant that prevents service evidence from falling through to personal-user paths. */
	kind: RunInputSnapshotIdentityKinds.Service;
	/** Canonical derived principal in `agent-service:<AgentServiceId>` form. */
	executionSubjectId: string;
	/** Active managed service whose revision owns this exact execution authority. */
	agentServiceId: AgentServiceId;
	/** Canonically sorted effective non-personal scope attachments admitted at run assembly. */
	effectiveScopeAttachments: readonly ManagedRunInputScopeAttachment[];
	/** SHA-256 digest binding the admitted scope-attachment set into service capability evidence. */
	effectiveScopeAttachmentDigest: string;
}

/** Immutable, tagged execution identity resolved before a runtime receives the snapshot. */
export type RunInputSnapshotIdentity = UserRunInputSnapshotIdentity | ServiceRunInputSnapshotIdentity;

/** One exact reviewed integration tool definition frozen at run admission. */
export interface RunInputSnapshotToolDefinition
{
  /** Stable MCP tool name selected by the immutable revision. */
  name: string;
  /** Human-readable model guidance reviewed with the schema. */
  description: string;
  /** Exact JSON Schema used for model input and approval validation. */
  parametersSchema: JsonValue;
  /** Canonical digest binding the exact schema to the admitted snapshot. */
  parametersSchemaDigest: string;
}

/** Immutable integration tool allowance selected by the executing AgentRevision. */
export interface RunInputSnapshotIntegrationAssignment
{
  /** Integration selected by the revision. */
  integrationId: string;
  /** Exact reviewed tool definitions the revision permits through that integration. */
  toolDefinitions: readonly RunInputSnapshotToolDefinition[];
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
  /** Conversation supplying ordered history, or null for a non-conversational run. */
  conversationId: ConversationId | null;
  /** Ordered persisted messages included in the prompt. */
  messageIds: readonly MessageId[];
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
  /** Immutable third-party integration tool allowances selected by the revision. */
  integrationAssignments: readonly RunInputSnapshotIntegrationAssignment[];
  /** Server-selected model route without provider credentials. */
  modelRoute: JsonValue;
  /** Immutable token, cost, time, and tool limits. */
  budgetPolicy: JsonValue;
	/** Tagged execution identity and verified fleet-membership evidence. */
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
