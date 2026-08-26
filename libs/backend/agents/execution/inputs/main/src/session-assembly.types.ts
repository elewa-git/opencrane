import type { RunInputSnapshotIdentity, RunInputSnapshotIntegrationAssignment, RunInputSnapshotMcpTool } from "@opencrane/contracts";
import type { InitialRunAuthority, RunAdmissionCommand, RunAdmissionRepository, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import type { PersonaRevisionId } from "@opencrane/models/agents";
import type { MessageContentBlock, MessageId } from "@opencrane/models/conversations";
import type { ArtifactRevisionId, SkillRevisionId } from "@opencrane/models/artifacts";
import type { JsonValue } from "@opencrane/util";

import type { SessionAssemblyRefusalReason } from "./session-assembly-result.types";

/**
 * The ids, trigger, and identity kind run admission passes in.
 *
 * This is the complete list of what a caller may influence. Everything else in the snapshot is
 * read by a source from the database, which is why a browser request cannot widen its own run:
 * there is no field here for a persona, a tool, a budget, or a memory dataset.
 *
 * Re-exported shape of `RunAdmissionCommand` (execution/runs/main/src/run-admission.types.ts).
 */
export type SessionAssemblyCommand = RunAdmissionCommand;

/**
 * What one input source returns: either the value it loaded, or a refusal.
 *
 * A refusal from any single source aborts the whole admission with that reason — sources are not
 * best-effort and there is no partial snapshot. So an implementation must refuse rather than
 * return an empty or guessed value whenever it cannot prove what it read.
 *
 * The two reasons a source may NOT return are excluded by the type: `invalid_command` belongs to
 * the command check that runs before any source, and `persistence_unavailable` belongs to the
 * write at the end. A source that wants to say "I could not read" should use its own
 * `*_unavailable` reason instead.
 *
 * @typeParam T - The slice of run input this source owns.
 * @see SessionAssemblyRefusalReason
 */
export type SessionAssemblyLoad<T> = { readonly outcome: "loaded"; readonly value: T } | { readonly outcome: "denied"; readonly reason: Exclude<SessionAssemblyRefusalReason, "invalid_command" | "persistence_unavailable"> };

/** Approved persona evidence available to a personal runtime. */
export interface ApprovedPersonaInput
{
	/** The PersonaRevision that is currently active and approved, or null for a managed run. */
	personaRevisionId: PersonaRevisionId | null;
}

/** Holds the conversation's messages in order, as the conversation source read them inside the admission transaction. */
export interface ConversationContextInput
{
	/** Ordered message identifiers included in the runtime prompt. */
	messageIds: readonly MessageId[];
	/** The user's new message, waiting to be saved in the same transaction as the run. Null unless a browser conversation is being admitted. */
	pendingUserMessage: { readonly id: MessageId; readonly blocks: readonly MessageContentBlock[] } | null;
}

/** Names one stored preference fact chosen to personalise the prompt. */
export interface PreferenceFactInput
{
	/** Stable fact identifier. */
	id: string;
}

/** Authorised memory dataset coordinates frozen for a single run. */
export interface MemoryScopeInput
{
	/** Limits what the runtime may recall from memory later in the run. */
	memoryQueryPolicy: JsonValue;
}

/** Holds the model, tools, skills, and artifacts the published revision assigned to this run. */
export interface ToolPolicyInput
{
	/** Server-selected model route without provider credentials. */
	modelRoute: JsonValue;
	/**
	 * The third-party integration tools this revision allows at runtime.
	 *
	 * These are MCP tools: each carries a name, a description, and a JSON Schema for its arguments,
	 * and all three reach the model.
	 *
	 * @see https://modelcontextprotocol.io/specification/2025-06-18 - MCP, revision 2025-06-18 as
	 * pinned by `_MCP_PROTOCOL_VERSION` in server/infra/obot-custody.
	 */
	integrationAssignments: readonly RunInputSnapshotIntegrationAssignment[];
	/** Exact Ready MCP tool revisions selected by the AgentRevision. */
	mcpTools: readonly RunInputSnapshotMcpTool[];
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

/**
 * The run's identity fields, plus a digest of the capabilities that identity held at admission.
 *
 * The digest is the extra field: `RunInputSnapshotIdentity` is what gets persisted, and
 * `capabilitySetDigest` is used during assembly and then dropped by `_SnapshotIdentity` in
 * session-assembly.ts. So it is a check on what was true at admission time, not something the
 * runtime can read back later.
 *
 * @see IdentityEnvelopeSource
 */
export type IdentityEnvelopeInput = RunInputSnapshotIdentity & {
	/**
	 * SHA-256 digest over every capability fact accepted while the run was being admitted.
	 *
	 * The grants are sorted before hashing, so two runs with the same grants in a different row order
	 * produce the same digest.
	 *
	 * @see https://www.rfc-editor.org/rfc/rfc8785 - JSON Canonicalization Scheme, used by
	 * `__DigestCanonicalJson`. It fixes object key order but not array order, which is why the sort
	 * is done explicitly in `_CompareCanonicalGrant`.
	 */
	readonly capabilitySetDigest: string;
};

/**
 * Reads the run, AgentService, and published-revision facts every later source depends on.
 *
 * This runs first inside the admission transaction, and it deliberately re-reads the service even
 * though the caller already named one: between the caller's request and this transaction the
 * service can be paused, retired, or have its active revision swapped, and admitting against the
 * old revision would run the wrong instructions.
 *
 * Implemented by: {@link PrismaRunAuthoritySource}. Wired in by
 * `__CreatePrismaManagedSessionAssemblyAuthorities` and
 * `__CreatePrismaPersonalSessionAssemblyAuthorities` (prisma-session-assembly-authorities.ts).
 */
export interface RunAuthoritySource
{
	/**
	 * Loads the run, service, and revision facts needed to admit this run, and nothing more.
	 *
	 * @param command - The admission command; only its ids and identity kind are trusted.
	 * @param transaction - The admission transaction. Read through this, never through a root client,
	 * or the read will not see the locks admission is holding.
	 * @returns `loaded` with the facts every later source builds on. `denied` with
	 * `run_not_admittable` when the service is missing, inactive, or its kind does not match the
	 * caller's identity kind, or `revision_unavailable` when the active-revision pointer and the
	 * revision disagree. Either way the whole admission stops.
	 */
	load(command: SessionAssemblyCommand, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<InitialRunAuthority>>;
}

/**
 * Reads the persona a personal run may use.
 *
 * It reads the persona profile directly rather than going through the code that approves personas,
 * so an approval bug cannot also become an admission bug.
 *
 * Managed runs get no persona at all: their published revision already holds all their
 * instructions. `__AssembleRunInputSnapshot` checks that a personal run got one and a managed run
 * did not, and refuses with `persona_unavailable` if that does not hold.
 *
 * Implemented by: {@link PrismaApprovedPersonaSource}.
 */
export interface ApprovedPersonaSource
{
	/**
	 * Loads the active approved persona revision, or null for a managed service.
	 *
	 * @param command - The admission command; its subject must own the persona profile.
	 * @param run - Facts from {@link RunAuthoritySource}; `agentKind` decides whether a persona is
	 * required at all.
	 * @param transaction - The admission transaction.
	 * @returns `loaded` with `personaRevisionId` set for a personal run, or null for a managed run.
	 * `denied` with `persona_unavailable` when the caller is not the profile's owner, or the active
	 * revision is missing or not approved — an unapproved persona must never reach a saved run.
	 */
	load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<ApprovedPersonaInput>>;
}

/**
 * Reads the conversation's messages, in order, and freezes them into the snapshot.
 *
 * Only completed messages go in. A message still being written stays out, so the snapshot can
 * never name a message whose content later changes.
 *
 * This is also where the "one run at a time per conversation" rule is enforced: if another run on
 * this conversation has not finished, it refuses with `active_run`.
 *
 * Implemented by: {@link TransactionBoundConversationContextSource}, over
 * {@link ConversationContextRepository}.
 */
export interface ConversationContextSource
{
	/**
	 * Loads this run's message ids in transcript order.
	 *
	 * @param command - The admission command. A null `conversationId` means non-conversational work
	 * and returns an empty list without a lookup.
	 * @param run - Facts from {@link RunAuthoritySource}; the conversation must belong to this service.
	 * @param transaction - The admission transaction.
	 * @returns `loaded` with the message ids and the pending user message. `denied` with
	 * `conversation_unavailable` when the conversation is closed, the caller is not a participant, or
	 * their org membership is gone; or `active_run` when another unfinished run already owns this
	 * conversation — that one is worth retrying later, the others are not.
	 */
	load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<ConversationContextInput>>;
}

/**
 * Reads conversation rows for {@link ConversationContextSource}, bound to one transaction.
 *
 * Split out from the source so the source itself holds no database client: the transaction arrives
 * per call and a reader is built for it by {@link ConversationContextRepositoryFactory}. That is
 * what stops a conversation read from escaping the admission transaction.
 *
 * Implemented by: {@link PrismaConversationContextRepository}.
 */
export interface ConversationContextRepository
{
	/**
	 * Loads message ids in transcript order, using the transaction this reader was built for.
	 *
	 * @param command - The admission command.
	 * @param run - Facts from {@link RunAuthoritySource}.
	 * @returns The same outcomes as {@link ConversationContextSource.load}.
	 */
	load(command: SessionAssemblyCommand, run: InitialRunAuthority): Promise<SessionAssemblyLoad<ConversationContextInput>>;
}

/**
 * Builds a {@link ConversationContextRepository} for one admission transaction.
 *
 * Called once per admission, by {@link TransactionBoundConversationContextSource}. Keeping this a
 * factory is what lets the source be constructed at startup while every read still happens inside
 * the transaction that admission opened.
 *
 * @param transaction - The admission transaction to bind the reader to.
 * @returns A reader that reads only through that transaction.
 */
export interface ConversationContextRepositoryFactory
{
	(transaction: RunAdmissionTransaction): ConversationContextRepository;
}

/**
 * Reads the stored preference facts the execution subject has accepted.
 *
 * Ids only. Preference text never enters the snapshot, so nothing here widens what is stored in
 * Postgres about a user.
 *
 * It takes the already-verified `identity` rather than the command's subject, so a preference can
 * only ever be selected for the user whose signed membership was just checked.
 *
 * Implemented by: {@link PersonalMemoryPreferenceFactSource}. Managed admission substitutes an
 * inline source that always returns an empty list (prisma-session-assembly-authorities.ts).
 */
export interface PreferenceFactSource
{
	/**
	 * Loads the preference fact ids for the verified identity. An empty list is a normal result.
	 *
	 * @param command - The admission command.
	 * @param run - Facts from {@link RunAuthoritySource}.
	 * @param identity - Already-verified identity from {@link IdentityEnvelopeSource}. This, not the
	 * command, decides whose preferences may be read.
	 * @param transaction - The admission transaction.
	 * @returns `loaded` with zero or more ids. `denied` with `memory_scope_unavailable` when the run
	 * kind or identity kind is not one this source serves — that is a composition mistake, not
	 * something a user can fix by retrying.
	 */
	load(command: SessionAssemblyCommand, run: InitialRunAuthority, identity: IdentityEnvelopeInput, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<readonly PreferenceFactInput[]>>;
}

/** Reads authorised memory dataset scope. */
export interface MemoryScopeSource
{
	/**
	 * Loads the memory this run may use, choosing it from the verified identity and frozen conversation.
	 *
	 * @param command - The admission command.
	 * @param run - Facts from {@link RunAuthoritySource}.
	 * @param identity - Already-verified identity. The dataset is derived from this, never from caller
	 * input.
	 * @param conversation - The already-frozen transcript, used to build the recall query.
	 * @param transaction - The admission transaction.
	 * @returns `loaded` with the query policy and the fact references to freeze. `denied` with
	 * `memory_scope_unavailable` when this run kind or identity is not one this source serves, or
	 * `memory_unavailable` when the memory gateway failed — the second is safe to retry, and it
	 * deliberately fails the admission rather than freezing an empty fact set that would be
	 * indistinguishable from "this user has no memories".
	 */
	load(command: SessionAssemblyCommand, run: InitialRunAuthority, identity: IdentityEnvelopeInput, conversation: ConversationContextInput, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<MemoryScopeInput>>;
}

/**
 * Reads what the revision assigned — model, integration tools, skills, artifacts — keeping only
 * what the caller's grants also allow.
 *
 * It locks the policy rows before re-reading them, in the same order revocation locks them. That
 * ordering is what guarantees a revocation happening at the same moment either lands before this
 * read (and is seen) or after the snapshot commits, never half-way through.
 *
 * Implemented by: {@link PrismaRevisionToolPolicySource}.
 */
export interface ToolPolicySource
{
	/**
	 * Loads the model, tool, skill, and artifact inputs the runtime is allowed to use, and no others.
	 *
	 * @param command - The admission command; its silo bounds every row that may be returned.
	 * @param run - Facts from {@link RunAuthoritySource}.
	 * @param transaction - The admission transaction. The row locks are taken on it, so they are held
	 * until admission commits or rolls back.
	 * @returns `loaded` with the run's tool policy. `denied` with `tool_policy_unavailable` when the
	 * revision is no longer published, an integration is inactive, its custody reference has expired,
	 * a tool definition fails review, or an assigned skill or artifact is not a published revision in
	 * this silo. An operator has to fix the revision; retrying will not help.
	 */
	load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<ToolPolicyInput>>;
}

/** Serializes the MCP portion of one revision policy read inside run admission. */
export interface McpToolAdmissionClaimRepository
{
	/** Touch the stable claim row before the caller freezes exact MCP tool revisions. */
	touch(agentRevisionId: string, siloId: string, admittedAt: Date): Promise<void>;
}

/** Binds an MCP admission-claim repository to the exact run-admission transaction. */
export type McpToolAdmissionClaimRepositoryFactory = (transaction: RunAdmissionTransaction) => McpToolAdmissionClaimRepository;

/**
 * Re-checks every skill revision the tool policy named, just before the snapshot is saved.
 *
 * This is a second pass over ground {@link ToolPolicySource} already covered, on purpose: it locks
 * skills and then revisions in the same order revocation does, so a skill revoked while admission
 * is running cannot slip into a snapshot. It returns no value — it exists only to refuse.
 *
 * Implemented by: {@link PrismaSkillRevisionEligibilitySource}. Injected by the caller (see
 * `__CreateManagedRunAdmissionPort` and `__CreatePersonalRunAdmissionPort`).
 */
export interface SkillRevisionEligibilitySource
{
	/**
	 * Refuses the run when a named skill revision is not usable.
	 *
	 * @param command - The admission command; its silo is what "same silo" is checked against.
	 * @param run - Facts from {@link RunAuthoritySource}.
	 * @param toolPolicy - The skills {@link ToolPolicySource} produced. Naming fewer skills than the
	 * revision assigns is allowed; naming one it never assigned, or naming one twice, is not.
	 * @param transaction - The admission transaction; the locks are taken on it.
	 * @returns `loaded` with a null value, meaning "nothing to object to". `denied` with
	 * `skill_unavailable` when a named revision was duplicated, never assigned, revoked, from another
	 * silo, or not published.
	 */
	load(command: SessionAssemblyCommand, run: InitialRunAuthority, toolPolicy: ToolPolicyInput, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<null>>;
}

/**
 * Reads the run's resource limits: turn count, token count, and a wall-clock deadline.
 *
 * The deadline is computed from the server's admission time plus the revision's duration limit, so
 * a caller can never extend its own run by supplying one. Missing or malformed limits are refused
 * rather than defaulted — an unbudgeted run could burn tokens without bound.
 *
 * Implemented by: {@link PrismaRevisionBudgetPolicySource}.
 */
export interface BudgetPolicySource
{
	/**
	 * Loads the immutable budget policy chosen for this run.
	 *
	 * @param command - The admission command.
	 * @param run - Facts from {@link RunAuthoritySource}.
	 * @param transaction - The admission transaction; its admission time fixes the deadline.
	 * @returns `loaded` with the budget. `denied` with `budget_unavailable` when the revision is no
	 * longer published, or its budget is missing, malformed, or holds values that cannot be
	 * represented. An operator must fix the revision.
	 */
	load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<BudgetPolicyInput>>;
}

/**
 * Decides who the run executes as, and proves it inside the admission transaction.
 *
 * This runs before every identity-scoped source (preferences, memory) precisely so those sources
 * cannot select another organisation's data. It must derive the subject and organisation from
 * signed evidence in the database, never from anything the request body carried.
 *
 * For a user, that evidence is a signed fleet-membership assertion: a batch of memberships signed by
 * a trusted issuer and verified into local tables, keyed by the OIDC subject identifier Zitadel
 * issued. Admission checks a signature and a freshness window rather than calling the identity
 * provider per run.
 *
 * Two implementations: {@link PersonalExecutionIdentityEnvelopeSource} verifies a user's signed
 * fleet membership; {@link ManagedExecutionIdentityEnvelopeSource} adapts managed-service evidence.
 * Each refuses the other's run kind, and `__AssembleRunInputSnapshot` re-checks that the returned
 * identity kind matches the run kind afterwards.
 */
export interface IdentityEnvelopeSource
{
	/**
	 * Loads the capability and fleet-membership facts that decide who the runtime runs as.
	 *
	 * @param command - The admission command. Only the server-derived subject and silo are trusted.
	 * @param run - Facts from {@link RunAuthoritySource}; `agentKind` must match the identity kind
	 * this source produces.
	 * @param transaction - The admission transaction; membership is verified through it so the check
	 * and the snapshot see the same rows.
	 * @returns `loaded` with the identity and its capability digest. `denied` with `membership_stale`
	 * when signed membership is absent, does not verify, or its trust window has expired — the user
	 * must re-authenticate; or `identity_unavailable` when the identity does not match the run or a
	 * digest is invalid — fail the request, never fall back to a weaker identity.
	 */
	load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<IdentityEnvelopeInput>>;
}

/**
 * Every source {@link __AssembleRunInputSnapshot} needs, and the order it calls them in.
 *
 * The fields below are listed in call order, and that order is a safety property, not a style
 * choice: `runAuthority` first because everything else needs the run and revision;
 * `identityEnvelope` before `preferenceFacts` and `memoryScope` so no identity-scoped source can
 * read another organisation's data; `skillEligibility` last so its locks are the newest ones held
 * when the snapshot commits.
 *
 * Do not assemble this by hand. Use {@link __CreatePrismaManagedSessionAssemblyAuthorities} or
 * {@link __CreatePrismaPersonalSessionAssemblyAuthorities}: mixing a personal source into a
 * managed set (or the reverse) produces a run that every source refuses.
 */
export interface SessionAssemblyAuthorities
{
	/** Opens the admission transaction, deduplicates by idempotency key, and saves the run and snapshot. */
	admission: RunAdmissionRepository;
	/** Re-reads the run, service, and revision inside the transaction. Called first; everything else depends on it. */
	runAuthority: RunAuthoritySource;
	/** Reads the approved persona for a personal run, or null for a managed one. */
	approvedPersona: ApprovedPersonaSource;
	/** Freezes the conversation's completed messages in order, and rejects a second concurrent run. */
	conversationContext: ConversationContextSource;
	/** Reads the ids of preference facts the user accepted. Needs a verified identity first. */
	preferenceFacts: PreferenceFactSource;
	/** Decides which memory the run may use. Needs a verified identity and the frozen conversation first. */
	memoryScope: MemoryScopeSource;
	/** Reads the revision's model, integration tools, skills, and artifacts, under row locks. */
	toolPolicy: ToolPolicySource;
	/** Re-checks the named skill revisions last, so its locks are still held when the snapshot commits. */
	skillEligibility: SkillRevisionEligibilitySource;
	/** Reads the run's token, turn, and deadline limits. */
	budgetPolicy: BudgetPolicySource;
	/** Decides who the run executes as. Must run before the two identity-scoped sources above. */
	identityEnvelope: IdentityEnvelopeSource;
}
