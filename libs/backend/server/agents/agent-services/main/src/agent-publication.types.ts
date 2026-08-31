import type { AgentRevision, AgentRevisionId, AgentService, AgentServiceId, AgentServiceState, SiloId } from "@opencrane/models/agents";

/** Command that publishes one immutable agent revision as the service's active revision. */
export interface PublishAgentRevisionCommand
{
	/** Silo the caller is operating within; a service in another silo must not resolve. */
	readonly siloId: SiloId;
	/** Stable service whose active revision will change. */
	readonly agentServiceId: AgentServiceId;
	/** Draft immutable revision to publish. */
	readonly agentRevisionId: AgentRevisionId;
	/** Active revision observed by the caller, used for optimistic concurrency. */
	readonly expectedActiveRevisionId: AgentRevisionId | null;
	/** Trusted ISO-8601 publication instant. */
	readonly publishedAt: string;
}

/**
 * The publish request handed to the database once {@link __PublishAgentRevision} has confirmed the
 * service exists, is not retired, and owns a publishable draft.
 *
 * It carries two "as I last saw it" values — `expectedServiceState` and `expectedActiveRevisionId`.
 * The database re-checks both under a lock and refuses the write if either moved, which is what
 * stops two administrators from overwriting each other.
 */
export interface AtomicAgentRevisionPublication
{
	/** Stable service receiving the published revision. */
	readonly agentServiceId: AgentServiceId;
	/** Service lifecycle state observed before publication, required for the compare-and-swap. */
	readonly expectedServiceState: AgentServiceState;
	/** Draft revision being published. */
	readonly agentRevisionId: AgentRevisionId;
	/** Active revision required for the compare-and-swap. */
	readonly expectedActiveRevisionId: AgentRevisionId | null;
	/** Publication instant persisted on the immutable published projection. */
	readonly publishedAt: string;
}

/**
 * Outcome of the database step that publishes a revision and repoints the service at it.
 *
 * The two writes happen inside one transaction that first locks the service row, so the update only
 * lands if the service is still on the exact revision the caller said it had observed. That check is
 * the compare-and-swap: compare the stored active revision against the expected one, swap only on a
 * match.
 *
 * A publisher that loses the race gets `conflict` with `currentActiveRevisionId` — the revision the
 * winner just activated (null if the service has no active revision). Nothing was written for the
 * loser: its draft is still a draft and is still publishable. The fix is to re-read the service and
 * publish again with the new active revision as `expectedActiveRevisionId`, after checking that the
 * winner's revision has not made the change unnecessary.
 */
export type AtomicAgentRevisionPublicationResult =
	| { readonly status: "published"; readonly service: AgentService; readonly revision: AgentRevision }
	| { readonly status: "invalid_revision" }
	| { readonly status: "unauthorized" }
	| { readonly status: "conflict"; readonly currentActiveRevisionId: AgentRevisionId | null };

/**
 * Reads and publishes agent-service revisions.
 *
 * Both read methods are silo-scoped and return `null` for anything outside the caller's silo, so a
 * caller cannot tell a foreign service from a missing one. `publishRevisionAtomically` is the only
 * write, and it uses exact conditional writes so two administrators publishing at the same moment
 * cannot both succeed.
 *
 * Implemented by: `PrismaAgentServicePublicationUnitOfWork` in `db/prisma-agent-publication.ts`.
 * Called by: {@link __PublishAgentRevision} in `agent-publication.ts`; a caller-attributed instance
 * is built per request by `_publicationFor` in `prisma-agent-services.router.ts` so central
 * admission records the real administrator.
 */
export interface AgentServicePublicationRepository
{
	/** Loads one stable service identity scoped to the caller's silo, or null. */
	getService(agentServiceId: AgentServiceId, siloId: SiloId): Promise<AgentService | null>;
	/** Loads one immutable revision whose parent service is in the caller's silo, or null. */
	getRevision(agentRevisionId: AgentRevisionId, siloId: SiloId): Promise<AgentRevision | null>;
	/**
	 * Marks the draft published and points the service at it, in one transaction.
	 *
		 * The implementation conditionally claims the exact service state, then the exact draft. It
		 * re-checks the service state, the
	 * active revision, the revision's parent service, and that the revision is still a draft. Any
	 * mismatch aborts with `conflict` and writes nothing. Central admission evidence is recorded in
	 * the same transaction before either publication write.
	 *
	 * @param publication - The service, the draft, and the two values that must still match: the
	 *   observed service state and the observed active revision.
	 * @returns `published` with the updated service and revision, or `conflict` with the active
	 *   revision as it is now.
	 * @throws Whatever the database layer throws when the transaction itself fails. The router turns
	 *   that into a 500; it is not a `conflict`.
	 */
	publishRevisionAtomically(publication: AtomicAgentRevisionPublication): Promise<AtomicAgentRevisionPublicationResult>;
}

/**
 * Why a publish attempt changed nothing.
 *
 * The strings are stable because the router upper-cases them into the response `code`.
 * - `invalid_command` (400): an id was empty or `publishedAt` was not a parseable date.
 * - `service_not_found` (404): no such service in the caller's silo (a foreign-silo service also
 *   reads as not-found, so it cannot be probed).
 * - `service_retired` (409): the service is retired and accepts no more publications.
 * - `revision_not_found` (404): no such revision in the caller's silo.
 * - `revision_service_mismatch` (409): that revision belongs to a different service in this silo.
 * - `revision_not_draft` (409): the revision was already published (or rejected/retired). Publish is
 *   a one-way step per revision; make a new draft instead.
 * - `invalid_revision` (422): the stored revision fails its own checks — a non-positive budget
 *   ceiling, a malformed tool definition, or a digest that no longer matches its content. This means
 *   the row was tampered with or written by an older, incompatible writer; do not retry, investigate.
 * - `publication_conflict` (409): another publisher won the race. See
 *   {@link PublishAgentRevisionResult} for what to do next.
 */
export type PublishAgentRevisionFailureReason =
	| "invalid_command"
	| "unauthorized"
	| "service_not_found"
	| "service_retired"
	| "revision_not_found"
	| "revision_service_mismatch"
	| "revision_not_draft"
	| "invalid_revision"
	| "publication_conflict";

/**
 * Outcome of a publish request. `currentActiveRevisionId` is present only when `reason` is
 * `publication_conflict`, and then it is the revision the winning publisher activated.
 */
export type PublishAgentRevisionResult =
	| { readonly outcome: "published"; readonly service: AgentService; readonly revision: AgentRevision }
	| { readonly outcome: "denied"; readonly reason: PublishAgentRevisionFailureReason; readonly currentActiveRevisionId?: AgentRevisionId | null };
