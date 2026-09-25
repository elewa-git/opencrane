/**
 * Records why a run stopped accepting new descendants and spending reservations.
 *
 * The runs repository persists these values and uses them during recovery. They describe closure,
 * not permission to stop a run or proof that its external work has finished. Unknown values are
 * rejected; changing a serialized value requires a matching database baseline change.
 */
export enum RunTreeClosureReasons
{
	/** A saved authorized Stop closed this branch; descendant cleanup may still be running. */
	AuthorizedStop = "authorized_stop",
	/** The source run completed, failed or was cancelled; its descendants must settle before tree completion is reported. */
	TerminalRun = "terminal_run",
	/** The source run's saved deadline elapsed; no further work may be admitted while cleanup finishes. */
	Deadline = "deadline",
}

/** Allowances transferred to a child or permanently reserved for local work. */
export interface RunTreeResources
{
	/** Maximum model requests funded by this allocation. */
	readonly modelCalls: number;
	/** Maximum generated model tokens funded by this allocation. */
	readonly completionTokens: number;
	/** Maximum external tool invocations funded by this allocation, excluding child spawning. */
	readonly toolInvocations: number;
	/** Maximum model/tool loop iterations funded by this allocation. */
	readonly loopIterations: number;
	/** Maximum model spend in millionths of a US dollar. */
	readonly costMicros: bigint;
}

/**
 * Initializes accounting for an already admitted root run inside its caller's transaction.
 * The caller must verify current IAM authority and the run's saved input snapshot. This is a
 * backend command, not authority supplied by a browser or model; snapshot limits are read by the
 * repository rather than accepted here.
 */
export interface RunTreeRootCommand
{
	/** Restricts the admitted run lookup to the current silo. */
	readonly siloId: string;
	/** Identifies the admitted root run. */
	readonly runId: string;
	/** Deduplicates this admission within the root tree. */
	readonly admissionKey: string;
	/** Supplies the trusted server cost ceiling; the repository intersects it with the frozen revision cap. */
	readonly effectiveCostCapMicros: bigint;
}

/**
 * Transfers part of a parent's remaining allowance to its already admitted child.
 * The caller must join this command to current Delegate authorization and narrowed child snapshot
 * admission in the same transaction. These fields do not confer permission or choose child inputs.
 */
export interface RunTreeChildCommand
{
	/** Restricts both run lookups to the current silo. */
	readonly siloId: string;
	/** Identifies the existing parent whose allowance funds the child. */
	readonly parentRunId: string;
	/** Identifies the admitted child run; it cannot be its own parent. */
	readonly runId: string;
	/** Deduplicates this child admission within the root tree. */
	readonly admissionKey: string;
	/** Moves these allowances from the parent; it never creates a fresh root allowance. */
	readonly resources: RunTreeResources;
	/** Must equal the child's saved deadline and cannot outlive its parent. */
	readonly deadlineAt: Date;
}

/**
 * Reserves spending authority before a credential or external effect is admitted.
 * The caller must check current IAM authority and saved inputs in the same transaction. A saved
 * reservation is not permission to dispatch, and replay must not create or refund an allowance.
 */
export interface RunTreeReservationCommand
{
	/** Restricts the run lookup to the current silo. */
	readonly siloId: string;
	/** Identifies the run whose remaining allowance funds local work. */
	readonly runId: string;
	/** Identifies the saved spending reservation. */
	readonly reservationId: string;
	/** Deduplicates the request within this run. */
	readonly idempotencyKey: string;
	/** Permanently removes these allowances from the run's available balance. */
	readonly resources: RunTreeResources;
}

/**
 * Closes a branch to new children and spending reservations without claiming cleanup is complete.
 * The caller must supply a current authorized Stop or verified terminal/deadline evidence for the
 * source run. A model or browser cannot manufacture that authority by supplying these fields.
 */
export interface RunTreeCloseCommand
{
	/** Restricts the target and closure source to the current silo. */
	readonly siloId: string;
	/** Identifies the branch that stops accepting new work. */
	readonly runId: string;
	/** Identifies this run or its ancestor whose verified closure applies to this branch. */
	readonly sourceRunId: string;
	/** Records why admission closed; it never asserts that providers or workflows have stopped. */
	readonly reason: RunTreeClosureReasons;
}

/** Saved run accounting; available balances exclude child allocations and local reservations. */
export interface RunTreeAccount
{
	/** Identifies the run whose allowances are recorded. */
	readonly runId: string;
	/** Identifies the original run that funded the complete tree. */
	readonly rootRunId: string;
	/** Identifies the direct parent, or null for the root. */
	readonly parentRunId: string | null;
	/** Records the admission key unique within this tree. */
	readonly admissionKey: string;
	/** Binds the admission key to the complete validated command. */
	readonly admissionDigest: string;
	/** Records the run's frozen absolute deadline. */
	readonly deadlineAt: Date;
	/** Records the model calls allocated when this account was created. */
	readonly allocatedModelCalls: number;
	/** Records the generated tokens allocated when this account was created. */
	readonly allocatedCompletionTokens: number;
	/** Records the external tool invocations allocated when this account was created. */
	readonly allocatedToolInvocations: number;
	/** Records the loop iterations allocated when this account was created. */
	readonly allocatedLoopIterations: number;
	/** Records the maximum spend allocated when this account was created. */
	readonly allocatedCostMicros: bigint;
	/** Records model calls not yet reserved or allocated to children. */
	readonly availableModelCalls: number;
	/** Records generated tokens not yet reserved or allocated to children. */
	readonly availableCompletionTokens: number;
	/** Records external tool invocations not yet reserved or allocated to children. */
	readonly availableToolInvocations: number;
	/** Records loop iterations not yet reserved or allocated to children. */
	readonly availableLoopIterations: number;
	/** Records spend not yet reserved or allocated to children. */
	readonly availableCostMicros: bigint;
	/** Advances on balance or closure changes; the root also advances to serialize work elsewhere in its tree. */
	readonly revision: number;
	/** Records this account's closure time; null does not prove that its ancestors still accept work. */
	readonly closedAt: Date | null;
	/** Identifies the verified closure source, or null before closure. */
	readonly closureSourceRunId: string | null;
	/** Records the cause of closure, or null before closure. */
	readonly closureReason: RunTreeClosureReasons | null;
}

/** Saved spending receipt; issuing work again requires its independent dispatch authority. */
export interface RunTreeReservation extends RunTreeResources
{
	/** Identifies this spending reservation. */
	readonly id: string;
	/** Identifies the run that funded the reservation. */
	readonly runId: string;
	/** Deduplicates the request within the run. */
	readonly idempotencyKey: string;
	/** Binds the saved reservation to the complete validated command. */
	readonly commandDigest: string;
	/** Records database time when the allowance was removed from the available balance. */
	readonly createdAt: Date;
}

/**
 * Owns run-tree accounting inside the authorized caller's existing transaction.
 *
 * The caller must check current permissions and commit child creation, its frozen input, allocation
 * and workflow receipt in the same Serializable transaction. Implementations serialize allocation,
 * reservation and closure through the tree root; new allocations and reservations check every
 * ancestor's eligibility. No method grants IAM access or issues credentials.
 *
 * After a serialization or insert conflict, any retry must restart the whole caller transaction;
 * catching the error and continuing inside that transaction cannot recover it. Matching admission
 * and reservation retries return saved records, even after closure, without spending twice or
 * authorizing another effect. Reusing their keys for changed commands throws instead. Available
 * balances are never refunded, including after uncertain provider outcomes or process restarts.
 * There is no depth, child-count or concurrency cap.
 */
export interface RunTreeRepository
{
	/** Creates root accounting from its frozen snapshot, or returns the matching saved admission. */
	initializeRoot(command: RunTreeRootCommand): Promise<RunTreeAccount>;
	/** Atomically transfers a parent's remaining allowance to a child, or returns its matching admission. */
	allocateChild(command: RunTreeChildCommand): Promise<RunTreeAccount>;
	/** Permanently reserves local spending, or returns the matching receipt without another debit. */
	reserve(command: RunTreeReservationCommand): Promise<RunTreeReservation>;
	/** Closes admission, not cleanup; a retry returns the saved closure or throws if its source or reason changed. */
	close(command: RunTreeCloseCommand): Promise<RunTreeAccount>;
	/** Returns accounting in the specified silo, or null; callers must still verify current read permission. */
	read(siloId: string, runId: string): Promise<RunTreeAccount | null>;
}
