import type { AgentRunTriggers } from "@opencrane/contracts";

/** Invocation coordinates read from the saved tool call, never from an approval request payload. */
export interface RoutineToolApprovalInvocationSource
{
	/** Organisation that owns the tool call. */
	readonly siloId: string;
	/** Run that prepared the tool call. */
	readonly runId: string | null;
	/** Run attempt that prepared the tool call. */
	readonly attempt: number | null;
	/** Managed service that selected the tool. */
	readonly agentServiceId: string | null;
	/** Immutable managed-service revision that selected the tool. */
	readonly agentRevisionId: string | null;
}

/** Run coordinates used to distinguish interactive work from a routine occurrence. */
export interface RoutineToolApprovalRunSource
{
	/** Saved run identity. */
	readonly id: string;
	/** Organisation that owns the run. */
	readonly siloId: string;
	/** Attempt whose immutable snapshot admitted the run. */
	readonly attempt: number;
	/** Managed service executed by the run. */
	readonly agentServiceId: string;
	/** Immutable managed-service revision executed by the run. */
	readonly agentRevisionId: string;
	/** Occurrence conversation, or the interactive conversation. */
	readonly conversationId: string | null;
	/** Server-owned event that admitted the run. */
	readonly trigger: `${AgentRunTriggers}`;
	/** Routine firing linked to scheduled or manual work. */
	readonly routineFiringId: string | null;
	/** Routine aggregate linked to scheduled or manual work. */
	readonly routineId: string | null;
	/** Immutable routine revision linked to scheduled or manual work. */
	readonly routineRevision: number | null;
	/** UTC automatic slot; manual and interactive work keep it null. */
	readonly routineScheduledSlot: Date | null;
	/** Digest that selects the admitted input snapshot. */
	readonly inputSnapshotDigest: string;
}

/** Immutable input snapshot facts that must repeat the run's saved origin. */
export interface RoutineToolApprovalSnapshotSource
{
	/** Run that owns the snapshot. */
	readonly runId: string;
	/** Run attempt described by the snapshot. */
	readonly attempt: number;
	/** Current routine-aware snapshot contract version. */
	readonly snapshotVersion: number;
	/** Organisation that owns the snapshot. */
	readonly siloId: string;
	/** Managed service frozen into the snapshot. */
	readonly agentServiceId: string;
	/** Immutable managed-service revision frozen into the snapshot. */
	readonly agentRevisionId: string;
	/** Conversation whose history the run consumes. */
	readonly conversationId: string | null;
	/** Server-owned origin saved inside the snapshot digest. */
	readonly origin: unknown;
	/** Digest bound to the owning run. */
	readonly digest: string;
}

/** Original requester facts stored on the routine aggregate. */
export interface RoutineToolApprovalRoutineSource
{
	/** Routine aggregate identity. */
	readonly id: string;
	/** Organisation that owns the routine. */
	readonly siloId: string;
	/** Principal that originally approved the routine. */
	readonly originalRequesterPrincipalId: string;
	/** OpenID Connect issuer saved with the original approval. */
	readonly requesterIssuer: string;
	/** Issuer-scoped subject saved with the original approval. */
	readonly requesterSubjectId: string;
	/** Authentication instant saved with the original approval. */
	readonly requesterAuthenticatedAt: Date;
	/** Managed service selected by the routine. */
	readonly selectedManagedServiceId: string;
}

/** Occurrence facts read from the routine firing linked to the run. */
export interface RoutineToolApprovalFiringSource
{
	/** Firing identity linked from the run. */
	readonly id: string;
	/** Organisation that owns the firing. */
	readonly siloId: string;
	/** Routine aggregate that created the firing. */
	readonly routineId: string;
	/** Immutable routine revision that created the firing. */
	readonly routineRevision: number;
	/** Whether the timer or a deliberate command created the firing. */
	readonly trigger: `${AgentRunTriggers.Scheduled}` | `${AgentRunTriggers.Manual}`;
	/** UTC automatic slot, or null for a manual command. */
	readonly scheduledSlot: Date | null;
	/** Original requester retained on the firing. */
	readonly requesterPrincipalId: string;
	/** Occurrence conversation linked to the run. */
	readonly conversationId: string;
	/** Run admitted for this firing. */
	readonly runId: string | null;
	/** Saved occurrence-preparation workflow task identifier. */
	readonly workflowTaskId: string | null;
	/** Saved occurrence-preparation workflow definition name. */
	readonly workflowTaskName: string | null;
	/** Saved occurrence-preparation workflow idempotency fence. */
	readonly workflowTaskKey: string | null;
	/** Original routine approval facts. */
	readonly routine: RoutineToolApprovalRoutineSource;
}

/** Complete server-owned evidence used to derive standing-approval routine coordinates. */
export interface RoutineToolApprovalBindingSource
{
	/** Tool call being considered for standing consent. */
	readonly invocation: RoutineToolApprovalInvocationSource;
	/** Run that owns the tool call. */
	readonly run: RoutineToolApprovalRunSource;
	/** Single immutable snapshot admitted for the current attempt. */
	readonly snapshot: RoutineToolApprovalSnapshotSource;
	/** Linked firing for routine work, or null for interactive work. */
	readonly firing: RoutineToolApprovalFiringSource | null;
}

/** Routine coordinates saved in and matched against a standing approval scope. */
export interface RoutineToolApprovalBinding
{
	/** Routine aggregate, or null for an interactive run. */
	readonly routineId: string | null;
	/** Immutable routine revision, or null for an interactive run. */
	readonly routineRevision: number | null;
	/** Original routine requester, or null for an interactive run. */
	readonly routineRequesterPrincipalId: string | null;
	/** Original requester's issuer-scoped subject, or null for an interactive run. */
	readonly routineRequesterSubjectId: string | null;
}
