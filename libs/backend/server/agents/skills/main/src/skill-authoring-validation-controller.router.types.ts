import type { SkillAuthoringValidationControllerAuthority } from "@opencrane/backend/agents/skills/workflows/contract";

/**
 * Describes the reviewed Kubernetes identity visible to the validation-controller HTTP boundary.
 *
 * The router compares every field with its configured agent-controller identity rather than
 * trusting a request body. A mismatch denies the request before it reaches the authority.
 */
export interface SkillAuthoringValidationControllerIdentity
{
	readonly username: string;
	readonly namespace: string;
	readonly serviceAccountName: string;
	readonly audiences: readonly string[];
}

/**
 * Reviews the projected token held by the controller that reconciles validations.
 *
 * The router checks the returned identity fields against its configured namespace, service account,
 * and audience; `null` denies the request. Called by:
 * `__CreateSkillAuthoringValidationControllerRouter`.
 */
export interface SkillAuthoringValidationControllerTokenReviewer
{
	/**
	 * Reviews the bearer token from the controller request.
	 *
	 * @param token - Projected bearer token extracted from the Authorization header.
	 * @returns The reviewed identity, or `null` when token review rejected it.
	 */
	__Review(token: string): Promise<SkillAuthoringValidationControllerIdentity | null>;
}

/** Receives controller API failures without bearer tokens or request bodies. */
export interface SkillAuthoringValidationControllerRouterLogger
{
	error(bindings: { readonly err: unknown; readonly operation: string }, message: string): void;
}

/**
 * Supplies the boundaries needed by the controller-only validation API.
 *
 * Keeping token review, the fixed authoring namespace, database authority, and logging separate
 * prevents the HTTP layer from widening a controller claim. Called by: OpenCrane's internal runtime
 * composition.
 */
export interface SkillAuthoringValidationControllerRouterDependencies
{
	readonly tokenReviewer: SkillAuthoringValidationControllerTokenReviewer;
	readonly namespace: string;
	/** Namespace fixed by the deployed authoring profile, which the controller may not replace. */
	readonly authoringNamespace: string;
	readonly authority: SkillAuthoringValidationControllerAuthority;
	readonly logger: SkillAuthoringValidationControllerRouterLogger;
}
