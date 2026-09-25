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

/** Creates or recovers conversation history after the scheduling authority rechecks current access. */
export interface RoutineOccurrencePreparationPort
{
	/** Prepares the occurrence conversation from the frozen audience and plaintext instruction. */
	prepare(command: PrepareRoutineOccurrenceCommand): Promise<RoutineOccurrencePreparationReceipt>;
}

/** Activates or recovers the managed agent's computer after preparation is saved. */
export interface RoutineComputerActivationPort
{
	/** Activates the computer for the same occurrence and preparation receipt. */
	activate(command: RoutineOccurrenceCommand, preparation: RoutineOccurrencePreparationReceipt): Promise<RoutineComputerActivationReceipt>;
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
