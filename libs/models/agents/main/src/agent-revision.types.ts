import type { CanonicalJsonSha256Digest } from "@opencrane/util";

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

/** Immutable reference to an integration assignment. */
export interface IntegrationAssignmentReference
{
	/** Stable silo-scoped integration identifier. */
	readonly integrationId: string;
	/** Immutable opaque Obot custody reference selected for the revision. */
	readonly custodyReferenceId: string;
	/** Explicit tool identifiers exposed from the integration. */
	readonly allowedTools: readonly string[];
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

/** Immutable catalogue revision used to bound an agent capability. */
export interface AgentRevisionCapabilityCatalogueReference
{
	/** Stable capability catalogue identifier. */
	readonly catalogId: string;
	/** Positive immutable catalogue revision number. */
	readonly revision: number;
	/** Digest binding the entry to its exact catalogue revision. */
	readonly digest: CanonicalJsonSha256Digest;
}

/** Immutable catalog-qualified capability that bounds one agent revision. */
export interface AgentRevisionCapabilityCeilingEntry
{
	/** Exact immutable catalogue revision defining this capability. */
	readonly catalog: AgentRevisionCapabilityCatalogueReference;
	/** Stable capability identifier inside the referenced catalogue. */
	readonly capabilityId: string;
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
	/** Immutable upper bound on capabilities that a run may receive. */
	readonly capabilityCeiling: readonly AgentRevisionCapabilityCeilingEntry[];
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
