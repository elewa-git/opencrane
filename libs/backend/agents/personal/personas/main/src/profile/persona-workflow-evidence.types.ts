/** The signed-in owner, taken from the session. */
export interface PersonaWorkflowOwner
{
	/** Host-selected organisation silo. */
	readonly siloId: string;
	/** Stable authenticated subject. */
	readonly subjectId: string;
}

/** Identifies an approved persona revision and the interview behind it, with none of the persona's content. */
export interface PersonaWorkflowApprovedEvidence
{
	/** Interview that produced the revision. */
	readonly interviewId: string;
	/** Approved immutable revision. */
	readonly personaRevisionId: string;
}

/**
 * The primary colours this package exposes to code outside it.
 *
 * It exists so callers never import Prisma's `PersonaColour`. The app maps these values onto its own
 * onboarding colours, which means the database enum can be renamed without touching anything outside
 * this package.
 *
 * Called by: `apps/opencrane/src/app/user-onboarding-composition.ts`, which converts each value to
 * `UserOnboardingPersonaColours`. Produced by `_WorkflowColour` in prisma-persona-workflow-evidence.ts.
 *
 * @see PersonaWorkflowApprovedBootstrapEvidence
 */
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

/** What an approved persona may show elsewhere: its id, name, and colour. No instructions and no scores. */
export interface PersonaWorkflowApprovedBootstrapEvidence
{
	/** Exact immutable approved persona revision. */
	readonly personaRevisionId: string;
	/** Reviewed owner-visible soul-template name. */
	readonly displayName: string;
	/** The revision's primary colour, converted from Prisma's enum. */
	readonly primaryColour: PersonaWorkflowColours;
}

/**
 * The read-only persona lookups the user-onboarding workflow is allowed to make.
 *
 * Onboarding needs to check a persona exists and show its name and colour, but it must not see the
 * compiled instructions or the raw scores. This port is the whole of what leaves the package, which is
 * why it returns ids, a display name and a colour and nothing else.
 *
 * Every method filters on the owner's silo and subject, so a `null` means "not visible to this owner"
 * and never distinguishes a missing row from someone else's row. Callers must not report the two
 * differently.
 *
 * Called by: `_CreateUserOnboardingPersonaEvidence` in
 * `apps/opencrane/src/app/user-onboarding-composition.ts`. Built by
 * {@link _CreatePersonaWorkflowEvidenceRepository}; implemented by
 * `PrismaPersonaWorkflowEvidenceRepository`.
 *
 * @see PersonaWorkflowColours
 */
export interface PersonaWorkflowEvidenceRepository
{
	/**
	 * Returns whether this interview belongs to the given owner.
	 *
	 * @param owner - Silo and subject from the session.
	 * @param interviewId - Interview to check.
	 * @returns `true` only when the interview and its profile both belong to this owner.
	 */
	ownsInterview(owner: PersonaWorkflowOwner, interviewId: string): Promise<boolean>;
	/**
	 * Confirms one approved revision belongs to this owner and came from this interview.
	 *
	 * @param owner - Silo and subject from the session.
	 * @param evidence - The interview and revision ids to confirm.
	 * @returns The same pair when it checks out; `null` when the revision is not approved, not from that
	 * interview, or not this owner's.
	 */
	readApprovedPersona(owner: PersonaWorkflowOwner, evidence: PersonaWorkflowApprovedEvidence): Promise<PersonaWorkflowApprovedEvidence | null>;
	/**
	 * Returns the most recently approved revision for this owner's interview.
	 *
	 * @param owner - Silo and subject from the session.
	 * @param interviewId - Interview whose approved revisions are searched.
	 * @returns The newest approved revision by approval time, then revision number; `null` when the
	 * interview has no approved revision visible to this owner.
	 */
	readLatestApprovedPersona(owner: PersonaWorkflowOwner, interviewId: string): Promise<PersonaWorkflowApprovedEvidence | null>;
	/**
	 * Reads the name and colour of one approved revision, for display during onboarding.
	 *
	 * @param owner - Silo and subject from the session.
	 * @param personaRevisionId - The approved revision to describe.
	 * @returns The revision id, its SOUL template's display name, and its primary colour; `null` when
	 * the revision is not approved or not visible to this owner. Never includes instructions or scores.
	 */
	readApprovedBootstrapEvidence(owner: PersonaWorkflowOwner, personaRevisionId: string): Promise<PersonaWorkflowApprovedBootstrapEvidence | null>;
}
