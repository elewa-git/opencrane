/**
 * Selects who may receive a saved conversation entry after current access is checked.
 *
 * These presentation categories are stored in Kurrent conversation history and returned by the
 * API. Their strings are shared by writers, validators and renderers; renaming one breaks replay.
 */
export enum ConversationEntryAudiences
{
	/** May be delivered to every currently authorized conversation participant. */
	Conversation = "conversation",
	/** May be delivered only to the explicitly named, currently authorized participants. */
	ParticipantSubset = "participant_subset",
}

/** Records an entry's admitted source; the saved string never substitutes for identity or receipt checks. */
export enum ConversationEntryProvenance
{
	/** A verified human submitted the entry through message admission. */
	HumanAuthored = "human-authored",
	/** A bound agent produced the entry through its execution authority. */
	AgentAuthored = "agent-authored",
	/** A service transformed a separately verified domain receipt into a visible entry. */
	ServiceAttested = "service-attested",
}

/** Selects a saved participant-visible log shape; the log describes work but does not authorize it. */
export enum ConversationLogKinds
{
	/** Describes the lifecycle of one admitted run. */
	Run = "run",
	/** Describes one model request. */
	Model = "model",
	/** Describes one governed tool call. */
	ToolCall = "tool_call",
	/** Describes one artifact publication. */
	Artifact = "artifact",
	/** Describes a memory operation without copying memory content. */
	Memory = "memory",
	/** Describes an approval request or its resolution. */
	Approval = "approval",
}

/** Names a tool's execution channel in immutable conversation logs, independently of its permission. */
export enum ConversationLogToolKinds
{
	/** Executes through a server-owned local tool boundary. */
	Local = "local",
	/** Executes through the admitted MCP connection. */
	Mcp = "mcp",
	/** Executes an isolated OCI workload. */
	Oci = "oci",
}

/**
 * Preserves the run progress vocabulary stored in participant history.
 *
 * Each phase describes one saved observation, not current or terminal run authority.
 * Later log entries may follow any phase; callers must read the owning domain for current state.
 */
export enum ConversationRunLogPhases
{
	/** The run is waiting to start. */
	Queued = "queued",
	/** Execution has started. */
	Started = "started",
	/** An interruption stopped the run's current work. */
	Interrupted = "interrupted",
	/** The run completed successfully. */
	Completed = "completed",
	/** The run failed. */
	Failed = "failed",
	/** Uncertain work needs recovery before further execution is safe. */
	RecoveryRequired = "recovery_required",
}

/**
 * Preserves model-request progress in participant history without granting another model call.
 *
 * Each phase describes one saved observation, not current or terminal model request authority.
 * Later log entries may follow any phase; callers must read the owning domain for current state.
 */
export enum ConversationModelLogPhases
{
	/** The model request started. */
	Started = "started",
	/** Partial model output is arriving. */
	Streaming = "streaming",
	/** The model request completed. */
	Completed = "completed",
	/** The model request failed. */
	Failed = "failed",
	/** Further processing of this model request was cancelled. */
	Cancelled = "cancelled",
}

/**
 * Preserves visible tool progress; its stored strings are distinct from execution-domain state names.
 *
 * Each phase describes one saved observation, not current or terminal tool call authority.
 * Later log entries may follow any phase; callers must read the owning domain for current state.
 */
export enum ConversationToolCallLogPhases
{
	/** A governed tool call was requested but has not been reported as executing. */
	Requested = "requested",
	/** The tool's execution claim was accepted. */
	Running = "running",
	/** The tool result completed successfully. */
	Completed = "completed",
	/** The tool call failed. */
	Failed = "failed",
	/** The tool call was cancelled. */
	Cancelled = "cancelled",
	/** An uncertain effect needs recovery; this entry does not permit redispatch. */
	RecoveryRequired = "recovery_required",
}

/**
 * Preserves artifact-publication progress in history; artifact access still requires its own authority.
 *
 * Each phase describes one saved observation, not current or terminal artifact publication authority.
 * Later log entries may follow any phase; callers must read the owning domain for current state.
 */
export enum ConversationArtifactLogPhases
{
	/** Artifact bytes are being uploaded. */
	Uploading = "uploading",
	/** Uploaded bytes are awaiting or undergoing inspection. */
	Scanning = "scanning",
	/** The artifact revision was published. */
	Published = "published",
	/** Inspection rejected the artifact. */
	Rejected = "rejected",
	/** Artifact processing failed. */
	Failed = "failed",
}

/** Names the memory operation recorded in a log, without carrying its content or granting consent. */
export enum ConversationMemoryLogOperations
{
	/** Recalls facts from the run's admitted memory dataset. */
	Recall = "recall",
	/** Writes a fact through the governed memory boundary. */
	Write = "write",
}

/**
 * Preserves visible memory-operation progress; the memory owner decides consent and completion.
 *
 * Each phase describes one saved observation, not current or terminal memory operation authority.
 * Later log entries may follow any phase; callers must read the owning domain for current state.
 */
export enum ConversationMemoryLogPhases
{
	/** A memory operation was requested. */
	Requested = "requested",
	/** The memory operation completed. */
	Completed = "completed",
	/** The memory operation failed. */
	Failed = "failed",
	/** Current authority refused the memory operation. */
	Denied = "denied",
}

/**
 * Preserves approval progress in participant history; only the approval authority can admit an action.
 *
 * Each phase describes one saved observation, not current or terminal approval authority.
 * Later log entries may follow any phase; callers must read the owning domain for current state.
 */
export enum ConversationApprovalLogPhases
{
	/** A decision is pending. */
	Requested = "requested",
	/** The authorized decider granted the request. */
	Granted = "granted",
	/** The authorized decider denied the request. */
	Denied = "denied",
	/** The decision deadline passed. */
	Expired = "expired",
	/** Previously available approval authority was withdrawn. */
	Revoked = "revoked",
}

/** Selects a saved A2UI surface mutation; these wire strings determine how a surface is replayed. */
export enum ConversationA2UIOperations
{
	/** Replaces the surface using the governed payload reference. */
	Replace = "replace",
	/** Applies a change using the governed payload reference. */
	Patch = "patch",
	/** Removes the surface without retaining a payload reference. */
	Remove = "remove",
}
