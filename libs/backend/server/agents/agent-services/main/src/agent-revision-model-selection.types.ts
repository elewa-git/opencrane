/**
 * Request to copy a personal agent's active revision with only its model changed.
 *
 * The `expected*` fields are what the owner was looking at when they accepted the change. They are
 * re-checked before any write, so a request that has gone stale is refused rather than applied to a
 * revision the owner never reviewed.
 */
export interface MaterializeAgentRevisionModelSelectionCommand
{
	/** Silo that owns both the personal service and selected model definition. */
	readonly siloId: string;
	/** Personal service whose active revision is being replaced in the serializable transaction. */
	readonly agentServiceId: string;
	/** Active revision accepted when the owner reviewed the model proposal. */
	readonly expectedSourceRevisionId: string;
	/** Persona the owner saw alongside the model choice, or null. Refused as `StaleSource` if the source revision now carries a different one, so a model choice cannot be applied to a personality the owner never reviewed. */
	readonly expectedPersonaRevisionId: string | null;
	/** The model's public name (a `ModelDefinition.publicModelName`), not a provider model id. Callers must not send a provider identifier; a silo-scoped definition wins over a global one with the same name. NEEDS-HUMAN: add the LiteLLM model-registration doc URI — these names are what the control plane registers with LiteLLM. */
	readonly modelAlias: string;
	/** Human-readable explanation recorded on the immutable revision. */
	readonly changeMessage: string;
	/** Trusted owner subject recorded as the author. */
	readonly authoredBy: string;
	/** Trusted instant used for creation, publication, and service activation. */
	readonly materializedAt: Date;
}

/**
 * Outcome of a model swap on a personal agent.
 *
 * The strings are stable because another package (personal configuration) branches on them.
 * `StaleSource` and `ModelUnavailable` need different handling: `StaleSource` means the world moved
 * under a proposal the owner had already accepted, so the owner has to look again; `ModelUnavailable`
 * means the request itself named a model this silo cannot route to.
 *
 * Called by: `personal-configuration-materializer.ts` in
 * libs/backend/agents/personal/configuration/main/src/materialization/.
 */
export enum AgentRevisionModelSelectionMaterializationCodes
{
	/** A new immutable revision was appended and activated. */
	Materialized = "materialized",
	/** No registered model definition matches the owner-visible alias in the silo. */
	ModelUnavailable = "model_unavailable",
	/** The service moved off the approved revision, its persona changed, or a newer revision was added since the owner accepted. Nothing was written; re-read and propose again. */
	StaleSource = "stale_source",
}

/** Result of the agent-service-owned model-selection strategy. */
export type MaterializeAgentRevisionModelSelectionResult =
	| { readonly status: AgentRevisionModelSelectionMaterializationCodes.Materialized; readonly agentRevisionId: string }
	| { readonly status: AgentRevisionModelSelectionMaterializationCodes.ModelUnavailable }
	| { readonly status: AgentRevisionModelSelectionMaterializationCodes.StaleSource };

/**
 * Swaps the model on a personal agent's active revision, inside a transaction someone else owns.
 *
 * Personal configuration owns the transaction because it also has to move its own proposal journal
 * in the same commit; it must not reproduce revision lineage rules, so it calls in here. This port
 * appends and activates a revision but never commits — the caller does, and a later failure on the
 * caller's side rolls these writes back with it.
 *
 * Implemented by: `PrismaAgentRevisionModelSelectionRepository` in
 * `prisma-agent-revision-model-selection.ts`.
 * Called by:
 * libs/backend/agents/personal/configuration/main/src/materialization/prisma-personal-configuration-materialization-unit-of-work.ts
 * (construction) and `personal-configuration-materializer.ts` (invocation).
 */
export interface AgentRevisionModelSelectionRepository
{
	/**
	 * Re-checks the revision the owner approved, then appends and activates its model-swapped copy.
	 *
	 * Four checks run before any write, so a stale request is always safe to retry: the service must
	 * still be an active personal service in the silo and still be on `expectedSourceRevisionId`; that
	 * revision must still be published and still carry `expectedPersonaRevisionId` (so a model choice
	 * cannot land on a personality the owner never saw); it must still be the newest revision in the
	 * lineage; and only then is `modelAlias` resolved. The new revision copies the source's content
	 * with just the model changed.
	 *
	 * @param command - Service, the revision and persona the owner approved, the chosen model alias, and
	 *   the author and time to record.
	 * @returns `Materialized` with the new revision id, `StaleSource` if any of the first three checks
	 *   failed (nothing written — re-read and re-propose), or `ModelUnavailable` if no model in this silo
	 *   answers to that alias.
	 * @throws Whatever Prisma throws inside the caller's transaction, including a serialization failure.
	 *   The caller's transaction is then rolled back and nothing is activated.
	 */
	materialize(command: MaterializeAgentRevisionModelSelectionCommand): Promise<MaterializeAgentRevisionModelSelectionResult>;
}
