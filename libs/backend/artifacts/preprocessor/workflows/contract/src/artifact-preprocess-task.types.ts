import { WorkflowTaskRetryBackoffKinds } from "@opencrane/backend/server/infra/workflows/contract";
import type { IWorkflowTaskDeclaration } from "@opencrane/backend/server/infra/workflows/contract";

/**
 * Names the remote task that converts one already-published PDF into plain text.
 *
 * Server admission and controller registration use this shared value, so they cannot schedule a
 * different task for the saved preprocessing job. The contract currently has one member; callers
 * must treat another task name as unsupported.
 */
export enum ArtifactPreprocessTaskNames
{
	/** Runs one isolated PDF converter and saves its derived text. */
	Convert = "artifacts.preprocess.pdf-to-text/v1",
}

/**
 * Identifies a saved preprocessing task without carrying PDF bytes or storage credentials.
 *
 * The controller uses these identifiers to reload server-owned source and output state before it
 * starts the isolated worker. The input deliberately cannot select another artifact or transport
 * bytes across the workflow boundary.
 */
export interface ArtifactPreprocessTaskInput
{
	/** Silo that owns both the published PDF and the saved preprocessing task. */
	readonly siloId: string;
	/** Stable artifact-domain record that binds this task to one source revision. */
	readonly preprocessJobId: string;
}

/**
 * Defines the declaration that server admission saves and the controller handler registers.
 *
 * Its retry policy stays beside the task name, so future server admission and controller
 * registration use the same task definition. A future composition must use this declaration for
 * both operations.
 *
 * @see ArtifactPreprocessTaskNames for the task name this declaration fixes.
 */
export const ArtifactPreprocessTaskDeclaration = {
	taskName: ArtifactPreprocessTaskNames.Convert,
	retryPolicy: { maximumAttempts: 3, backoff: { kind: WorkflowTaskRetryBackoffKinds.Exponential, initialDelaySeconds: 30, multiplier: 2, maximumDelaySeconds: 300 } },
} as const satisfies IWorkflowTaskDeclaration;
