import type { MemoryFactReference, RunInputSnapshot } from "@opencrane/contracts";
import type { InitialRunAuthority, RunAdmissionCommand, RunAdmissionRepository, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import type { MessageId, PersonaRevisionId } from "@opencrane/models/agents";
import type { ArtifactRevisionId, SkillRevisionId } from "@opencrane/models/artifacts";
import type { JsonValue } from "@opencrane/util";

/** Coordinates supplied by run admission; loaders obtain every durable input themselves. */
export type SessionAssemblyCommand = RunAdmissionCommand;

/** Typed refusal that stops assembly before a partial snapshot can be persisted. */
export type SessionAssemblyRefusalReason = "invalid_command" | "run_not_admittable" | "revision_unavailable" | "persona_unavailable" | "thread_unavailable" | "memory_scope_unavailable" | "tool_policy_unavailable" | "budget_unavailable" | "membership_stale" | "identity_unavailable" | "persistence_unavailable";

/** One source read either resolves an exact input or declines it with a stable reason. */
export type SessionAssemblyLoad<T> = { readonly outcome: "loaded"; readonly value: T } | { readonly outcome: "denied"; readonly reason: Exclude<SessionAssemblyRefusalReason, "invalid_command" | "persistence_unavailable"> };

/** Approved persona evidence available to a personal runtime. */
export interface ApprovedPersonaInput
{
	/** Exact active approved PersonaRevision. */
	personaRevisionId: PersonaRevisionId | null;
}

/** Ordered persisted thread context already fenced by the conversation authority. */
export interface ThreadContextInput
{
	/** Ordered message identifiers included in the runtime prompt. */
	messageIds: readonly MessageId[];
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
	/** Effective grant identifiers exposing tools to the runtime. */
	toolGrantIds: readonly string[];
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

/** Proof-bound identity evidence that must be fresh at admission. */
export interface IdentityEnvelopeInput
{
	/** Subject authorized to cause this exact execution. */
	executionSubjectId: string;
	/** Highest verified fleet-membership revision used to authorize the run. */
	fleetMembershipRevision: number;
	/** Issuer that signed the accepted fleet-membership revision. */
	fleetMembershipIssuer: string;
	/** Signing key that cryptographically verified the accepted fleet-membership revision. */
	fleetMembershipIssuerKeyId: string;
	/** Stable signed assertion identifier bound to the execution subject. */
	fleetMembershipAssertionId: string;
	/** Digest of the verified signed membership payload. */
	fleetMembershipPayloadDigest: string;
	/** UTC expiry after which the evidence cannot admit the run. */
	fleetMembershipTrustedUntil: string;
	/** Digest of the effective capability set bound to the run. */
	capabilitySetDigest: string;
}

/** Capability-set digest loaded from the same transaction that verifies membership. */
export interface CapabilitySetDigestSource
{
	/** Resolves the exact proof-bound capability digest accepted for this initial run. */
	load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<string>>;
}

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

/** Reads the ordered transcript input for the fixed thread. */
export interface ThreadContextSource
{
	/** Loads the already ordered message coordinates for this session. */
	load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<ThreadContextInput>>;
}

/** Reads explicit and accepted durable preference facts for the execution subject. */
export interface PreferenceFactSource
{
	/** Loads zero or more stable preference fact identifiers. */
	load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<readonly PreferenceFactInput[]>>;
}

/** Reads authorised memory scope and pinned fact references. */
export interface MemoryScopeSource
{
	/** Loads the exact memory scope allowed for this run. */
	load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<MemoryScopeInput>>;
}

/** Reads revision assignments intersected with the caller's effective grants. */
export interface ToolPolicySource
{
	/** Loads only model, tool, skill, and artifact inputs the runtime may consume. */
	load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<ToolPolicyInput>>;
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
	threadContext: ThreadContextSource;
	/** Durable preference-fact authority. */
	preferenceFacts: PreferenceFactSource;
	/** Memory-scope authority. */
	memoryScope: MemoryScopeSource;
	/** Tool and model-policy authority. */
	toolPolicy: ToolPolicySource;
	/** Budget authority. */
	budgetPolicy: BudgetPolicySource;
	/** Identity and membership authority. */
	identityEnvelope: IdentityEnvelopeSource;
}

/** Public result from attempting to assemble and persist one immutable runtime input. */
export type AssembleRunInputSnapshotResult = { readonly outcome: "assembled"; readonly snapshot: RunInputSnapshot } | { readonly outcome: "denied"; readonly reason: SessionAssemblyRefusalReason };
