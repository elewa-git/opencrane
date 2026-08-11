import type { AgentRevisionId, AgentRunId, AgentServiceId, PersonaRevisionId } from "@opencrane/models/agents";
import type { ArtifactRevisionId, SkillRevisionId } from "@opencrane/models/artifacts";
import type { ConversationId, MessageId } from "@opencrane/models/conversations";
import type { JsonValue } from "@opencrane/util";

/**
 * Says whether a run is executed by a person or by a managed service. Stored in every run snapshot.
 *
 * The value alone grants nothing. Admission must still attach the matching signed evidence. They
 * never grant authority by themselves; admission must still bind the matching signed evidence.
 */
export enum RunInputSnapshotIdentityKinds
{
	/** A person, proven by verified fleet-membership evidence. */
	User = "user",
	/** A managed AgentService, proven by its derived principal and its allowed scope attachments. */
	Service = "service",
}

/** Signed membership evidence stored on both kinds of run identity. */
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
	/** UTC time after which this membership evidence may no longer authorize work. */
	fleetMembershipTrustedUntil: string;
}

/** Immutable identity for a run exercised by a human member. */
export interface UserRunInputSnapshotIdentity extends RunInputSnapshotFleetMembershipEvidence
{
	/** Tag fixed to `User`, so a service principal can never be read as a person. */
	kind: RunInputSnapshotIdentityKinds.User;
	/** Id of the person whose verified membership and grants authorize this run. */
	executionSubjectId: string;
}

/** One non-personal scope attachment allowed for a managed service. */
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
	/** Tag fixed to `Service`, so service evidence never takes a personal-user code path. */
	kind: RunInputSnapshotIdentityKinds.Service;
	/** Canonical derived principal in `agent-service:<AgentServiceId>` form. */
	executionSubjectId: string;
	/** Id of the active managed service whose revision authorizes this run. */
	agentServiceId: AgentServiceId;
	/** Non-personal scope attachments allowed when the run was assembled, sorted canonically. */
	effectiveScopeAttachments: readonly ManagedRunInputScopeAttachment[];
	/** SHA-256 digest of the allowed scope attachments, so the set cannot change without detection. */
	effectiveScopeAttachmentDigest: string;
}

/** The run's identity — person or service — decided before the runtime receives the snapshot. */
export type RunInputSnapshotIdentity = UserRunInputSnapshotIdentity | ServiceRunInputSnapshotIdentity;

/** One reviewed integration tool, frozen when the run was admitted. */
export interface RunInputSnapshotToolDefinition
{
  /** Stable MCP tool name selected by the immutable revision. */
  name: string;
  /** Human-readable model guidance reviewed with the schema. */
  description: string;
  /** Exact JSON Schema used for model input and approval validation. */
  parametersSchema: JsonValue;
  /** Digest of the schema, so it cannot change after the snapshot was admitted. */
  parametersSchemaDigest: string;
}

/** The tools one integration is allowed to expose, as chosen by the AgentRevision being executed. */
export interface RunInputSnapshotIntegrationAssignment
{
  /** Integration selected by the revision. */
  integrationId: string;
  /** Exact reviewed tool definitions the revision permits through that integration. */
  toolDefinitions: readonly RunInputSnapshotToolDefinition[];
}

/** Everything a run needs, compiled and frozen before the runtime is assigned. */
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
  /** Digest of the capability set this run may exercise, each capability bound to a proof. */
  capabilitySetDigest: string;
  /** Digest of the authorization contract that was accepted when the run was admitted. */
  effectiveContractDigest: string;
  /** Version of the deterministic prompt compiler that will consume this input. */
  promptCompilerVersion: string;
  /** SHA-256 digest of the complete canonical snapshot in `sha256:<hex>` form. */
  digest: string;
  /** ISO-8601 compilation time. */
  compiledAt: string;
}
