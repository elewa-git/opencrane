/** Pins the revision carried by every frame between a ConversationComputer Sandbox and the server. */
export const CONVERSATION_COMPUTER_RUNTIME_PROTOCOL_VERSION = "opencrane.conversation-computer-runtime/v1";

/** Gives each command and terminal report the same private protocol revision. */
export type ConversationComputerRuntimeProtocolVersion = typeof CONVERSATION_COMPUTER_RUNTIME_PROTOCOL_VERSION;

/**
 * Names the work the server may ask a ConversationComputer Sandbox to perform.
 *
 * Each member selects a different payload in {@link ConversationComputerRuntimeCommand}; the
 * Sandbox receives the selected command rather than choosing work from ConversationComputer history.
 */
export enum ConversationComputerRuntimeCommandKinds
{
	/** Begins one newly admitted conversation turn from server-selected input. */
	StartTurn = "start_turn",
	/** Delivers one server-accepted participant response to the suspended loop. */
	ResumeAfterInput = "resume_after_input",
	/** Requests that the loop reach a safe interruption boundary before later work is selected. */
	Interrupt = "interrupt",
	/** Ends the active execution because the server has selected a terminal lifecycle transition. */
	Stop = "stop",
}

/**
 * Names the outcome a Sandbox reports after it finishes a command.
 *
 * A report records the loop's result but does not itself select a durable lifecycle transition.
 */
export enum ConversationComputerRuntimeTerminalStates
{
	/** Records that the target loop completed its selected work without a replacement command. */
	Completed = "completed",
	/** Records that the target loop observed the server-owned interruption or stop boundary. */
	Interrupted = "interrupted",
	/** Records a failure category without accepting provider or exception text as history. */
	Failed = "failed",
}

/**
 * Names the lifecycle decisions the server can deliver as a stop command.
 *
 * A stop command tells the Sandbox why to stop; a terminal report tells the server how the loop ended.
 */
export enum ConversationComputerRuntimeStopReasons
{
	/** Ends the loop because its exact active lease reached its server-owned expiry. */
	LeaseExpired = "lease_expired",
	/** Ends the loop because the computer entered its checked cooling lifecycle. */
	ComputerCooling = "computer_cooling",
	/** Ends the loop because the computer was permanently retired by the server. */
	ComputerRetired = "computer_retired",
	/** Ends the loop because current authorization no longer permits the execution. */
	AuthorizationRevoked = "authorization_revoked",
}

/**
 * Carries the protocol, identity, lease, and delivery fields for one server-issued command.
 *
 * The terminal report echoes the computer, execution, and lease-generation coordinates from this command.
 */
export interface ConversationComputerRuntimeCommandCoordinates
{
	/** Names the protocol revision that both the server router and Sandbox adapter must validate. */
	readonly protocolVersion: ConversationComputerRuntimeProtocolVersion;
	/** Identifies the durable command so retries cannot select a second command effect. */
	readonly commandId: string;
	/** Orders commands monotonically within this exact execution. */
	readonly sequence: number;
	/** Names the logical computer whose current lease the command must revalidate. */
	readonly computerId: string;
	/** Names the server-created execution that owns the command. */
	readonly executionId: string;
	/** Fences the command to one Sandbox lease generation. */
	readonly leaseGeneration: number;
	/** Records the server instant at which this command became eligible for delivery. */
	readonly issuedAt: string;
	/** Rejects delayed delivery after the server-owned command deadline. */
	readonly expiresAt: string;
}

/**
 * Delivers the server-selected input that begins a target loop turn.
 *
 * It carries an immutable entry and protected-payload coordinates rather than plaintext.
 */
export interface ConversationComputerRuntimeStartTurnCommand
{
	/** Identifies the immutable conversation entry whose admission caused this turn. */
	readonly inputEntryId: string;
	/** References the protected input payload without putting plaintext on the durable command queue. */
	readonly inputPayloadRef: string;
	/** Binds the protected input payload that the runtime reads through its later narrow reader route. */
	readonly inputPayloadDigest: `sha256:${string}`;
}

/**
 * Delivers a server-accepted elicitation resolution to a loop waiting for participant input.
 *
 * Response coordinates stay nullable because an accepted resolution may not contain a response payload.
 */
export interface ConversationComputerRuntimeResumeAfterInputCommand
{
	/** Identifies the logical elicitation whose terminal resolution this command carries. */
	readonly elicitationId: string;
	/** Identifies the immutable resolution entry the server accepted for that elicitation. */
	readonly resolutionEntryId: string;
	/** References the protected response payload when a participant supplied one. */
	readonly responsePayloadRef: string | null;
	/** Binds the protected response payload when a participant supplied one. */
	readonly responsePayloadDigest: `sha256:${string}` | null;
}

/** Delivers the history entry that tells an active target loop to reach an interruption boundary. */
export interface ConversationComputerRuntimeInterruptCommand
{
	/** Identifies the server-admitted conversation entry that superseded the active work. */
	readonly interruptionEntryId: string;
}

/** Delivers the server-owned reason that closes an active ConversationComputer execution. */
export interface ConversationComputerRuntimeStopCommand
{
	/** Names the terminal reason without importing legacy run lifecycle categories. */
	readonly reason: ConversationComputerRuntimeStopReasons;
}

/**
 * Describes one target-loop command without carrying an AgentRun, attempt, or legacy candidate shape.
 *
 * The `kind` and `payload` stay paired, so a Sandbox cannot apply an interruption payload as start-turn input.
 */
export type ConversationComputerRuntimeCommand =
	| { readonly kind: ConversationComputerRuntimeCommandKinds.StartTurn; readonly payload: ConversationComputerRuntimeStartTurnCommand }
	| { readonly kind: ConversationComputerRuntimeCommandKinds.ResumeAfterInput; readonly payload: ConversationComputerRuntimeResumeAfterInputCommand }
	| { readonly kind: ConversationComputerRuntimeCommandKinds.Interrupt; readonly payload: ConversationComputerRuntimeInterruptCommand }
	| { readonly kind: ConversationComputerRuntimeCommandKinds.Stop; readonly payload: ConversationComputerRuntimeStopCommand };

/** Combines the server-issued delivery coordinates with one target-loop command. */
export type ConversationComputerRuntimeCommandEnvelope = ConversationComputerRuntimeCommandCoordinates & ConversationComputerRuntimeCommand;

/**
 * Carries the command identity and lease fields a Sandbox echoes in a terminal report.
 *
 * A terminal state alone does not identify the execution that reported it.
 */
export interface ConversationComputerRuntimeTerminalCoordinates
{
	/** Names the protocol revision that the runtime router validates before any durable terminal write. */
	readonly protocolVersion: ConversationComputerRuntimeProtocolVersion;
	/** Identifies the server-issued command that reached a terminal result. */
	readonly commandId: string;
	/** Names the logical computer that owns the reporting Sandbox. */
	readonly computerId: string;
	/** Names the active server-created execution that may accept this report. */
	readonly executionId: string;
	/** Fences the report to the admitted Sandbox lease generation. */
	readonly leaseGeneration: number;
}

/**
 * Reports one terminal target-loop outcome without claiming a durable lifecycle transition.
 *
 * Callers use the echoed coordinates to select the active execution before translating {@link state} into history.
 */
export interface ConversationComputerRuntimeTerminalReport extends ConversationComputerRuntimeTerminalCoordinates
{
	/** States the bounded outcome that the server terminal authority may translate into history. */
	readonly state: ConversationComputerRuntimeTerminalStates;
}
