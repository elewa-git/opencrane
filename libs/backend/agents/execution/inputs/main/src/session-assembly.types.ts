import type { MemoryFactReference, RunInputSnapshotIdentity, RunInputSnapshotIntegrationAssignment } from "@opencrane/contracts";
import type { InitialRunAuthority, RunAdmissionCommand, RunAdmissionRepository, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import type { PersonaRevisionId } from "@opencrane/models/agents";
import type { MessageContentBlock, MessageId } from "@opencrane/models/conversations";
import type { ArtifactRevisionId, SkillRevisionId } from "@opencrane/models/artifacts";
import type { JsonValue } from "@opencrane/util";

import type { SessionAssemblyRefusalReason } from "./session-assembly-result.types.js";

/** Coordinates supplied by run admission; loaders obtain every durable input themselves. */
export type SessionAssemblyCommand = RunAdmissionCommand;

/** One source read either resolves an exact input or declines it with a stable reason. */
export type SessionAssemblyLoad<T> = { readonly outcome: "loaded"; readonly value: T } | { readonly outcome: "denied"; readonly reason: Exclude<SessionAssemblyRefusalReason, "invalid_command" | "persistence_unavailable"> };

/** Approved persona evidence available to a personal runtime. */
export interface ApprovedPersonaInput
{
	/** Exact active approved PersonaRevision. */
	personaRevisionId: PersonaRevisionId | null;
}

/** Ordered persisted conversation context already fenced by the conversation authority. */
export interface ConversationContextInput
{
	/** Ordered message identifiers included in the runtime prompt. */
	messageIds: readonly MessageId[];
	/** Current validated user input staged for same-transaction persistence, or null outside browser conversation admission. */
	pendingUserMessage: { readonly id: MessageId; readonly blocks: readonly MessageContentBlock[] } | null;
}

/** Durable preference fact chosen for transparent prompt personalization. */
export interface PreferenceFactInput
{
	/** Stable fact identifier. */
	id: string;
}

/** Authorised memory inputs and retrieval policy frozen for a single run. */
export interface MemoryScopeInput
{
	/** Policy constraining the runtime's subsequent memory recall. */
	memoryQueryPolicy: JsonValue;
	/** Pinned durable fact references admitted into prompt context. */
	memoryFacts: readonly MemoryFactReference[];
}

/** Revision-assigned model, tools, skills, and immutable artifacts. */
export interface ToolPolicyInput
{
	/** Server-selected model route without provider credentials. */
	modelRoute: JsonValue;
	/** Exact third-party integration tools the revision permits at runtime. */
	integrationAssignments: readonly RunInputSnapshotIntegrationAssignment[];
	/** Immutable skill revisions eligible for this run. */
	skillRevisionIds: readonly SkillRevisionId[];
	/** Immutable artifact revisions explicitly made available to the run. */
	artifactRevisionIds: readonly ArtifactRevisionId[];
}

/** Effective run limits resolved from service, silo, and policy. */
export interface BudgetPolicyInput
{
	/** JSON-safe policy covering token, cost, duration, and tool ceilings. */
	budgetPolicy: JsonValue;
}

/** Tagged frozen identity plus its separately sealed effective capability-set digest. */
export type IdentityEnvelopeInput = RunInputSnapshotIdentity & {
	/** SHA-256 digest of every capability fact accepted at the admission fence. */
	readonly capabilitySetDigest: string;
};

/** Reads run, AgentService, and published revision facts in the assembly transaction. */
export interface RunAuthoritySource
{
	/** Loads only authority required to admit this exact run attempt. */
	load(command: SessionAssemblyCommand, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<InitialRunAuthority>>;
}

/** Reads the active approved persona without reusing the persona-approval evidence path. */
export interface ApprovedPersonaSource
{
	/** Loads the approved persona for a personal service or null for a managed service. */
	load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<ApprovedPersonaInput>>;
}

/** Reads the ordered transcript input for the fixed conversation. */
export interface ConversationContextSource
{
	/** Loads the already ordered message coordinates for this session. */
	load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<ConversationContextInput>>;
}

/** Transaction-scoped durable reader used by the conversation-context source. */
export interface ConversationContextRepository
{
	/** Loads ordered message coordinates from one final-admission snapshot. */
	load(command: SessionAssemblyCommand, run: InitialRunAuthority): Promise<SessionAssemblyLoad<ConversationContextInput>>;
}

/** Creates the conversation reader over the exact final-admission transaction. */
export interface ConversationContextRepositoryFactory
{
	(transaction: RunAdmissionTransaction): ConversationContextRepository;
}

/** Reads explicit and accepted durable preference facts for the execution subject. */
export interface PreferenceFactSource
{
	/** Loads zero or more stable preference fact identifiers scoped by verified tagged identity. */
	load(command: SessionAssemblyCommand, run: InitialRunAuthority, identity: IdentityEnvelopeInput, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<readonly PreferenceFactInput[]>>;
}

/** Reads authorised memory scope and pinned fact references. */
export interface MemoryScopeSource
{
	/** Loads the exact memory scope allowed for this run from fresh verified identity and the frozen conversation. */
	load(command: SessionAssemblyCommand, run: InitialRunAuthority, identity: IdentityEnvelopeInput, conversation: ConversationContextInput, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<MemoryScopeInput>>;
}

/** Reads revision assignments intersected with the caller's effective grants. */
export interface ToolPolicySource
{
	/** Loads only model, tool, skill, and artifact inputs the runtime may consume. */
	load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<ToolPolicyInput>>;
}

/** Revalidates every assigned skill revision immediately before immutable snapshot persistence. */
export interface SkillRevisionEligibilitySource
{
	/** Refuses a run when its tool policy omits, crosses scope with, or references a non-published skill revision. */
	load(command: SessionAssemblyCommand, run: InitialRunAuthority, toolPolicy: ToolPolicyInput, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<null>>;
}

/** Reads effective resource limits for one run. */
export interface BudgetPolicySource
{
	/** Loads immutable budget policy selected for this run. */
	load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<BudgetPolicyInput>>;
}

/** Reads fresh identity and membership evidence at the final admission boundary. */
export interface IdentityEnvelopeSource
{
	/** Loads capability and fleet-membership facts that bind the runtime identity. */
	load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<IdentityEnvelopeInput>>;
}

/** Ports required by the one session-assembly entry point. */
export interface SessionAssemblyAuthorities
{
	/** Run and snapshot admission authority. */
	admission: RunAdmissionRepository;
	/** Run authority revalidated only inside the admission transaction. */
	runAuthority: RunAuthoritySource;
	/** Approved-persona authority. */
	approvedPersona: ApprovedPersonaSource;
	/** Conversation transcript authority. */
	conversationContext: ConversationContextSource;
	/** Durable preference-fact authority. */
	preferenceFacts: PreferenceFactSource;
	/** Memory-scope authority. */
	memoryScope: MemoryScopeSource;
	/** Tool and registered model-definition authority. */
	toolPolicy: ToolPolicySource;
	/** Future-admission skill eligibility authority. */
	skillEligibility: SkillRevisionEligibilitySource;
	/** Budget authority. */
	budgetPolicy: BudgetPolicySource;
	/** Identity and membership authority. */
	identityEnvelope: IdentityEnvelopeSource;
}
