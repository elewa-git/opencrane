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

/** Safe approved primary-colour vocabulary projected beyond persona persistence. */
export enum PersonaWorkflowColours
{
	/** Commander source colour. */
	Red = "red",
	/** Catalyst source colour. */
	Yellow = "yellow",
	/** Anchor source colour. */
	Green = "green",
	/** Analyst source colour. */
	Blue = "blue",
}

/** Approved persona display evidence exposed without compiled instructions or scoring internals. */
export interface PersonaWorkflowApprovedBootstrapEvidence
{
	/** Exact immutable approved persona revision. */
	readonly personaRevisionId: string;
	/** Reviewed owner-visible soul-template name. */
	readonly displayName: string;
	/** Prisma-owned colour value projected at the persona boundary. */
	readonly primaryColour: PersonaWorkflowColours;
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
	/** Read safe display and colour evidence for one exact approved owner-bound revision. */
	readApprovedBootstrapEvidence(owner: PersonaWorkflowOwner, personaRevisionId: string): Promise<PersonaWorkflowApprovedBootstrapEvidence | null>;
}
