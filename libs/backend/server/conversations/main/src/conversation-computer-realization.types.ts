import { ConversationComputerRealizationKinds, type ConversationComputerRealization, type RealizedLeaseScope } from "@opencrane/contracts";
import type { RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";

/** Carries the reviewed Kubernetes identity of one production Sandbox Pod. */
interface AgentSandboxConversationComputerProcessIdentity
{
	/** Selects production Pod binding. */
	readonly kind: ConversationComputerRealizationKinds.AgentSandbox;
	/** Carries the TokenReview result; it remains Kubernetes-only. */
	readonly workload: RuntimeWorkloadIdentity;
}

/** Carries the supervisor-resolved identity of one workstation child process. */
interface HostDevelopmentConversationComputerProcessIdentity
{
	/** Selects workstation process binding. */
	readonly kind: ConversationComputerRealizationKinds.HostDevelopmentProcess;
	/** Identifies the child that owns the supplied bearer. */
	readonly processId: string;
}

/** Identifies a caller without pretending a workstation process is a Kubernetes workload. */
export type ConversationComputerProcessIdentity = AgentSandboxConversationComputerProcessIdentity | HostDevelopmentConversationComputerProcessIdentity;

/** Carries the server-owned coordinates needed to realise one reserved generation. */
export interface ConversationComputerRealizationClaimCommand
{
	/** Identifies the silo that owns the computer. */
	readonly siloId: string;
	/** Identifies the logical computer. */
	readonly computerId: string;
	/** Identifies the reserved lease. */
	readonly leaseId: string;
	/** Fences this request to one generation. */
	readonly generation: number;
	/** Records when the realisation must stop accepting work. */
	readonly expiresAt: string;
	/** Distinguishes a first activation from recovery for adapters that restore state. */
	readonly reason: "activation_requested" | "recovery_requested";
	/** Carries the deterministic realisation coordinates reserved in history before external work. */
	readonly realization: ConversationComputerRealization;
}

/** Carries the lease coordinates needed after a realisation has been persisted. */
export interface ConversationComputerRealizationCommand
{
	/** Identifies the logical computer. */
	readonly computerId: string;
	/** Carries the lease fence and persisted realisation. */
	readonly lease: RealizedLeaseScope;
}

/** Carries a renewed expiry for the exact persisted realisation. */
export interface ConversationComputerRealizationRenewCommand extends ConversationComputerRealizationCommand
{
	/** Moves the physical shutdown deadline to this instant. */
	readonly expiresAt: string;
}

/** Reports the physical realisation deadline observed by its adapter. */
export interface ConversationComputerRealizationStatus
{
	/** Reports when the process is scheduled to stop, or null when the adapter has no separate deadline. */
	readonly shutdownTime: string | null;
}

/**
 * Owns physical conversation-computer processes behind neutral lease operations.
 *
 * Product history remains authoritative. Implementations may manage Agent Sandbox claims or
 * workstation children, but every operation must match the persisted realisation discriminant.
 */
export interface ConversationComputerRealizer
{
	/**
	 * Derives non-secret coordinates that history can reserve before an external process starts.
	 * The same reservation must produce the same coordinates so a retried activation keeps one owner.
	 */
	prepare(command: Omit<ConversationComputerRealizationClaimCommand, "realization">): ConversationComputerRealization;
	/**
	 * Creates or observes the process for one reserved generation.
	 * The returned coordinates replace the pending realization in history when the process is ready.
	 */
	claim(command: ConversationComputerRealizationClaimCommand): Promise<ConversationComputerRealization>;
	/**
	 * Reads the process selected by the persisted realization.
	 * Returning `null` tells lifecycle reconciliation to mark an active lease as lost.
	 */
	inspect(command: ConversationComputerRealizationCommand): Promise<ConversationComputerRealizationStatus | null>;
	/**
	 * Moves the physical process deadline later without changing its identity.
	 * `Absent` tells lifecycle reconciliation that the persisted lease has lost its process.
	 */
	renew(command: ConversationComputerRealizationRenewCommand): Promise<"renewed" | "absent">;
	/**
	 * Stops the process selected by the persisted lease.
	 * `Absent` makes a repeated release idempotent; cleanup failures reject instead of reporting release.
	 */
	release(command: ConversationComputerRealizationCommand): Promise<"released" | "absent">;
	/**
	 * Verifies that the caller identity belongs to the persisted realization.
	 * A false result prevents the process from reading or advancing the selected turn.
	 */
	bind(command: ConversationComputerRealizationCommand & { readonly process: ConversationComputerProcessIdentity }): Promise<boolean>;
}

/** Authenticates a private-listener bearer without interpreting lease query fields. */
export interface ConversationComputerProcessAuthenticator
{
	/** Returns the independently verified process identity, or null for a missing or invalid bearer. */
	authenticate(bearer: string): Promise<ConversationComputerProcessIdentity | null>;
}
