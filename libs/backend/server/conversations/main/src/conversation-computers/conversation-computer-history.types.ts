import type { ComputerLease, ConversationComputer, ConversationComputerExecution } from "@opencrane/contracts";
import type { HistoryExpectedRevisions } from "@opencrane/backend/server/infra/history-store";

/** Names the immutable coordinates that select one logical conversation computer. */
export interface ConversationComputerCurrentCommand
{
	/** Identifies the silo that owns the requested computer. */
	readonly siloId: string;
	/** Identifies the one logical computer whose deterministic stream may be read. */
	readonly computerId: string;
	/** Identifies the one agent conversation that owns this computer. */
	readonly conversationId: string;
	/** Identifies the agent identity that must remain bound to this computer. */
	readonly agentIdentityId: string;
	/** Identifies the immutable profile revision that must remain bound to this computer. */
	readonly profileRevisionId: string;
}

/** Names the trusted computer coordinates a runtime command may supply without selecting an identity. */
export interface ConversationComputerRuntimeCurrentCommand
{
	/** Identifies the silo that owns the requested computer. */
	readonly siloId: string;
	/** Identifies the computer selected by the server activation route. */
	readonly computerId: string;
	/** Identifies the conversation already bound to that computer. */
	readonly conversationId: string;
	/** Identifies the profile revision already bound to that computer. */
	readonly profileRevisionId: string;
}

/** Names the server-derived coordinates that select one computer activation request. */
export interface ConversationComputerActivationCurrentCommand
{
	/** Identifies the silo that owns the requested computer. */
	readonly siloId: string;
	/** Identifies the computer selected by the durable activation event. */
	readonly computerId: string;
	/** Identifies the conversation that remains bound to that computer. */
	readonly conversationId: string;
}

/** Adds the server-owned current time required to use a runtime-selected computer execution. */
export interface ActiveConversationComputerRuntimeCommand extends ConversationComputerRuntimeCurrentCommand
{
	/** Rejects a lease that expired before this command was admitted. */
	readonly nowEpochMilliseconds: number;
}

/**
 * Carries the coordinates allowed across the Sandbox bootstrap boundary.
 *
 * History derives the conversation and profile from the selected computer, so a Sandbox cannot
 * choose a different execution by adding those durable coordinates to its request.
 */
export interface ActiveConversationComputerBootstrapCommand
{
	/** Identifies the deployment silo fixed by server configuration. */
	readonly siloId: string;
	/** Identifies the durable computer whose remaining coordinates history must derive. */
	readonly computerId: string;
	/** Rejects a lease that expired before this bootstrap was admitted. */
	readonly nowEpochMilliseconds: number;
}

/** Adds the server-owned clock to the durable coordinates that select one execution for command work. */
export interface ActiveConversationComputerServerCommand extends ConversationComputerActivationCurrentCommand
{
	/** Rejects a lease that expired before the server selected the next runtime command. */
	readonly nowEpochMilliseconds: number;
}

/** Adds the server-owned clock required to decide whether one warm lease remains usable. */
export interface ActiveConversationComputerLeaseCommand extends ConversationComputerCurrentCommand
{
	/** Stores the server-owned instant used to reject an expired lease. */
	readonly nowEpochMilliseconds: number;
}

/** Carries one complete computer-and-lease snapshot to its deterministic history stream. */
export interface ConversationComputerAppendCommand
{
	/** Requires the stream revision observed by the caller before this append. */
	readonly expectedRevision: HistoryExpectedRevisions.NoStream | bigint;
	/** Rechecks an authority-specific fence after history has replayed the head that this append will use. */
	readonly assertCurrent?: (current: CurrentConversationComputer) => void;
	/** Supplies the caller-chosen UUID that makes a retried append idempotent. */
	readonly eventId: string;
	/** Carries the complete closed computer snapshot to persist. */
	readonly computer: ConversationComputer;
	/** Carries the current lease snapshot, or null when no lease currently exists. */
	readonly lease: ComputerLease | null;
}

/**
 * Carries the cold revision-zero record that establishes a computer history stream.
 *
 * `ConversationComputerHistory.provision` accepts this before any lease or execution exists. Later
 * lifecycle appends must name a nonnegative expected revision, so they cannot replace the provision
 * record at `NoStream`.
 */
export interface ConversationComputerProvisionCommand
{
	/** Supplies the caller-chosen UUID that keeps a response-lost provision retry byte-stable. */
	readonly eventId: string;
	/** Carries the cold, zero-generation computer bound to its conversation, identity, and profile. */
	readonly computer: ConversationComputer;
}

/** Carries the checked computer and lease state stored at one history revision. */
export interface ConversationComputerHistorySnapshot
{
	/** Carries the logical computer state at this stream revision. */
	readonly computer: ConversationComputer;
	/** Carries the only current lease at this stream revision, if it exists. */
	readonly lease: ComputerLease | null;
}

/** Gives a later authority the current computer state and its checked KurrentDB head evidence. */
export interface CurrentConversationComputer
{
	/** Names the deterministic KurrentDB stream that supplied this snapshot. */
	readonly streamName: string;
	/** Reports the exact KurrentDB revision that supplied this current snapshot. */
	readonly revision: bigint;
	/** Carries the validated current logical computer snapshot. */
	readonly computer: ConversationComputer;
	/** Carries the validated current lease snapshot, or null when none exists. */
	readonly lease: ComputerLease | null;
}

/** Gives pre-admission activation only the current warm computer and its fenced active lease. */
export interface ActiveConversationComputerLease extends CurrentConversationComputer
{
	/** Carries the only lease that may activate the computer at this checked head. */
	readonly lease: ComputerLease;
}

/** Gives a command authority the current open execution and its checked computer-stream head. */
export interface ActiveConversationComputerExecution extends ActiveConversationComputerLease
{
	/** Carries the execution that remains active on the fenced current lease. */
	readonly execution: ConversationComputerExecution;
}
