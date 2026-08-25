import type { Router } from "express";

import type { IWorkflowTaskEvent, IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

/** Identifies the Pod Kubernetes authenticated for one authoring-worker request. */
export interface SkillAuthoringValidationWorkerIdentity
{
	/** Names the namespace Kubernetes reported for the projected ServiceAccount token. */
	readonly namespace: string;
	/** Names the ServiceAccount Kubernetes reported for the projected token. */
	readonly serviceAccountName: string;
	/** Names the immutable Pod UID Kubernetes bound into the token. */
	readonly podUid: string;
}

/** Reviews a worker token for the fixed authoring audience. */
export interface SkillAuthoringValidationWorkerTokenReviewer
{
	/** Returns the Kubernetes-confirmed worker identity, or null when the token is denied. */
	__Review(token: string, audience: string): Promise<SkillAuthoringValidationWorkerIdentity | null>;
}

/**
 * Describes the immutable artifact revision that an authenticated authoring Pod may read.
 *
 * The input contains identifying facts rather than artifact bytes, so the route can broker the
 * selected revision without giving the worker a storage credential. Called by:
 * `__CreateSkillAuthoringValidationWorkerRouter`.
 */
export interface SkillAuthoringValidationInput
{
	/** Silo that owns the selected artifact revision. */
	readonly siloId: string;
	/** Artifact selected by the saved validation. */
	readonly artifactId: string;
	/** Published artifact revision that the route streams. */
	readonly artifactRevisionId: string;
	/** SHA-256 content address the worker verifies while downloading. */
	readonly contentAddress: string;
	/** Exact response size the route sends as Content-Length. */
	readonly byteLength: number;
	/** Media type the route sends with the artifact stream. */
	readonly mediaType: string;
}

/** Streams server-authorised immutable artifact bytes without giving the worker a storage credential. */
export interface SkillAuthoringValidationArtifactReader
{
	/** Returns the exact bytes described by the previously authorised input record. */
	read(input: SkillAuthoringValidationInput): Promise<ReadableStream<Uint8Array>>;
}

/**
 * Carries the terminal result that an authoring validation worker may submit.
 *
 * The worker route accepts this closed pair of shapes: `succeeded` includes bounded test and scan
 * reports, while `failed` carries a stable failure code instead of candidate output. The authority
 * persists the result before it wakes the remote workflow, so callers cannot add another outcome
 * without changing both the worker route and saved completion data.
 */
export type SkillAuthoringValidationWorkerCompletion =
	| { readonly validationId: string; readonly outcome: "succeeded"; readonly testReport: { readonly passed: boolean; readonly summary: string; readonly checksRun: number }; readonly scanResult: { readonly passed: boolean; readonly summary: string; readonly checksRun: number } }
	| { readonly validationId: string; readonly outcome: "failed"; readonly failureCode: string };

/**
 * Carries the persisted completion event that wakes the remote task.
 *
 * The worker route emits this event after storing completion data, and the background publisher can
 * retry the same event after the Pod exits. A caller marks it published only after the workflow
 * engine accepts it.
 */
export interface SkillAuthoringValidationCompletionEvent
{
	/** Receipt for the remote task that waits for this completion. */
	readonly task: IWorkflowTaskReceipt;
	/** Event name and immutable completion identity delivered to that task. */
	readonly event: IWorkflowTaskEvent<{ readonly validationId: string; readonly completionDigest: string }>;
}

/**
 * Owns the server-side state changes that an authenticated authoring worker may request.
 *
 * Bootstrap consumption binds the worker's Pod before it can read input or persist a completion.
 * A missing result makes the route return 409, while a returned event has already been stored and
 * may be sent to the remote task. Called by: `__CreateSkillAuthoringValidationWorkerRouter`.
 */
export interface SkillAuthoringValidationWorkerAuthority
{
	/** Spends an unexpired bootstrap reference for its exact bound Pod and returns the validation it owns. */
	consumeBootstrap(referenceHash: string, identity: SkillAuthoringValidationWorkerIdentity): Promise<string | null>;
	/** Loads the one immutable draft artifact the exact bound Pod may read. */
	loadInput(validationId: string, identity: SkillAuthoringValidationWorkerIdentity): Promise<SkillAuthoringValidationInput | null>;
	/** Saves an idempotent terminal completion and returns the event that wakes its remote task. */
	complete(command: SkillAuthoringValidationWorkerCompletion, identity: SkillAuthoringValidationWorkerIdentity): Promise<SkillAuthoringValidationCompletionEvent | null>;
	/** Marks one already-emitted event as published without changing its immutable completion facts. */
	markEventPublished(event: SkillAuthoringValidationCompletionEvent): Promise<void>;
}

/** Receives worker-authority failures without request credentials or candidate bytes. */
export interface SkillAuthoringValidationWorkerLogger
{
	/** Writes a structured internal failure. */
	error(bindings: { readonly err: unknown; readonly operation: string }, message: string): void;
}

/**
 * Supplies the boundaries shared by the worker-authenticated validation routes.
 *
 * Separating token review, database authority, artifact reads, and event delivery keeps the HTTP
 * router from selecting an artifact or writing completion state itself. Called by:
 * `_CreateSkillAuthoringValidationRuntimeComposition`.
 */
export interface SkillAuthoringValidationWorkerRouterDependencies
{
	/** Reviews the projected authoring-Pod token. */
	readonly tokenReviewer: SkillAuthoringValidationWorkerTokenReviewer;
	/** Checks bootstrap, input, and completion ownership in the server database. */
	readonly authority: SkillAuthoringValidationWorkerAuthority;
	/** Streams the previously authorised immutable artifact revision. */
	readonly artifactReader: SkillAuthoringValidationArtifactReader;
	/** Delivers a persisted completion event to the workflow engine. */
	emitEvent(event: SkillAuthoringValidationCompletionEvent): Promise<void>;
	/** Receives failures without credentials or candidate bytes. */
	readonly logger: SkillAuthoringValidationWorkerLogger;
}

/** Builds the validation-native worker API. */
export type CreateSkillAuthoringValidationWorkerRouter = (dependencies: SkillAuthoringValidationWorkerRouterDependencies) => Router;
