import type { SkillAuthoringValidationControllerAuthority } from "@opencrane/backend/agents/skills/workflows/contract";

/**
 * Describes the reviewed Kubernetes identity visible to the validation controller boundary.
 *
 * The router compares every field with its configured controller identity before it calls the
 * validation authority.
 */
export interface SkillAuthoringValidationControllerIdentity
{
	/** Exact Kubernetes username returned by TokenReview. */
	readonly username: string;
	/** Namespace returned by the reviewed ServiceAccount subject. */
	readonly namespace: string;
	/** ServiceAccount name returned by TokenReview. */
	readonly serviceAccountName: string;
	/** Audiences accepted by the Kubernetes API server. */
	readonly audiences: readonly string[];
}

/** Reviews the projected token held by the controller that reconciles validations. */
export interface SkillAuthoringValidationControllerTokenReviewer
{
	/**
	 * Reviews one projected controller token.
	 *
	 * Called by: `__CreateSkillAuthoringValidationControllerRouter` before every authority call.
	 * @param token - Bearer token extracted from the controller request.
	 * @returns The reviewed identity, or `null` when TokenReview rejects it.
	 */
	__Review(token: string): Promise<SkillAuthoringValidationControllerIdentity | null>;
}

/** Receives controller API failures without bearer tokens or request bodies. */
export interface SkillAuthoringValidationControllerRouterLogger
{
	/** Records one safe operation name and its error. */
	error(bindings: { readonly err: unknown; readonly operation: string }, message: string): void;
}

/**
 * Supplies the boundaries needed by the controller-only validation API.
 *
 * Called by: OpenCrane's internal runtime composition when it mounts the controller route.
 */
export interface SkillAuthoringValidationControllerRouterDependencies
{
	/** Reviewer fixed to the sole agent-controller identity. */
	readonly tokenReviewer: SkillAuthoringValidationControllerTokenReviewer;
	/** Namespace containing the trusted agent-controller ServiceAccount. */
	readonly namespace: string;
	/** Namespace fixed by the deployed authoring profile, which the controller may not replace. */
	readonly authoringNamespace: string;
	/** Task-fenced server authority for validation lifecycle changes. */
	readonly authority: SkillAuthoringValidationControllerAuthority;
	/** Structured process logger for unavailable-authority failures. */
	readonly logger: SkillAuthoringValidationControllerRouterLogger;
}
