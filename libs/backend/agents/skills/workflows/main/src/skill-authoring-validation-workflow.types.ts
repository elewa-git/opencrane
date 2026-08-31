import type { SkillAuthoringValidationTaskInput } from "@opencrane/backend/agents/skills/workflows/contract";
import type { IWorkflowTaskReceipt, IWorkflowTransaction } from "@opencrane/backend/server/infra/workflows/contract";

/**
 * States why the repository refused to admit an authoring validation.
 *
 * {@link __AdmitSkillAuthoringValidation} throws before it saves a remote task for every member, so
 * callers must treat each value as a rejected product change rather than a retryable task outcome.
 */
export enum SkillAuthoringValidationAdmissionRejectionReasons
{
	/** The selected revision is not owned by the command's silo. */
	ForeignSilo = "foreign_silo",
	/** The selected revision is no longer a Draft. */
	NotDraft = "not_draft",
	/** The selected revision is not the supported Python trust class. */
	UnsupportedTrustClass = "unsupported_trust_class",
	/** The selected artifact revision is no longer the pinned active artifact. */
	ArtifactNotPinned = "artifact_not_pinned",
	/** A prior validation at these coordinates contains different immutable task facts. */
	ConflictingValidation = "conflicting_validation",
}

/**
 * Identifies the immutable skill and artifact coordinates a caller asks the server to validate.
 *
 * The repository must recheck these facts in the caller-owned transaction before it can save a
 * remote task; the command carries no artifact bytes or credentials.
 */
export interface SkillAuthoringValidationAdmissionCommand
{
	/** Silo that owns every selected coordinate and the task that will be saved. */
	readonly siloId: string;
	/** Draft skill revision selected for the Python authoring Job. */
	readonly skillRevisionId: string;
	/** Active artifact revision pinned by that skill revision. */
	readonly artifactRevisionId: string;
	/** Content address that proves the artifact bytes did not change after admission. */
	readonly artifactContentAddress: string;
}

/**
 * Carries the validation facts the repository returned after it rechecked immutable coordinates.
 *
 * The admission function compares them with the caller command before it saves a task, so a retry
 * can reuse a matching validation but cannot bind different skill or artifact facts to it.
 */
export interface SkillAuthoringValidationRecord
{
	/** Stable validation record created or found inside the caller's database transaction. */
	readonly validationId: string;
	/** Silo that owns the validation and its selected revision. */
	readonly siloId: string;
	/** Draft Python revision whose artifact may run in the isolated Job. */
	readonly skillRevisionId: string;
	/** Artifact revision that stays pinned for this validation. */
	readonly artifactRevisionId: string;
	/** Content address that stays pinned for this validation. */
	readonly artifactContentAddress: string;
	/** Domain-derived digest that makes task admission idempotent at these exact coordinates. */
	readonly taskKey: string;
}

/**
 * Returns either the validation record that may be admitted or the reason the repository refused it.
 *
 * The admission function must not see both outcomes as success: an absent record stops task saving
 * before workflow admission begins.
 */
export interface SkillAuthoringValidationResolution
{
	/** Record that may be admitted when the repository revalidated every immutable coordinate. */
	readonly record?: SkillAuthoringValidationRecord;
	/** Reason admission stopped before any workflow task was saved. */
	readonly rejectionReason?: SkillAuthoringValidationAdmissionRejectionReasons;
}

/**
 * Defines the repository operations the application adapter will bind to its database transaction.
 *
 * This initial slice declares the port but ships no schema or adapter. Its implementation must make
 * validation creation, task binding, and the caller transaction share the same commit decision.
 */
export interface SkillAuthoringValidationRepository
{
	/** Create or find a validation after checking same-silo Draft Python and pinned-artifact facts. */
	createOrFind(command: SkillAuthoringValidationAdmissionCommand): Promise<SkillAuthoringValidationResolution>;
	/** Bind the receipt returned by task admission, or reject a receipt that conflicts with saved facts. */
	bindTask(record: SkillAuthoringValidationRecord, receipt: IWorkflowTaskReceipt): Promise<"bound" | "idempotent" | "conflict">;
}

/**
 * Supplies the transaction that both the repository and workflow engine must share.
 *
 * Passing both ports through this object prevents the task receipt from committing when its product
 * validation rolls back, or vice versa.
 */
export interface SkillAuthoringValidationAdmissionTransaction
{
	/** Opaque transaction passed unchanged to workflow admission. */
	readonly workflowTransaction: IWorkflowTransaction;
	/** Repository already constructed against the same caller-owned database transaction. */
	readonly validations: SkillAuthoringValidationRepository;
}

/**
 * Returns the validation and workflow receipt after one atomic admission.
 *
 * A caller receives this result only after the repository accepted the immutable coordinates and
 * bound the receipt; any rejection instead aborts its transaction.
 */
export interface SkillAuthoringValidationAdmission
{
	/** Validation record that owns the task and immutable skill coordinates. */
	readonly validation: SkillAuthoringValidationRecord;
	/** Receipt saved onto that validation before the caller may commit its transaction. */
	readonly receipt: IWorkflowTaskReceipt;
}

/** Reports an invalid repository decision or workflow receipt so the caller's transaction rolls back. */
export class SkillAuthoringValidationAdmissionError extends Error
{
	/** Creates an admission error with the persisted or protocol reason that stopped the transaction. */
	constructor(message: string)
	{
		super(message);
		this.name = "SkillAuthoringValidationAdmissionError";
	}
}
