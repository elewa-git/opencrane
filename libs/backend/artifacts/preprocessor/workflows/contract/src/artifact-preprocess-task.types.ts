import { WorkflowTaskRetryBackoffKinds } from "@opencrane/backend/server/infra/workflows/contract";
import type { IWorkflowTaskDeclaration } from "@opencrane/backend/server/infra/workflows/contract";

/**
 * Lists the pipeline versions stored with preprocessing jobs and derived artifact revisions.
 *
 * Server admission writes these values and the controller checks them before binding or completing
 * work, so changing a serialized value requires a matching database migration and controller update.
 */
export const ArtifactPreprocessPipelineVersions = {
	/** Converts one published PDF into a derived plain-text artifact. */
	PdfToText: "pdf-to-text/v1",
} as const;

/**
 * Names the remote tasks that the server may save and the controller may run.
 *
 * The HTTP receipt parser and task declaration both use this value, so an unknown task name is
 * rejected instead of being bound to a PDF preprocessing record.
 */
export const ArtifactPreprocessTaskNames = {
	/** Runs one isolated PDF converter and saves its derived text. */
	Convert: `artifacts.preprocess.${ArtifactPreprocessPipelineVersions.PdfToText}`,
} as const;

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
 * Its retry policy stays beside the task name, so server admission and controller registration use
 * the same task definition.
 *
 * @see ArtifactPreprocessTaskNames for the task name this declaration fixes.
 */
export const ArtifactPreprocessTaskDeclaration = {
	taskName: ArtifactPreprocessTaskNames.Convert,
	retryPolicy: { maximumAttempts: 3, backoff: { kind: WorkflowTaskRetryBackoffKinds.Exponential, initialDelaySeconds: 30, multiplier: 2, maximumDelaySeconds: 300 } },
} as const satisfies IWorkflowTaskDeclaration;
