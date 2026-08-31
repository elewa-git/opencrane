/**
 * Reasons the control plane can prove for a run that is waiting for work or a participant.
 *
 * These values are derived from saved ToolInvocation and ElicitationRequest rows while the run lock
 * is held. They are used for command decisions and bounded observability, never as permission to
 * approve, resume, retry, or cancel a run. The set is closed so monitoring cannot accidentally copy
 * model questions, tool arguments, or provider text.
 */
export enum RuntimeWaitReasons
{
	/** A saved outside action has not yet reached a terminal result. No person is necessarily needed. */
	ExternalAction = "external_action",
	/** An ordinary runtime question is waiting for its server-selected participant. */
	RuntimeInput = "runtime_input",
	/** A reviewed Agent-to-User Interface action is waiting for its selected participant. */
	A2uiAction = "a2ui_action",
	/** Server preparation proved that a saved tool invocation requires approval. */
	ToolApproval = "tool_approval",
	/** The execution user must grant one-use access for a saved personal-memory invocation. */
	PersonalMemoryPermission = "personal_memory_permission",
	/** A provider outcome is unclear and an operator must choose the recovery action. */
	RecoveryRequired = "recovery_required",
}

/** Minimal saved invocation facts used to classify one active wait. */
export interface RuntimeWaitInvocationRecord
{
	readonly state: string;
	readonly toolRevisionId: string;
}

/** Reads only the rows needed to derive server-owned wait reasons under the caller's run lock. */
export interface RuntimeWaitReasonRepository
{
	readInvocations(runId: string, attempt: number): Promise<readonly RuntimeWaitInvocationRecord[]>;
	readElicitationPurposes(runId: string, attempt: number): Promise<readonly string[]>;
}
