import type { ConversationComputerRealization } from "./conversation-computer.types";

/**
 * Groups the coordinates that every conversation-computer command carries into three named bundles.
 *
 * Server code used to pass the same ten to sixteen identifiers as flat fields through every layer.
 * These bundles give each group one name and one home: `ComputerScope` says which computer,
 * `LeaseScope` says which realization of it, and `AgentScope` says which agent service, revision and
 * profile the work runs under. A command composes the bundles it needs (`computer`, `lease`, `agent`).
 *
 * Two pairs never change independently:
 * - `leaseId` and `leaseGeneration`: the lease id is derived from the computer id and the generation,
 *   so a new generation always means a new lease id, and a lease id always names one generation.
 * - `agentIdentityId` and `profileRevisionId`: both are fixed when the computer is created and the
 *   history validator rejects any snapshot that changes either of them.
 *
 * The bundles live in memory only. Persisted and wire shapes keep their own names (`generation` and
 * `realization` on Kurrent events, and `computerScope` with `leaseId` and `leaseGeneration` inside
 * the stored execution subject), and each boundary maps between the two.
 * @see ExecutionSubjectComputerScope in `@opencrane/models/agents` for the persisted shape that PostgreSQL triggers read.
 * @see ConversationComputer and ComputerLease for the durable snapshots these coordinates are copied from.
 */

/** Names one logical conversation computer and the conversation and agent identity that own it. */
export interface ComputerScope
{
	/** Identifies the silo that owns the computer; it never changes and fences every read and write to that silo. */
	readonly siloId: string;
	/** Identifies the one agent conversation that owns the computer; it is set at creation, never changes, and fences appends and payload reads to that conversation. */
	readonly conversationId: string;
	/** Identifies the logical computer; it is created with the conversation, survives every generation, and selects the history stream and the active-lease row. */
	readonly computerId: string;
	/** Identifies the agent identity the computer acts as; it is fixed at creation together with `profileRevisionId` and fences who may author entries and hold the execution subject. */
	readonly agentIdentityId: string;
}

/** Names one realization of a computer: the lease and the generation that fences it. */
export interface LeaseScope
{
	/** Identifies one realization of the computer; a new id is minted for every generation and fences the process to its admitted realization. It is a public coordinate, never a secret. */
	readonly leaseId: string;
	/** Counts realizations of the computer and grows by one on every new claim; every durable write compares it so a replaced or stale process cannot act as the current computer. */
	readonly leaseGeneration: number;
}

/** Adds the persisted realization to a lease so process-binding checks can select its adapter. */
export interface RealizedLeaseScope extends LeaseScope
{
	/** Describes the physical process whose identity must match this lease. */
	readonly realization: ConversationComputerRealization;
}

/** Adds the expiry to a lease so projections can refuse work after the lease stops admitting it. */
export interface ActiveLeaseScope extends RealizedLeaseScope
{
	/** Records the ISO instant the lease stops admitting work; renewal moves it later, and it fences approvals and credential issuance to a live lease. */
	readonly expiresAt: string;
}

/** Names the agent service, published revision and computer profile that one turn runs under. */
export interface AgentScope
{
	/** Identifies the AgentService the conversation is bound to; it is fixed at conversation creation and fences run admission to that service. */
	readonly agentServiceId: string;
	/** Identifies the published revision observed when the turn was admitted; it changes whenever the service publishes again, so it is re-read per turn and fences the compiled input to one revision. */
	readonly agentRevisionId: string;
	/** Identifies the immutable computer profile (image digest, RuntimeClass, endpoints) admitted for the computer; it is fixed at creation together with `agentIdentityId` and fences activation to a release that admits it. */
	readonly profileRevisionId: string;
}
