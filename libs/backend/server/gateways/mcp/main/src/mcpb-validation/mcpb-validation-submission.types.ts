import type { McpbValidationRecord } from "./mcpb-validation-repository.types";
import type { McpbBundleArtifactTarget } from "./mcpb-validation.types";

/** Resolves caller-supplied artifact coordinates through the artifact catalogue authority. */
export interface McpbBundleArtifactResolver
{
	/**
	 * Finds one active published revision inside the authenticated silo.
	 *
	 * @param siloId - Silo derived from the authenticated request.
	 * @param artifactId - Artifact identifier supplied by the administrator.
	 * @param artifactRevisionId - Exact immutable revision to verify.
	 * @returns Trusted artifact facts, or `null` when the coordinates are not readable.
	 */
	resolve(siloId: string, artifactId: string, artifactRevisionId: string): Promise<McpbBundleArtifactTarget | null>;
}

/** Administrator command that submits one published artifact revision for MCPB checks. */
export interface McpbValidationSubmissionCommand
{
	/** Client-generated key that makes a repeated request return the first validation. */
	readonly idempotencyKey: string;
	/** Artifact catalogue identifier inside the authenticated silo. */
	readonly artifactId: string;
	/** Exact immutable artifact revision to verify. */
	readonly artifactRevisionId: string;
}

/** Result categories returned by MCP bundle submission. */
export enum McpbValidationSubmissionOutcomes
{
	/** The request created or returned the same validation and task. */
	Submitted = "submitted",
	/** The idempotency key already belongs to different immutable input. */
	Conflict = "conflict",
	/** The artifact revision was not active, published, or owned by the authenticated silo. */
	ArtifactNotFound = "artifact_not_found",
}

/** Final answer from one MCP bundle submission attempt. */
export type McpbValidationSubmissionResult =
	| { readonly outcome: McpbValidationSubmissionOutcomes.Submitted; readonly validation: McpbValidationRecord }
	| { readonly outcome: McpbValidationSubmissionOutcomes.Conflict | McpbValidationSubmissionOutcomes.ArtifactNotFound };
