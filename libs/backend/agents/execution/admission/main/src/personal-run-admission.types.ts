import type { AssembleRunInputSnapshotResult, SessionAssemblyRefusalReason } from "@opencrane/backend/agents/execution/inputs";
import type { Logger } from "@opencrane/backend/observability";
import type { RunAdmissionCommit, RunAdmissionConcurrencyDenialReasons, RunAdmissionPrepare } from "@opencrane/backend/agents/execution/runs";
import type { MessageContentBlock } from "@opencrane/models/conversations";
import type { RunAdmissionCapacityGate } from "./managed-run-admission.types.js";

/** What the server knows about a personal run request once the browser session is authenticated. */
export interface PersonalRunAdmissionCommand
{
	/** ClusterTenant silo selected from the authenticated request host. */
	readonly siloId: string;
	/**
	 * The OIDC subject identifier for the signed-in user, taken from the verified browser session.
	 *
	 * Issued by Zitadel and already verified before this command is built. Never read it from a request
	 * body: run admission treats this field as proof of who is asking, and later verifies the same
	 * subject against signed fleet membership.
	 */
	readonly executionSubjectId: string;
	/** Existing conversation the caller asked the server to continue. */
	readonly conversationId: string;
	/** Key the caller sends, unique within the conversation, so a retry returns the first run's snapshot. */
	readonly requestIdempotencyKey: string;
	/** Server-allocated message that must be committed with the admitted run. */
	readonly inputMessageId: string;
	/** The message's checked content, held until admission can save the message together with the run. */
	readonly inputMessageBlocks: readonly MessageContentBlock[];
}

/** What the preflight read worked out from the conversation, before the capacity gate is entered. */
export interface PersonalRunConversationAuthority
{
	/** The personal AgentService the caller's conversation belongs to. */
	readonly agentServiceId: string;
}

/**
 * The three reads personal admission makes outside the assembly transaction.
 *
 * All three are read-only and none of them grants access. `resolveConversation` in particular is
 * only used to learn which AgentService the capacity gate should queue against — session assembly
 * re-reads the same conversation inside its own transaction and refuses there if the caller's
 * access has since ended. So a stale result here can cost a queue slot, never authorisation.
 *
 * Implemented by: {@link PrismaPersonalRunAdmissionRepository} (bound to one transaction) and
 * {@link PrismaPersonalRunAdmissionUnitOfWork} (opens a transaction per call, and is what
 * `__CreatePersonalRunAdmissionPort` injects).
 */
export interface PersonalRunAdmissionRepository
{
	/**
	 * Reports whether this idempotency key was already used, leaving any existing snapshot untouched.
	 *
	 * @param command - The admission command, with its key already scoped to the conversation.
	 * @returns `NotFound` to continue, `Idempotent` with the original `runId` to return that run, or
	 * `Conflict` when the key belongs to a different subject, trigger, or conversation. See
	 * {@link PersonalRunIdempotencyOutcomes}.
	 */
	resolve(command: PersonalRunAdmissionCommand): Promise<PersonalRunIdempotencyResult>;
	/**
	 * Finds the personal AgentService for the caller's conversation, in their silo.
	 *
	 * @param command - The admission command.
	 * @returns The service, or null when the conversation is not an open personal agent session the
	 * caller participates in. Null means refuse — never fall back to another service.
	 */
	resolveConversation(command: PersonalRunAdmissionCommand): Promise<PersonalRunConversationAuthority | null>;
	/**
	 * Reports whether the caller's conversation already has a run that has not finished.
	 *
	 * Called only after a commit failed, to tell "the database is unhealthy" apart from "another run
	 * got there first" — those two need different replies, and the failed commit alone cannot
	 * distinguish them.
	 *
	 * @param command - The admission command.
	 * @returns True when an unfinished run already owns the conversation.
	 * @throws May throw; the caller wraps it and falls back to the original failure rather than losing
	 * the real error.
	 */
	hasActiveConversationRun(command: PersonalRunAdmissionCommand): Promise<boolean>;
}

/** The same reads as above, but bound to one transaction. Only the Unit of Work creates it. */
export interface PersonalRunAdmissionReadRepository extends PersonalRunAdmissionRepository
{
}

/** Opens the transaction those reads run in. */
export interface PersonalRunAdmissionUnitOfWork extends PersonalRunAdmissionRepository
{
}

/**
 * What the idempotency-key lookup can find. Checked before the conversation itself is.
 *
 * Ordering matters: a duplicate is answered without ever looking at the conversation, so a repeated
 * request still returns its original run even if the conversation has since closed.
 */
export enum PersonalRunIdempotencyOutcomes
{
	/** No run has used this key in this silo yet. Carry on with admission. */
	NotFound = "not_found",
	/** This key already has a saved snapshot. Return that run; do not admit a new one. */
	Idempotent = "idempotent",
	/**
	 * A run holds this key, but for a different subject, trigger, or conversation.
	 *
	 * Refuse. Reusing it would let one caller's key point at another's run.
	 */
	Conflict = "conflict",
}

/** Result of checking the durable caller idempotency key. */
export type PersonalRunIdempotencyResult =
	| { readonly outcome: PersonalRunIdempotencyOutcomes.NotFound }
	| { readonly outcome: PersonalRunIdempotencyOutcomes.Idempotent; readonly runId: string }
	| { readonly outcome: PersonalRunIdempotencyOutcomes.Conflict };

/** Assembles the snapshot. Called only after the shared capacity gate grants a slot. */
export interface PersonalRunSnapshotAssembler
{
	/** Assembles and persists the immutable input snapshot for an already-resolved personal conversation. */
	(command: PersonalRunAdmissionCommand, authority: PersonalRunConversationAuthority, commit?: RunAdmissionCommit, prepare?: RunAdmissionPrepare): Promise<AssembleRunInputSnapshotResult>;
}

/**
 * What {@link PersonalRunAdmissionPort.admitPersonalRun} can return.
 *
 * `Accepted` and `Idempotent` are both successes and both carry a `runId`, but they are not
 * interchangeable: only `Accepted` means this call created the run. A caller that collapses them
 * reports a fresh start for a run that was already admitted, and the user sees their message
 * answered twice.
 *
 * Consumed by: `PrismaConversationUnitOfWork`
 * (libs/backend/server/conversations/main/src/prisma-conversation-unit-of-work.ts), which maps
 * `Idempotent` onto a duplicate-message reply and `Denied` through `_runAdmissionDenial`.
 */
export enum PersonalRunAdmissionOutcomes
{
	/**
	 * This call created the run and saved its snapshot and dispatch intent.
	 *
	 * The caller owns telling the user their run has started.
	 */
	Accepted = "accepted",
	/**
	 * This idempotency key was already used; `runId` is the original run.
	 *
	 * Nothing was written. Reply as success, but do not treat this as a new run.
	 */
	Idempotent = "idempotent",
	/**
	 * Nothing was admitted. Read `reason` to decide what to do.
	 *
	 * Only `persistence_unavailable` and a capacity rejection are safe to retry unchanged; see
	 * {@link PersonalRunAdmissionDenialReason}.
	 */
	Denied = "denied",
}

/**
 * Refusals this package produces itself, during the read-only preflight, before session assembly
 * runs at all.
 *
 * They exist separately from {@link SessionAssemblyRefusalReason} because the preflight is cheap and
 * happens outside the assembly transaction: it can turn a duplicate request away without opening a
 * serializable transaction at all.
 *
 * Consumed by: `_runAdmissionDenial`
 * (libs/backend/server/conversations/main/src/prisma-conversation-unit-of-work.ts), which maps
 * `AuthorityConflict` onto an idempotency conflict and `ConversationUnavailable` onto a
 * conversation-unavailable reply.
 */
export enum PersonalRunAdmissionDenialReasons
{
	/**
	 * The caller reused an idempotency key that belongs to a different subject, trigger, or
	 * conversation.
	 *
	 * Do not retry with this key. The caller must send a new one, or accept that the original request
	 * is what that key refers to.
	 */
	AuthorityConflict = "authority_conflict",
	/**
	 * The caller is not a participant in an open personal conversation.
	 *
	 * Either the conversation closed, their access ended, or it is not a personal agent session.
	 * Retrying unchanged will not help.
	 */
	ConversationUnavailable = "conversation_unavailable",
	/**
	 * The admission transaction could not complete and produced no classifiable result.
	 *
	 * Safe to retry with the SAME idempotency key: if the earlier attempt did in fact commit, the retry
	 * comes back `Idempotent` instead of creating a second run.
	 */
	PersistenceUnavailable = "persistence_unavailable",
}

/** Every reason personal run admission can return, from this package and from the layers below. */
export type PersonalRunAdmissionDenialReason = PersonalRunAdmissionDenialReasons | RunAdmissionConcurrencyDenialReasons | SessionAssemblyRefusalReason;

/** What the personal run admission port returns. It keeps internal detail out. */
export type PersonalRunAdmissionResult =
	| { readonly outcome: PersonalRunAdmissionOutcomes.Accepted | PersonalRunAdmissionOutcomes.Idempotent; readonly runId: string }
	| { readonly outcome: PersonalRunAdmissionOutcomes.Denied; readonly reason: PersonalRunAdmissionDenialReason };

/**
 * Starts a user's personal run on a conversation they are already in.
 *
 * This is the boundary the HTTP layer calls. It knows nothing about HTTP itself: the caller must
 * have already authenticated the browser session and derived the silo from the request host, and it
 * passes only ids in. Nothing in {@link PersonalRunAdmissionCommand} may come from a request body
 * except the message content and the idempotency key.
 *
 * Called by: `PrismaConversationUnitOfWork`
 * (libs/backend/server/conversations/main/src/prisma-conversation-unit-of-work.ts), reached through
 * `_CreateSelfConversationsRouter` in the same package. Built by
 * {@link __CreatePersonalRunAdmissionPort} and wired in at apps/opencrane/src/index.ts.
 *
 * @see PersonalRunAdmissionResult
 */
export interface PersonalRunAdmissionPort
{
	/**
	 * Resolves the caller's conversation and admits one run through the shared capacity gate.
	 *
	 * @param command - Server-derived ids plus the user's message. Retrying with the same
	 * `requestIdempotencyKey` returns the original run rather than starting a second one.
	 * @param commit - Optional extra write to make in the same transaction as the run. The conversation
	 * caller uses this to persist the user's message atomically with the run, so a saved message can
	 * never exist without its run.
	 * @returns `Accepted` with the new run's id, `Idempotent` with the original run's id, or `Denied`
	 * with a reason. Treating `Idempotent` as `Accepted` starts a second runtime for one run; see
	 * {@link PersonalRunAdmissionResult}.
	 */
	admitPersonalRun(command: PersonalRunAdmissionCommand, commit?: RunAdmissionCommit): Promise<PersonalRunAdmissionResult>;
	/** Creates authority in the admission transaction before compiling one child Agent-thread run. */
	admitFirstAgentThreadRun(command: PersonalRunAdmissionCommand, agentServiceId: string, prepare: RunAdmissionPrepare, commit: RunAdmissionCommit): Promise<PersonalRunAdmissionResult>;
}

/**
 * What {@link __CreatePersonalRunAdmissionPortWithGate} needs. It reads no HTTP request and no
 * environment variable.
 *
 * Supplied by {@link __CreatePersonalRunAdmissionPort} in production, and by tests that replace one
 * field at a time.
 */
export interface PersonalRunAdmissionDependencies
{
	/** Reads the idempotency key and the caller's conversation. Used only after the preflight gate grants a slot. */
	readonly repository: PersonalRunAdmissionRepository;
	/** Assembles and saves the immutable snapshot, through the run admission repository. */
	readonly assemble: PersonalRunSnapshotAssembler;
	/** The one capacity gate for this process. Must be the same instance managed admission was given, or the process runs at double its ceiling. */
	readonly capacityGate: RunAdmissionCapacityGate;
	/** Logger for the one case that is logged here: the recovery read after a failed commit itself failing. */
	readonly logger: Logger;
}
