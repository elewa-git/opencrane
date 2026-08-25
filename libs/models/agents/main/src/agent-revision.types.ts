import type { CanonicalJsonSha256Digest, JsonValue } from "@opencrane/util";

import type { AgentRevisionId, AgentServiceId, PersonaRevisionId, UserId } from "./identifiers.types";
import type { RevisionBoundaryAttachment } from "./boundary-attachment.types";

/** Where a revision sits in review. Only `published` may execute. */
export enum AgentRevisionStates
{
	/** The revision remains pending and cannot execute. */
	Draft = "draft",
	/** The revision is immutable, reviewed, and eligible to execute while active. */
	Published = "published",
	/** Review refused the revision and it cannot execute. */
	Rejected = "rejected",
	/** The revision has ended permanently and cannot execute. */
	Retired = "retired",
}

/** Keeps persisted revision states compatible with their serialized enum values. */
export type AgentRevisionState = `${AgentRevisionStates}`;

/** Immutable reference to a skill revision assigned to an agent revision. */
export interface SkillRevisionReference
{
	/** Stable skill identifier. */
	readonly skillId: string;
	/** Immutable selected skill revision. */
	readonly revisionId: string;
}

/** One tool a reviewer approved, frozen into this revision so a later change to the integration catalogue cannot alter what the agent may call. */
export interface ReviewedIntegrationToolDefinition
{
	/** Stable MCP tool name selected from the reviewed integration catalogue. */
	readonly name: string;
	/** Human-readable model guidance reviewed with the tool schema. */
	readonly description: string;
	/** JSON Schema that every argument must satisfy, both when the model proposes a call and when a person approves it. */
	readonly parametersSchema: JsonValue;
	/** Digest of the schema above. Recomputing it detects any change made after the revision was authored. */
	readonly parametersSchemaDigest: CanonicalJsonSha256Digest;
}

/** Immutable reference to an integration assignment. */
export interface IntegrationAssignmentReference
{
	/** Stable silo-scoped integration identifier. */
	readonly integrationId: string;
	/** Immutable opaque Obot custody reference selected for the revision. */
	readonly custodyReferenceId: string;
	/** Reviewed tool definitions exposed from the integration. */
	readonly toolDefinitions: readonly ReviewedIntegrationToolDefinition[];
}

/** Immutable budget ceilings applied to a run. */
export interface AgentBudget
{
	/** Maximum model turns permitted in one run. */
	readonly maxTurns: number;
	/** Maximum input and output tokens permitted in one run. */
	readonly maxTokens: number;
	/** Maximum spend permitted in one run, expressed in micro-US-dollars. */
	readonly maxCostUsdMicros: number;
	/** Maximum wall-clock duration permitted in milliseconds. */
	readonly maxDurationMs: number;
}

/**
 * What an agent revision actually runs: prompt policy, persona, model, budget, skills, tools,
 * and knowledge boundaries.
 *
 * Defined below the persistence layer on purpose, so revision authoring, personal-configuration
 * materialization, and {@link __DigestAgentRevisionContent} all work from one shape. If they
 * diverged, two identical revisions could hash differently.
 */
export interface AgentRevisionContent
{
	/** Versioned platform prompt-policy reference compiled into the revision. */
	readonly promptPolicyVersion: string;
	/** Approved persona revision, or null for a managed agent without a personal persona. */
	readonly personaRevisionId: PersonaRevisionId | null;
	/** Registered model-definition reference; carries no provider secret. */
	readonly modelDefinitionId: string;
	/** Immutable resource ceilings applied to each run. */
	readonly budget: AgentBudget;
	/** Immutable skill revisions exposed to the runtime. */
	readonly skills: readonly SkillRevisionReference[];
	/** Immutable integration and tool assignments exposed to the runtime. */
	readonly integrationAssignments: readonly IntegrationAssignmentReference[];
	/** Revision-scoped knowledge attachments authorised for the runtime. */
	readonly boundaryAttachments: readonly RevisionBoundaryAttachment[];
}

/** One published-or-pending version of an agent service's configuration. It never changes after creation: a change means a new revision with a new `digest`. */
export interface AgentRevision
{
	/** Stable revision identifier. */
	readonly id: AgentRevisionId;
	/** Agent service to which the revision belongs. */
	readonly agentServiceId: AgentServiceId;
	/** Monotonically increasing revision number within the service. */
	readonly revision: number;
	/** Previous revision in the edit lineage, or null for the first revision. */
	readonly parentRevisionId: AgentRevisionId | null;
	/** Older revision this one was cloned from during a restore, or null otherwise. */
	readonly sourceRevisionId: AgentRevisionId | null;
	/** Human-authored explanation of what changed in this revision. */
	readonly changeMessage: string;
	/** Current publication state. */
	readonly state: AgentRevisionState;
	/** Digest over the fields in {@link AgentRevisionContent}, produced by {@link __DigestAgentRevisionContent}. */
	readonly digest: string;
	/** Versioned platform prompt-policy identifier. */
	readonly promptPolicyVersion: string;
	/** Approved persona revision for a personal agent, otherwise null. */
	readonly personaRevisionId: PersonaRevisionId | null;
	/** Registered model definition selected for this immutable revision. */
	readonly modelDefinitionId: string;
	/** Immutable skill revisions available to the runtime. */
	readonly skills: readonly SkillRevisionReference[];
	/** Immutable integration and tool assignments available to the runtime. */
	readonly integrationAssignments: readonly IntegrationAssignmentReference[];
	/** Immutable knowledge boundary attachments authorised for the runtime. */
	readonly boundaryAttachments: readonly RevisionBoundaryAttachment[];
	/** Resource ceilings applied to each run. */
	readonly budget: AgentBudget;
	/** Identifier of the user who authored the revision. */
	readonly authoredBy: UserId;
	/** ISO-8601 instant at which the revision was created. */
	readonly createdAt: string;
	/** ISO-8601 publication instant, or null while unpublished. */
	readonly publishedAt: string | null;
}
