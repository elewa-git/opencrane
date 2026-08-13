import type { AgentThreadDeliveryKinds } from "@opencrane/contracts";

/**
 * Names the shapes used when a group message opens a child Agent thread.
 *
 * An Agent thread is a separate `agent_session` conversation created from one authorised `@agent`
 * message in a group. The mention itself stays an ordinary group message; the child gets its own
 * history, participants, cursors, unread position and lifecycle, and its first run is admitted in
 * the same transaction that creates the child. Two things are visible from the parent side: a short
 * summary under the message that started the thread, and append-only deliveries the child sends up.
 *
 * It is not a run, and not a view of the parent. A child never rewrites parent history, never posts
 * as a participant, and never delivers past its immediate parent. Runtime subagents are child *runs*
 * and remain a separate concept.
 *
 * Nothing here reads HTTP, Prisma or browser state. The types are the words the server-side
 * conversation authority and the projection engine share.
 *
 * @see docs/adr/0012-conversation-modes-and-agent-thread-authority.md — the decision these shapes implement.
 * @see docs/user-stories/workspace-and-conversations.md — story CON-09, the behaviour a participant sees.
 */

/**
 * Names the parent-timeline entry that carries one delivery sent up from a child Agent thread.
 *
 * A parent conversation's timeline mixes participant messages, run-backed projections, membership
 * events and these deliveries, and the reader tells them apart by this `type` string.
 * `PrismaConversationReplayRepository` stamps it on every replayed delivery row, and
 * `__ProjectConversationEvent` switches on it to decide which payload fields a browser may see.
 *
 * The string is not stored in a column — the reader derives it from the delivery row it just read —
 * but it does reach browsers, so renaming a member breaks API clients while needing no migration.
 * The projector's switch has no default arm that forwards unknown values: an event type it does not
 * recognise loses its whole payload, so adding a member here without teaching the projector about it
 * silently empties the event.
 *
 * @see AgentThreadParentDelivery for the row this event type is derived from.
 */
export enum AgentThreadEventTypes
{
	/**
	 * A child Agent thread appended one delivery to this parent's timeline. The payload carries
	 * `id`, `childConversationId`, `kind`, `label`, `detail` and `assetId`, and nothing else survives
	 * projection. It reports what the child did; it grants no access to the child.
	 */
	ParentDelivery = "conversation.agent_thread.parent_delivery",
}

/**
 * Says what a parent conversation shows under the message that opened an Agent thread.
 *
 * One of these values drives the single status line a group participant reads without opening the
 * child: whether the Agent has started, is working, is stuck waiting on them, or has finished. It is
 * worked out when the summary is read, from the child conversation's lifecycle and its latest run,
 * and is not stored as a column of its own — ADR 0012 refuses a stored value that merges the run,
 * conversation, access and admission state machines into one.
 *
 * No server code produces these values yet; the browser store carries its own
 * `AgentThreadSummaryStates` in `@opencrane/state/conversation/agent-threads` with the same eight
 * strings plus `completed_after_retry`, `restricted`, `creation_failed` and `reconnecting`. The two
 * sets must keep identical spellings, and the browser set being larger means a reader here must
 * treat an unrecognised value as none of the eight below rather than as a default.
 *
 * Only `Closed` is terminal. A child conversation's lifecycle moves one way — open, then closed —
 * and nothing reopens it, so every other value can still change on the next read.
 *
 * @see AgentThreadSummary for the payload these values arrive in.
 */
export enum AgentThreadSummaryStates
{
	/** The first run exists and is queued or accepted, but no runtime work has been reported yet. A reader should expect movement without acting. */
	Starting = "starting",
	/** The child's foreground run is executing. A follow-up ask is still allowed but will queue behind this run rather than interrupt it. */
	Working = "working",
	/** The run has stopped on a question or an approval and will not move until a participant answers inside the child. This is the one state that asks the reader to do something. */
	Waiting = "waiting",
	/** An attempt failed and another attempt is still expected. Do not report the thread as failed while this holds. */
	Retrying = "retrying",
	/** The latest run finished its work. The child stays open, so a participant may still ask a follow-up, which starts another run. */
	Completed = "completed",
	/** The latest run ended without finishing and no further attempt is expected. The child is still open, so a follow-up ask is the way forward. */
	Failed = "failed",
	/** The latest run was cancelled, so nothing more will come from it. The child remains open for a follow-up. */
	Cancelled = "cancelled",
	/** The child conversation is closed. Terminal: no run can be admitted into it again and the summary will not change. */
	Closed = "closed",
}

/**
 * Says which Agent a group participant asked for when they sent an `@agent` message.
 *
 * The presence of this on a submitted message is what turns an ordinary group message into an
 * Agent-thread admission — `PrismaConversationMessageAdmissionUnitOfWork` reads it to choose between
 * appending a plain message and creating a child conversation, and refuses the command outright when
 * an Agent thread is asked for without it. A direct or agent-session conversation must not carry one.
 *
 * Used by: `SubmitConversationMessageRequest.agentTarget`
 * (server/conversations/main/src/conversation-authority.types.ts) and checked without I/O by
 * {@link AgentThreadTargetDecision}.
 */
export interface AgentThreadTarget
{
	/**
	 * The AgentService the participant chose. It must be their own active personal service: before
	 * anything is written, `prepareAgentThread` re-reads the row in the caller's silo and requires
	 * kind `Personal`, state `Active` and a non-null active revision.
	 */
	readonly agentServiceId: string;
}

/**
 * Records where a child Agent thread came from, written once and never updated.
 *
 * `PrismaConversationMessageAdmissionUnitOfWork` fills this in after the first run is compiled, and
 * `persistAgentThread` inserts it as the `conversationAgentThread` row in the same transaction that
 * created the child, its participants, the parent message and the run. So a thread either has a
 * complete origin or does not exist. Readers use it for two things: the breadcrumb back to the group
 * and the message the thread hangs under, and the proof of which Agent and persona the work ran as.
 *
 * Every field is fixed at creation. A later run in the child reuses the same AgentService, so a
 * changed persona or a different service means a new thread, not an edit here.
 */
export interface AgentThreadOrigin
{
	/** The child `agent_session` conversation this origin describes. */
	readonly childConversationId: string;
	/** The group conversation the mention was sent in, and the only conversation the child may deliver up to. */
	readonly parentConversationId: string;
	/** The conversation the breadcrumb trail starts at. Set to the immediate parent today, because only a group can open a thread; it would differ once a thread can be opened inside a thread. */
	readonly rootConversationId: string;
	/** The ordinary group message that asked for the Agent. The parent summary is shown under this message, and returning from the child scrolls back to it. */
	readonly parentMessageId: string;
	/** The participant who sent the mention. Their approved persona is what the thread runs as, no matter who else reads or replies in the child. */
	readonly initiatorUserId: string;
	/** The personal AgentService every run in this child uses. */
	readonly agentServiceId: string;
	/** The approved persona revision frozen while the first run was admitted. Kept so a later persona change cannot rewrite what this thread already ran as. */
	readonly personaRevisionId: string;
	/** The run admitted together with the child. It answers the mention itself; later asks add further runs. */
	readonly firstRunId: string;
}

/**
 * One update a child Agent thread sent up to the group it came from.
 *
 * This is how work inside a child becomes visible in the group without exposing the child's
 * transcript: the runtime sends a short label and detail it has already sanitised, the server proves
 * the sender owns the run, and the row is appended to the parent's timeline. Appends are the only
 * operation — a delivery cannot edit or delete parent history, cannot be posted as a participant,
 * and cannot be sent to anything but the immediate parent.
 *
 * Written by `PrismaAgentThreadParentDeliveryUnitOfWork` and read back by
 * `PrismaConversationQueryRepository`, both in server/conversations/main. What a browser finally sees
 * is narrower than this: `__ProjectConversationEvent` copies `id`, `childConversationId`, `kind`,
 * `label`, `detail` and `assetId` and drops every other field, so an unsanitised field added to the
 * payload would be discarded rather than delivered.
 *
 * @see AgentThreadDeliveryKinds for the categories a delivery may claim.
 */
export interface AgentThreadParentDelivery
{
	/** Identifier of the delivery row, generated by the server. It is not the idempotency key: a repeat delivery is recognised by the child conversation plus the runtime's own key, which this shape does not carry. */
	readonly id: string;
	/** The child that sent the delivery. A parent reader uses it to group deliveries by thread. */
	readonly childConversationId: string;
	/** The parent that receives it. The server reads this from the thread's origin row rather than trusting the sender, which is what stops a delivery reaching a grandparent. */
	readonly parentConversationId: string;
	/** The run that produced the delivery. Only a registered pod on the run's current attempt may send one. */
	readonly runId: string;
	/** Which sort of update this is, which is what a parent reader styles and filters on. */
	readonly kind: AgentThreadDeliveryKinds;
	/** Short heading shown in the parent timeline. Non-blank, at most 160 characters. */
	readonly label: string;
	/** Longer text shown under the label. Non-blank, at most 4000 characters, and already stripped of provider bodies, secrets, proofs and raw tool arguments before it reaches this shape. */
	readonly detail: string;
	/** The asset being handed to the group, or null. Required exactly when `kind` is `Asset` and rejected otherwise, so an asset delivery can never arrive without the asset. */
	readonly assetId: string | null;
	/** When the server appended the row, as an ISO 8601 string. Ordering in the parent timeline comes from the timeline position, not from this value. */
	readonly createdAt: string;
}

/**
 * The short status line a group sees under the message that opened an Agent thread.
 *
 * It answers "what is my Agent doing?" without opening the child: a state, how much has happened,
 * how much of that the reader has not seen, and a preview of the last delivery. Counts and the
 * preview are the only content that crosses back into the group.
 *
 * No server code builds this yet; the browser presents an equivalent shape of its own. Treat it as
 * the agreed wording for the parent projection rather than as something already produced.
 */
export interface AgentThreadSummary
{
	/** The child the summary is about, and what a reader opens to see the full thread. */
	readonly childConversationId: string;
	/** The group message the summary belongs under. */
	readonly parentMessageId: string;
	/** What the thread is doing now. Only `Closed` is final. */
	readonly state: AgentThreadSummaryStates;
	/** How many child timeline entries followed the opening ask. It is the size of the thread, not a count of unseen items. */
	readonly updateCount: number;
	/** How many of those entries are past this reader's own read position. It differs per participant, so it cannot be cached for the group. */
	readonly unreadCount: number;
	/** A trimmed preview of the newest delivery, or null when there is nothing safe to show yet. */
	readonly preview: string | null;
	/** When the thread last moved, as an ISO 8601 string. */
	readonly updatedAt: string;
}

/**
 * Says whether an Agent target is well-formed enough to act on.
 *
 * The refusing arm has no field for a reason, so a caller cannot tell which check failed and can only
 * map it to one refusal. `allowed: true` means the shape passed; it says nothing about whether the
 * service exists, belongs to the caller, or is active, all of which are re-checked against the database
 * afterwards.
 *
 * @see __DecideAgentThreadTarget — the check that returns this.
 */
export type AgentThreadTargetDecision = { readonly allowed: true } | { readonly allowed: false };
