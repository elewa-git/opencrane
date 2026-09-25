import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import type { RoutineFiringTrigger } from "@opencrane/models/agents";

/** Identifies the firing and workflow task that own one occurrence. */
export interface RoutineFiringIdentity
{
	/** Organisation that owns the firing. */
	readonly siloId: string;
	/** Immutable occurrence identifier. */
	readonly firingId: string;
	/** Stable routine identifier. */
	readonly routineId: string;
	/** Immutable routine revision. */
	readonly routineRevision: number;
	/** Workflow task that owns preparation. */
	readonly task: IWorkflowTaskReceipt;
}

/** Supplies immutable content-free occurrence facts to external execution owners. */
export interface RoutineOccurrenceCommand extends RoutineFiringIdentity
{
	/** Existing admitted run recovered after a crash, or null while preparation remains. */
	readonly admittedRunId: string | null;
	/** Why this occurrence exists. */
	readonly trigger: RoutineFiringTrigger;
	/** Automatic UTC slot, or null for manual work. */
	readonly scheduledSlot: string | null;
	/** Conversation reserved before preparation begins. */
	readonly conversationId: string;
	/** Existing conversation from which the audience was confirmed. */
	readonly destinationConversationId: string;
	/** Current managed service selected by the routine. */
	readonly selectedManagedServiceId: string;
	/** Original approved human Principal. */
	readonly requesterPrincipalId: string;
	/** Original verified issuer retained unchanged. */
	readonly requesterIssuer: string;
	/** Original verified subject retained unchanged. */
	readonly requesterSubjectId: string;
	/** Original authentication instant retained unchanged. */
	readonly requesterAuthenticatedAt: string;
	/** Creator-confirmed audience frozen on the routine revision. */
	readonly audiencePrincipalIds: readonly string[];
}

/** Adds plaintext only for the conversation-history preparation owner. */
export interface PrepareRoutineOccurrenceCommand extends RoutineOccurrenceCommand
{
	/** Decrypted instruction passed only to occurrence preparation. */
	readonly instruction: string;
}

/** Records JSON-safe evidence returned after occurrence history preparation. */
export interface RoutineOccurrencePreparationReceipt
{
	/** Stable adapter receipt used to recover an uncertain response. */
	readonly receiptId: string;
	/** Opaque prepared history reference. */
	readonly historyReference: string;
	/** Digest binding the receipt to its prepared content. */
	readonly digest: `sha256:${string}`;
}

/** Records JSON-safe evidence returned after computer activation. */
export interface RoutineComputerActivationReceipt
{
	/** Stable adapter receipt used to recover an uncertain response. */
	readonly receiptId: string;
	/** Opaque active computer reference. */
	readonly computerReference: string;
	/** Digest binding activation to the occurrence conversation and preparation. */
	readonly digest: `sha256:${string}`;
}

/**
 * Stable outcomes returned while scheduling polls computer activation. The workflow stores each
 * result under a `routine-activate-computer-${pollIndex}` checkpoint and the adjacent parser
 * validates this closed set before replaying it. These string values are serialized checkpoint
 * data, so renaming one breaks recovery of saved activation polls.
 */
export enum RoutineComputerActivationStatus
{
	/** The computer is ready and the receipt may be recorded before run admission. */
	Active = "active",
	/** Activation is still owned externally and scheduling should durably poll later. */
	Pending = "pending",
	/** The activation owner committed a refusal and scheduling must stop this occurrence. */
	Refused = "refused",
}

/** Returns the exact activation evidence after the computer becomes ready. */
export interface RoutineComputerActivationActiveResult
{
	/** Selects the active result shape. */
	readonly status: RoutineComputerActivationStatus.Active;
	/** Immutable evidence saved before run admission. */
	readonly receipt: RoutineComputerActivationReceipt;
}

/** Supplies the bounded durable wait for one activation poll. */
export interface RoutineComputerActivationPendingResult
{
	/** Selects the pending result shape. */
	readonly status: RoutineComputerActivationStatus.Pending;
	/** Earliest epoch millisecond at which scheduling should poll again. */
	readonly notBeforeEpochMs: number;
	/** Epoch millisecond after which the activation owner must resolve or refuse the request. */
	readonly expiresAtEpochMs: number;
}

/** Confirms that the activation owner durably refused this occurrence. */
export interface RoutineComputerActivationRefusedResult
{
	/** Selects the refused result shape. */
	readonly status: RoutineComputerActivationStatus.Refused;
}

/** Complete outcome of one bounded computer-activation poll. */
export type RoutineComputerActivationResult = RoutineComputerActivationActiveResult | RoutineComputerActivationPendingResult | RoutineComputerActivationRefusedResult;

/** Creates or recovers conversation history after the scheduling authority rechecks current access. */
export interface RoutineOccurrencePreparationPort
{
	/** Prepares the occurrence, or returns null after its owner commits a current-authority refusal. */
	prepare(command: PrepareRoutineOccurrenceCommand): Promise<RoutineOccurrencePreparationReceipt | null>;
}

/** Activates or recovers the managed agent's computer after preparation is saved. */
export interface RoutineComputerActivationPort
{
	/** Activates or polls the computer for the same occurrence and preparation receipt. */
	activate(command: RoutineOccurrenceCommand, preparation: RoutineOccurrencePreparationReceipt): Promise<RoutineComputerActivationResult>;
}

/** Supplies frozen occurrence facts and saved stage receipts to root-run admission. */
export interface RoutineRunAdmissionInput extends RoutineOccurrenceCommand
{
	/** Saved occurrence preparation receipt. */
	readonly preparation: RoutineOccurrencePreparationReceipt;
	/** Saved computer activation receipt. */
	readonly activation: RoutineComputerActivationReceipt;
}

/** Records the root run and workflow task returned by run admission. */
export interface RoutineRunAdmissionReceipt
{
	/** AgentRun created or recovered for this firing. */
	readonly runId: string;
	/** Digest of the immutable admitted run input. */
	readonly inputSnapshotDigest: `sha256:${string}`;
	/** Workflow task bound to the admitted AgentRun. */
	readonly runTask: IWorkflowTaskReceipt;
}

/** Admits or recovers the root run after scheduling has saved both external-stage receipts. */
export interface RoutineRunAdmissionPort
{
	/** Admits the root AgentRun while its owner repeats every current authority check. */
	admit(command: RoutineRunAdmissionInput): Promise<RoutineRunAdmissionReceipt>;
}
