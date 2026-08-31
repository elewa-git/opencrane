import type { Request } from "express";

/** Authenticated product identity allowed to start a validation in its own silo. */
export interface SkillAuthoringValidationSubmissionCaller
{
	/** Silo derived from the verified session and request host. */
	readonly siloId: string;
	/** Local Principal derived from the verified session and required to own the selected skill. */
	readonly principalId: string;
}

/** Reports that the authenticated Principal does not own the selected skill revision. */
export class SkillAuthoringValidationSubmissionForbiddenError extends Error
{
	/** Creates the non-disclosing permission failure returned as HTTP 403. */
	constructor()
	{
		super("skill authoring validation requires ownership of the selected skill");
		this.name = "SkillAuthoringValidationSubmissionForbiddenError";
	}
}

/** Result returned after the validation and its Absurd task receipt commit together. */
export interface SkillAuthoringValidationSubmission
{
	/** Stable validation identifier used by status and worker authorities. */
	readonly validationId: string;
	/** Stable Absurd task identifier bound to the validation. */
	readonly taskId: string;
}

/** Product authority that starts one Draft Python skill validation. */
export interface SkillAuthoringValidationSubmissionAuthority
{
	/** Saves or reloads the validation and task for the exact Draft revision. */
	submit(caller: SkillAuthoringValidationSubmissionCaller, skillRevisionId: string): Promise<SkillAuthoringValidationSubmission>;
}

/** Resolves an authenticated request without accepting silo data from its body. */
export type SkillAuthoringValidationSubmissionCallerResolver = (request: Request) => SkillAuthoringValidationSubmissionCaller | null;

/** Minimal structured logger used by the authenticated validation route. */
export interface SkillAuthoringValidationSubmissionLogger
{
	/** Records an internal admission failure without artifact or worker data. */
	error(bindings: { readonly err: unknown; readonly operation: string; readonly siloId?: string }, message: string): void;
}

/** Dependencies of the authenticated validation submission route. */
export interface SkillAuthoringValidationSubmissionRouterDependencies
{
	/** Resolves the caller from the trusted session. */
	readonly resolveCaller: SkillAuthoringValidationSubmissionCallerResolver;
	/** Commits the validation and remote task together. */
	readonly authority: SkillAuthoringValidationSubmissionAuthority;
	/** Records unavailable authority failures. */
	readonly logger: SkillAuthoringValidationSubmissionLogger;
}
