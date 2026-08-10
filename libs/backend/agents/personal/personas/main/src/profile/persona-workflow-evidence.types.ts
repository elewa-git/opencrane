/** Session-derived owner coordinates used by onboarding orchestration. */
export interface PersonaWorkflowOwner
{
	/** Host-selected organisation silo. */
	readonly siloId: string;
	/** Stable authenticated subject. */
	readonly subjectId: string;
}

/** Exact approved persona coordinates shared without persona content. */
export interface PersonaWorkflowApprovedEvidence
{
	/** Interview that produced the revision. */
	readonly interviewId: string;
	/** Approved immutable revision. */
	readonly personaRevisionId: string;
}

/** Narrow persona-owned evidence port consumed by workflow orchestration. */
export interface PersonaWorkflowEvidenceRepository
{
	/** Confirm the exact interview belongs to the session owner. */
	ownsInterview(owner: PersonaWorkflowOwner, interviewId: string): Promise<boolean>;
	/** Confirm the exact approved revision belongs to the owner and interview. */
	readApprovedPersona(owner: PersonaWorkflowOwner, evidence: PersonaWorkflowApprovedEvidence): Promise<PersonaWorkflowApprovedEvidence | null>;
	/** Return the latest approved revision for the exact owner-bound interview, when one exists. */
	readLatestApprovedPersona(owner: PersonaWorkflowOwner, interviewId: string): Promise<PersonaWorkflowApprovedEvidence | null>;
}
