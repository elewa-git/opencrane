import type { CanonicalJsonSha256Digest, JsonValue } from "@opencrane/util";

import type { AgentRevisionId, AgentServiceId, PersonaRevisionId, UserId } from "./identifiers.types.js";
import type { RevisionScopeAttachment } from "./scope-attachment.types.js";

/** Publication state of an immutable agent revision. */
export type AgentRevisionState = "draft" | "published" | "rejected" | "retired";

/** Immutable reference to a skill revision assigned to an agent revision. */
export interface SkillRevisionReference
{
	/** Stable skill identifier. */
	readonly skillId: string;
	/** Immutable selected skill revision. */
	readonly revisionId: string;
}

/** One reviewed integration tool definition frozen into an immutable agent revision. */
export interface ReviewedIntegrationToolDefinition
{
	/** Stable MCP tool name selected from the reviewed integration catalogue. */
	readonly name: string;
	/** Human-readable model guidance reviewed with the tool schema. */
	readonly description: string;
	/** Exact JSON Schema governing every proposed and approved argument value. */
	readonly parametersSchema: JsonValue;
	/** Canonical digest proving the schema did not drift after revision authoring. */
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
	/** Maximum wall-clock duration permitted in milliseconds. */
	readonly maxDurationMs: number;
}

/**
 * Immutable executable content shared by every authority that creates an agent revision.
 *
 * Keeping this content shape below the persistence layer ensures revision authors, personal
 * configuration materialization, and digest calculation all describe the same business fact.
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
	readonly scopeAttachments: readonly RevisionScopeAttachment[];
}

/** Immutable executable configuration of an agent service. */
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
	/** Content digest covering every executable field. */
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
	/** Immutable revision-scoped knowledge scope attachments authorised for the runtime. */
	readonly scopeAttachments: readonly RevisionScopeAttachment[];
	/** Resource ceilings applied to each run. */
	readonly budget: AgentBudget;
	/** Identifier of the user who authored the revision. */
	readonly authoredBy: UserId;
	/** ISO-8601 instant at which the revision was created. */
	readonly createdAt: string;
	/** ISO-8601 publication instant, or null while unpublished. */
	readonly publishedAt: string | null;
}
