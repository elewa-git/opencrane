import type { AgentRevision, AgentRevisionContent, AgentRevisionDiff, AgentRevisionId, AgentRun, AgentService, AgentServiceId, AgentServiceState, SiloId } from "@opencrane/models/agents";

/** Command that creates one managed AgentService with its first draft revision. */
export interface CreateManagedAgentServiceCommand
{
	/** Silo that will own the service. */
	readonly siloId: SiloId;
	/** Human-readable service name. */
	readonly name: string;
	/** Runtime profile name the agent controller turns into a Kubernetes Job (image, limits, identity). Must be `MANAGED_AGENT_RUNTIME_PROFILE_NAME` — the only profile the controller can resolve. */
	readonly workloadProfile: string;
	/** Author of the first revision. */
	readonly authoredBy: string;
	/** Human-authored explanation of the initial revision. */
	readonly changeMessage: string;
	/** Executable content of the first draft revision. */
	readonly content: AgentRevisionContent;
}

/** Request to add a new draft revision on top of the newest one. Carries the revision the author edited so a concurrent append is rejected rather than overwritten. */
export interface ReviseAgentRevisionCommand
{
	/** Silo the caller is operating within; a service in another silo must not resolve. */
	readonly siloId: SiloId;
	/** Service being revised. */
	readonly agentServiceId: AgentServiceId;
	/** Revision the author based the edit on, for optimistic concurrency. */
	readonly expectedParentRevisionId: AgentRevisionId | null;
	/** Author of the new revision. */
	readonly authoredBy: string;
	/** Human-authored explanation of the change. */
	readonly changeMessage: string;
	/** Executable content of the new draft revision. */
	readonly content: AgentRevisionContent;
}

/** Command that restores an older revision by cloning it into a new draft revision. */
export interface RestoreAgentRevisionCommand
{
	/** Silo the caller is operating within; a service in another silo must not resolve. */
	readonly siloId: SiloId;
	/** Service being restored. */
	readonly agentServiceId: AgentServiceId;
	/** Older revision whose content is cloned; recorded as the source revision. */
	readonly sourceRevisionId: AgentRevisionId;
	/** Revision the author based the restore on, for optimistic concurrency. */
	readonly expectedParentRevisionId: AgentRevisionId | null;
	/** Author of the restore revision. */
	readonly authoredBy: string;
	/** Human-authored explanation of the restore. */
	readonly changeMessage: string;
}

/** The three state changes a service supports: `enable` → active, `pause` → paused, `retire` → retired. Retiring also clears the active revision and cannot be undone. */
export type AgentServiceLifecycleAction = "enable" | "pause" | "retire";

/** Command that changes a stable AgentService state with optimistic concurrency. */
export interface ChangeAgentServiceStateCommand
{
	/** Silo the caller is operating within; a service in another silo must not resolve. */
	readonly siloId: SiloId;
	/** Service whose state is changing. */
	readonly agentServiceId: AgentServiceId;
	/** State the caller observed, for optimistic concurrency. */
	readonly expectedState: AgentServiceState;
	/** Lifecycle action requested. */
	readonly action: AgentServiceLifecycleAction;
}

/**
 * Who asked for the run: `managed_invocation` for a person pressing run-now, `schedule` for a cron
 * slot coming due. Recorded on the run row so history can tell the two apart.
 */
export type ManagedRunTrigger = "managed_invocation" | "schedule";

/**
 * What happened when a run-now or scheduled-slot request was recorded.
 *
 * The strings are stable because both the browser and the scheduler compare against them.
 * `Accepted` and `Idempotent` are both successes and both carry a run id — the difference is only
 * whether this call created the row. Treating `Idempotent` as a failure is the usual mistake: it
 * means the same `requestIdempotencyKey` already produced a run, which is exactly what a retried
 * POST or two schedulers racing on the same cron slot should produce. The router answers 202 for
 * `Accepted` and 200 for `Idempotent`.
 *
 * These values report an outcome; they do not themselves authorise anything. The admission checks in
 * {@link __AdmitManagedRunNow} and the run-input assembler decide that.
 *
 * Called by: `libs/backend/agents/execution/admission/main/src/managed-run-admission.ts` produces
 * them; `libs/backend/server/agents/scheduling/main/src/schedule-tick.ts` and the run-now handler in
 * `agent-revision.router.ts` branch on them.
 * @see {@link ManagedRunAdmissionResult} for the payload attached to each outcome.
 */
export enum ManagedRunAdmissionOutcomes
{
	/** This call created the run row. The router answers 202 with the new run id. */
	Accepted = "accepted",
	/** This key already created a run; the same run id comes back. Success, not a duplicate error. */
	Idempotent = "idempotent",
	/** No run was created; `reason` carries one {@link AgentRevisionLifecycleDenial} value. */
	Denied = "denied",
}

/** Command that records one managed run admission request. */
export interface ManagedRunNowCommand
{
	/** Service to run. */
	readonly agentServiceId: AgentServiceId;
	/** Silo containing the service and durable run. */
	readonly siloId: SiloId;
	/** Subject requesting the run (a human for run-now, the scheduler identity for a schedule). */
	readonly requestedBy: string;
	/** User-visible key making duplicate delivery return the first admission. */
	readonly requestIdempotencyKey: string;
	/**
	 * Trigger recorded on the admitted run. `managed_invocation` for an explicit run-now;
	 * `schedule` for a due schedule slot. The admission adapter maps this to the durable
	 * `AgentRunTrigger`; it never opens a second run-creation path.
	 */
	readonly trigger: ManagedRunTrigger;
	/**
	 * Exact ISO-8601 scheduled-slot instant for a `schedule` trigger, or null for run-now. Carried
	 * so the admission audit can attribute a run to its cron slot; the idempotency key already
	 * encodes it, so it is descriptive rather than an independent dedup key.
	 */
	readonly scheduledSlot: string | null;
}

/**
 * Why a managed-agent lifecycle or run command was refused.
 *
 * These strings are stable: the router upper-cases the value into the response `code`, and
 * {@link https://www.rfc-editor.org/rfc/rfc6648 RFC 6648} style renaming would break clients. Two
 * groups produce them. The definition-plane use cases in `agent-revision-lifecycle.ts` produce the
 * first nine; the rest come back through {@link ManagedRunAdmissionPort} from the run-input
 * assembler (`SessionAssemblyRefusalReason` in
 * libs/backend/agents/execution/inputs/main/src/session-assembly-result.types.ts) and the capacity
 * gate (`RunAdmissionConcurrencyDenialReasons` in
 * libs/backend/agents/execution/runs/main/src/run-admission-concurrency.types.ts).
 *
 * What the caller must change, per value:
 * - `invalid_command` (400): a required field was empty, or the date was not parseable. Fix the body.
 * - `service_not_found` (404): no service with that id exists in the caller's silo. A service in
 *   another silo also reads as not-found on purpose, so nobody can probe for foreign services.
 * - `service_retired` (409): the service is retired. Nothing can be appended to it again.
 * - `revision_not_found` (404): no revision with that id exists in the caller's silo.
 * - `revision_service_mismatch` (409): the revision exists in this silo but belongs to a different
 *   service. Pass a revision of the service in the URL.
 * - `model_definition_unavailable` (422): `content.modelDefinitionId` is neither a Global model nor
 *   one owned by this silo. Pick a model the silo can actually route to.
 * - `transition_not_allowed` (409): the requested enable/pause/retire is illegal from the state the
 *   caller claims to have observed. Re-read the service and retry from its real state.
 * - `service_not_runnable` (409): the service is not Managed, is not Active, or has no published
 *   active revision. Publish a revision first, then enable the service.
 * - `run_not_admittable` (409): the run's active published revision could not be re-read at
 *   admission time. Re-read the service; its active revision probably moved.
 * - `revision_unavailable`, `persona_unavailable`, `conversation_unavailable`,
 *   `memory_unavailable`, `tool_policy_unavailable`, `skill_unavailable`, `budget_unavailable`,
 *   `identity_unavailable` (409): one input the run needs could not be assembled. These are
 *   configuration problems, not transient ones — fix the revision, do not retry the same request.
 * - `memory_scope_unavailable` (409): a scope attachment on the revision is not backed by a real
 *   grant, or a managed service attached a `personal` scope (never allowed). Remove the attachment
 *   or grant the scope.
 * - `membership_stale` (503): the signed fleet-membership evidence for the agent principal is
 *   missing or older than the configured limit. Retry after the issuer republishes.
 * - `persistence_unavailable` (503): a database write failed with no safe outcome to report. Retry.
 * - `authority_conflict` (409): a row with the same idempotency key belongs to a different silo,
 *   service, or revision. Use a fresh key.
 * - `admission_concurrency_limited` (503 with `Retry-After: 1`): the admission queue is full. Retry.
 *
 * `membership_stale`, `admission_concurrency_limited`, `persistence_unavailable`, and
 * `authority_conflict` are the four the scheduler treats as worth retrying (`_RETRYABLE_DENIALS` in
 * libs/backend/server/agents/scheduling/main/src/schedule-tick.ts); every other value makes the
 * scheduler record the slot and move on, so a broken revision cannot wedge a schedule forever.
 *
 * Called by: `_denialStatus` and `_runDenialStatus` in `agent-revision.router.ts` map these to HTTP
 * status codes; `_RETRYABLE_DENIALS` in libs/backend/server/agents/scheduling/main/src/schedule-tick.ts
 * decides retry-versus-drop.
 * @see {@link ManagedRunAdmissionResult} for how a denial is returned to a run-now caller.
 */
export type AgentRevisionLifecycleDenial =
	| "invalid_command"
	| "service_not_found"
	| "service_retired"
	| "revision_not_found"
	| "revision_service_mismatch"
	| "model_definition_unavailable"
	| "transition_not_allowed"
	| "service_not_runnable"
	| "run_not_admittable"
	| "revision_unavailable"
	| "persona_unavailable"
	| "conversation_unavailable"
	| "memory_scope_unavailable"
	| "memory_unavailable"
	| "tool_policy_unavailable"
	| "skill_unavailable"
	| "budget_unavailable"
	| "membership_stale"
	| "identity_unavailable"
	| "persistence_unavailable"
	| "authority_conflict"
	| "admission_concurrency_limited";

/** Outcome of creating a managed service: the new service plus its first draft revision, or a refusal with a {@link AgentRevisionLifecycleDenial} reason. */
export type CreateManagedAgentServiceResult =
	| { readonly outcome: "created"; readonly service: AgentService; readonly revision: AgentRevision }
	| { readonly outcome: "denied"; readonly reason: AgentRevisionLifecycleDenial };

/**
 * Outcome of appending a revision through revise or restore.
 *
 * `conflict` means another author appended first: `currentHeadRevisionId` is the newest revision now
 * stored (null if the service somehow has none). The caller must re-read that revision, re-apply its
 * edit on top of it, and send the request again with that id as `expectedParentRevisionId`. Nothing
 * was written, so retrying with the old id will just conflict again. The router maps this to 409.
 */
export type AppendAgentRevisionResult =
	| { readonly outcome: "revised"; readonly revision: AgentRevision }
	| { readonly outcome: "conflict"; readonly currentHeadRevisionId: AgentRevisionId | null }
	| { readonly outcome: "denied"; readonly reason: AgentRevisionLifecycleDenial };

/**
 * Outcome of an enable, pause, or retire request.
 *
 * `conflict` means the service was not in the state the caller claimed to have observed;
 * `currentState` is what it is now, and nothing was changed. Retry from that state.
 */
export type ChangeAgentServiceStateResult =
	| { readonly outcome: "changed"; readonly service: AgentService }
	| { readonly outcome: "conflict"; readonly currentState: AgentServiceState }
	| { readonly outcome: "denied"; readonly reason: AgentRevisionLifecycleDenial };

/** Outcome of comparing two revisions: both revisions plus their differences, or a refusal (both revisions must exist in the caller's silo and belong to the same service). */
export type CompareAgentRevisionsResult =
	| { readonly outcome: "compared"; readonly base: AgentRevision; readonly target: AgentRevision; readonly diff: AgentRevisionDiff }
	| { readonly outcome: "denied"; readonly reason: AgentRevisionLifecycleDenial };

/** Read-only run history for one service. */
export interface AgentServiceHistory
{
	/** Immutable revision lineage, newest first. */
	readonly revisions: readonly AgentRevision[];
	/** Durable run-history records, newest first. */
	readonly runs: readonly AgentRun[];
}

/**
 * Stores and reads managed-agent definitions: services, their revision lineage, and run history.
 *
 * Every method is silo-scoped. A service or revision belonging to another silo reads as `null`, not
 * as a permission error, so a caller cannot use this to discover that a foreign service exists.
 *
 * Revisions are append-only. `reviseRevision` and `restoreRevision` add a new draft rather than
 * editing an existing one, and each takes the revision the author was looking at
 * (`expectedParentRevisionId`); if someone else appended first, the call returns a conflict with the
 * current newest revision instead of silently overwriting the other author's work.
 *
 * Implemented by: `PrismaAgentRevisionLifecycleRepository` in `prisma-agent-revision-lifecycle.ts`.
 * Called by: the seven `__*` use cases in `agent-revision-lifecycle.ts`; wired in
 * `prisma-agent-services.router.ts`.
 */
export interface AgentRevisionLifecycleRepository
{
	/** Lists managed services in the caller's silo, most recently updated first, capped at 200 rows. */
	listManagedServices(siloId: SiloId): Promise<readonly AgentService[]>;
	/** Loads one stable service identity scoped to the caller's silo, or null when absent. */
	getService(agentServiceId: AgentServiceId, siloId: SiloId): Promise<AgentService | null>;
	/** Loads one immutable revision whose parent service is in the caller's silo, or null. */
	getRevision(agentRevisionId: AgentRevisionId, siloId: SiloId): Promise<AgentRevision | null>;
	/** Creates the service and its first draft revision in one transaction, so a service can never exist with no revision. */
	createManagedService(command: CreateManagedAgentServiceCommand, createdAt: string): Promise<CreateManagedAgentServiceResult>;
	/** Adds a draft revision on top of the newest one, in one transaction; returns a conflict if another author appended first. */
	reviseRevision(command: ReviseAgentRevisionCommand, createdAt: string): Promise<AppendAgentRevisionResult>;
	/** Clones an older revision into a new draft revision atomically, silo-scoped. */
	restoreRevision(command: RestoreAgentRevisionCommand, createdAt: string): Promise<AppendAgentRevisionResult>;
	/** Changes the service state only if it still matches `expectedState`; otherwise returns a conflict with the current state. */
	changeServiceState(command: ChangeAgentServiceStateCommand, changedAt: string): Promise<ChangeAgentServiceStateResult>;
	/** Reads the silo-scoped revision lineage and durable run history for one service. */
	readHistory(agentServiceId: AgentServiceId, siloId: SiloId, runLimit: number): Promise<AgentServiceHistory>;
}

/**
 * Outcome of one run-now or scheduled-slot request.
 *
 * `Accepted` and `Idempotent` both carry `runId` and both mean a run exists. Only `Denied` carries a
 * `reason`, and {@link AgentRevisionLifecycleDenial} says which reasons are worth retrying.
 */
export type ManagedRunAdmissionResult =
	| { readonly outcome: ManagedRunAdmissionOutcomes.Accepted; readonly runId: string }
	| { readonly outcome: ManagedRunAdmissionOutcomes.Idempotent; readonly runId: string }
	| { readonly outcome: ManagedRunAdmissionOutcomes.Denied; readonly reason: AgentRevisionLifecycleDenial };

/**
 * Records one managed-agent run in the database, without starting it.
 *
 * This package decides *whether* a run may be admitted (is the service managed, active, and does it
 * have a published revision) but deliberately does not own the run tables, so it calls out through
 * this one method. The implementation writes an AgentRun row, compiles its frozen input snapshot,
 * and stops. Nothing here creates a Kubernetes Job or executes agent logic — a separate dispatcher
 * picks the row up later.
 *
 * Implemented by: `_CreateManagedRunAdmissionPortWithGate` and `__CreateManagedRunAdmissionPort` in
 * libs/backend/agents/execution/admission/main/src/managed-run-admission{,.composition}.ts.
 * Called by: {@link __AdmitManagedRunNow} in `agent-revision-lifecycle.ts` (the HTTP run-now path),
 * and `__RunScheduleTick` in libs/backend/server/agents/scheduling/main/src/schedule-tick.ts (the
 * cron path).
 */
export interface ManagedRunAdmissionPort
{
	/**
	 * Records one managed run admission for the service's active revision.
	 * The implementation admits the run through the existing run-admission path with
	 * `trigger: managed_invocation`; it must not dispatch a Job, schedule, or execute anything.
	 */
	admitManagedRun(command: ManagedRunNowCommand): Promise<ManagedRunAdmissionResult>;
}
