import type { RuntimeTokenReviewer, RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";

/** Stable outcomes accepted from the isolated Python validation Job. */
export enum SkillAuthoringValidationWorkerOutcomes
{
	/** The Job completed every fixed test and scan successfully. */
	Succeeded = "succeeded",
	/** The Job could not produce passing validation evidence. */
	Failed = "failed",
}

/** One bounded test or scan report produced by the isolated validation Job. */
export interface SkillAuthoringValidationCheckReport
{
	/** Says whether every check represented by this report passed. */
	readonly passed: true;
	/** Gives a short human-readable summary without command output or local paths. */
	readonly summary: string;
	/** Counts the individual checks represented by the report. */
	readonly checksRun: number;
}

/** Exact terminal command accepted from one bound validation Pod. */
export type SkillAuthoringValidationWorkerCompletion =
	| {
		/** Validation identifier returned after the one-use bootstrap. */
		readonly validationId: string;
		/** Marks a successful validation with both required reports. */
		readonly outcome: SkillAuthoringValidationWorkerOutcomes.Succeeded;
		/** Test evidence copied to the exact Draft skill revision. */
		readonly testReport: SkillAuthoringValidationCheckReport;
		/** Scan evidence copied to the exact Draft skill revision. */
		readonly scanResult: SkillAuthoringValidationCheckReport;
	}
	| {
		/** Validation identifier returned after the one-use bootstrap. */
		readonly validationId: string;
		/** Marks a failed validation without exposing raw worker output. */
		readonly outcome: SkillAuthoringValidationWorkerOutcomes.Failed;
		/** Stable bounded reason stored with the failed validation. */
		readonly failureCode: string;
	};

/** Worker identity and receipt facts loaded before Kubernetes TokenReview. */
export interface SkillAuthoringValidationBootstrapRecord
{
	/** Validation selected by the opaque reference hash. */
	readonly validationId: string;
	/** Namespace fixed when the controller bound the Job. */
	readonly namespace: string;
	/** ServiceAccount fixed for the authoring-validation workload class. */
	readonly serviceAccountName: string;
	/** First Pod UID saved before the Job was released. */
	readonly podUid: string;
}

/** Immutable artifact facts the server may stream to the bound validation Pod. */
export interface SkillAuthoringValidationInput
{
	/** Silo that owns the Draft skill and artifact. */
	readonly siloId: string;
	/** Artifact catalogue identifier that owns the selected revision. */
	readonly artifactId: string;
	/** Exact published artifact revision selected by the Draft skill. */
	readonly artifactRevisionId: string;
	/** Canonical SHA-256 address pinned on the Draft skill revision. */
	readonly contentAddress: string;
	/** Exact byte count the stream must preserve. */
	readonly byteLength: number;
	/** Immutable media type returned with the stream. */
	readonly mediaType: string;
}

/** Reads exact published artifact bytes without exposing a storage lease to the worker. */
export interface SkillAuthoringValidationArtifactReader
{
	/** Opens the immutable artifact selected by the server authority. */
	read(input: SkillAuthoringValidationInput): Promise<ReadableStream<Uint8Array>>;
}

/** Database authority behind the worker-only validation protocol. */
export interface SkillAuthoringValidationWorkerAuthority
{
	/** Loads the identity expected by one unused, unexpired bootstrap hash. */
	loadBootstrap(referenceHash: string): Promise<SkillAuthoringValidationBootstrapRecord | null>;
	/** Consumes the bootstrap only for the exact TokenReview-confirmed Pod. */
	consumeBootstrap(referenceHash: string, identity: RuntimeWorkloadIdentity): Promise<"consumed" | "conflict">;
	/** Loads the immutable artifact only for the Pod that consumed this validation bootstrap. */
	loadInput(validationId: string, identity: RuntimeWorkloadIdentity): Promise<SkillAuthoringValidationInput | null>;
	/** Saves one completion for the task's recovery heartbeat. */
	complete(command: SkillAuthoringValidationWorkerCompletion, identity: RuntimeWorkloadIdentity): Promise<"completed" | "idempotent" | "conflict">;
}

/** Minimal structured logger for the worker-only validation routes. */
export interface SkillAuthoringValidationWorkerLogger
{
	/** Records an internal failure without worker tokens, references, or artifact content. */
	error(bindings: { readonly err: unknown; readonly operation: string }, message: string): void;
}

/** Dependencies of the worker-only validation protocol router. */
export interface SkillAuthoringValidationWorkerRouterDependencies
{
	/** Reviews only the fixed authoring audience, namespace, ServiceAccount, and bound Pod UID. */
	readonly tokenReviewer: RuntimeTokenReviewer;
	/** Applies the one-use bootstrap, input, and completion database rules. */
	readonly authority: SkillAuthoringValidationWorkerAuthority;
	/** Streams verified published bytes after the database authority admits the Pod. */
	readonly artifactReader: SkillAuthoringValidationArtifactReader;
	/** Records authority and streaming failures without credential data. */
	readonly logger: SkillAuthoringValidationWorkerLogger;
}
