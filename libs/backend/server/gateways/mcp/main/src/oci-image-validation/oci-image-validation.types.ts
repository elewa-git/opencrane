import type { IWorkflowEngine, IWorkflowTaskReceipt, IWorkflowTransaction } from "@opencrane/backend/server/infra/workflows/contract";

import type { McpOperatorUnitOfWork } from "../core/mcp-operator-repository.types";

/**
 * Selects the OCI Image Layout version this admission path accepts.
 * A different value is rejected before OpenCrane reads any descriptor.
 * @see https://github.com/opencontainers/image-spec/blob/v1.0.1/image-layout.md
 */
export const OCI_IMAGE_LAYOUT_VERSION = "1.0.0" as const;

/** Maximum compressed OCI Image Layout ZIP size read by the OpenCrane server. */
export const OCI_IMAGE_MAXIMUM_BUNDLE_BYTES = 64 * 1024 * 1024;

/** Maximum size of each OCI JSON document or blob read during admission. */
export const OCI_IMAGE_MAXIMUM_DOCUMENT_BYTES = 1024 * 1024;

/**
 * Explains why OpenCrane rejected an OCI image during admission.
 *
 * These values are saved with the OCI image admission record. They describe the uploaded image without
 * copying parser errors, file names, or uploaded layout contents into the database. The database check
 * constraint closes this set, so adding or renaming a value requires a schema change.
 */
export enum OciImageVerificationFailureCodes
{
	/** The stored bytes do not match the immutable artifact revision recorded at admission. */
	ArtifactMismatch = "artifact_mismatch",
	/** The compressed OCI Image Layout ZIP exceeds the server's fixed input limit. */
	BundleTooLarge = "bundle_too_large",
	/** The upload cannot be parsed as a safe ZIP package. */
	MalformedZipPackage = "malformed_zip_package",
	/** The ZIP is readable but does not contain the OCI root files. */
	NotOciImageLayout = "not_oci_image_layout",
	/** The layout root does not declare the supported OCI image-layout version. */
	InvalidLayout = "invalid_layout",
	/** The index does not select exactly one OCI image manifest descriptor. */
	InvalidIndex = "invalid_index",
	/** The selected image manifest or configuration blob is missing, malformed, or has a bad digest. */
	InvalidImageManifest = "invalid_image_manifest",
	/** The server could not finish validation after all workflow attempts. */
	ValidationFailed = "validation_failed",
	/** The checked image could not be copied into the configured registry after all retries. */
	RegistryImportFailed = "registry_import_failed",
}

/**
 * Records whether one OCI image admission still needs work or has a final answer.
 *
 * The MCP repository maps Prisma values into this enum. Absurd keeps its own task attempts and
 * checkpoints; these values are stored in `OciImageValidation.state` and returned by the operator API.
 * `Imported` and `Rejected` are terminal, while `Pending` lets the saved workflow continue. The Prisma
 * enum closes this set, so adding or renaming a value requires a database migration and API review.
 */
export enum OciImageValidationStates
{
	/** The saved background job has not committed a final answer. */
	Pending = "Pending",
	/** The layout passed validation and every referenced blob is available at the saved registry reference. */
	Imported = "Imported",
	/** The exact layout failed a fixed archive, descriptor, digest, artifact, or registry check. */
	Rejected = "Rejected",
}

/**
 * Identifies the OCI admission task registered with the workflow engine.
 *
 * This value is saved with workflow tasks and must continue to route replays to the same handler.
 */
export enum OciImageValidationTaskNames
{
	/** Checks one saved layout, imports it into the registry, and stores the immutable image reference. */
	Import = "oci-image-validation.import",
}

/** Carries the artifact facts that the workflow saves and rechecks before reading an OCI layout. */
export interface OciImageLayoutArtifactTarget
{
	/** Silo that owns both the saved validation and artifact. */
	readonly siloId: string;
	/** Artifact catalogue identifier; it never grants access to the stored bytes. */
	readonly artifactId: string;
	/** Exact published revision selected when the validation was admitted. */
	readonly artifactRevisionId: string;
	/** SHA-256 address rechecked after the bytes are read. */
	readonly contentAddress: string;
	/** Exact compressed byte count rechecked before parsing starts. */
	readonly byteLength: number;
	/** Stored for audit and bound into the submission digest; admission does not interpret it. */
	readonly mediaType: string;
}

/** Reads one authorized immutable artifact without exposing an ArtifactStore lease or URL. */
export interface OciImageLayoutArtifactReader
{
	/**
	 * Opens the exact published revision named by the saved target.
	 *
	 * @param target - Stored silo, artifact, revision, and byte facts.
	 * @returns A stream owned by the caller; the reader never returns storage credentials.
	 */
	read(target: OciImageLayoutArtifactTarget): Promise<ReadableStream<Uint8Array>>;
}

/** Bounded OCI layout identities confirmed before registry import begins. */
export interface OciImageValidatedLayout
{
	/** SHA-256 digest of the exact layout index bytes. */
	readonly indexDigest: string;
	/** Descriptor digest of the single selected OCI image manifest. */
	readonly imageManifestDigest: string;
	/** Descriptor digest of the selected image configuration. */
	readonly configDigest: string;
}

/** Tells the workflow whether layout checks passed or which saved rejection reason applies. */
export type OciImageVerificationResult =
	| { readonly accepted: true; readonly layout: OciImageValidatedLayout }
	| { readonly accepted: false; readonly failureCode: OciImageVerificationFailureCodes };

/** Final OCI admission evidence saved only after registry import succeeds. */
export interface OciImageImportedLayout extends OciImageValidatedLayout
{
	/** Digest-pinned registry coordinate that a class-specific runtime executor may consume. */
	readonly registryReference: string;
}

/** Tells the product layer whether import produced a digest-pinned reference or a saved rejection. */
export type OciImageAdmissionResult =
	| { readonly accepted: true; readonly layout: OciImageImportedLayout }
	| { readonly accepted: false; readonly failureCode: OciImageVerificationFailureCodes };

/** Checks one saved OCI image without owning its workflow or product state. */
export interface OciImageLayoutVerifier
{
	/**
	 * Reads and checks an immutable OCI Image Layout ZIP.
	 *
	 * @param target - Product-owned artifact facts saved with the validation.
	 * @returns Bounded accepted metadata or one stable rejection reason.
	 */
	verify(target: OciImageLayoutArtifactTarget): Promise<OciImageVerificationResult>;
}

/** Imports one fully checked layout into the configured registry. */
export interface OciImageLayoutImporter
{
	/**
	 * Re-reads the immutable artifact, matches the verifier's saved digest evidence, and imports it.
	 *
	 * Called by: the OCI image admission workflow after its validation checkpoint succeeds.
	 *
	 * @param target - Exact saved artifact coordinates and byte identity.
	 * @param expected - Digest evidence returned by the completed validation checkpoint.
	 * @returns The same evidence plus the digest-pinned registry reference.
	 * @throws OciImageImportFailure When the artifact changed or the registry import did not finish.
	 */
	import(target: OciImageLayoutArtifactTarget, expected: OciImageValidatedLayout): Promise<OciImageImportedLayout>;
}

/** Input saved with one OCI image admission task. */
export interface OciImageValidationTaskInput extends OciImageLayoutArtifactTarget
{
	/** Product validation row created in the same database transaction as this task. */
	readonly validationId: string;
	/** Digest that binds the task to every immutable submission field. */
	readonly submissionDigest: string;
}

/** Receipt returned after a layout submission transaction admits its saved job. */
export interface OciImageValidationAdmission
{
	/** Stable key that makes repeated task admission return the same task. */
	readonly taskKey: string;
	/** Engine-neutral receipt for the admitted task. */
	readonly receipt: IWorkflowTaskReceipt;
}

/** Transaction-bound admission API for the OCI image validation and import job. */
export interface OciImageValidationWorkflow
{
	/**
	 * Saves or returns the task through the database transaction that created the validation row.
	 *
	 * @param transaction - Opaque database transaction owned by the caller.
	 * @param input - Immutable validation and artifact facts saved with the task.
	 * @returns Stable task key and engine-neutral receipt.
	 */
	admit(transaction: IWorkflowTransaction, input: OciImageValidationTaskInput): Promise<OciImageValidationAdmission>;
}

/** Dependencies used to register and run the OCI image admission task. */
export interface OciImageValidationWorkflowOptions
{
	/** Engine-neutral workflow engine supplied by the OpenCrane composition root. */
	readonly execution: IWorkflowEngine;
	/** Layout and descriptor checker that reads no database state. */
	readonly verifier: OciImageLayoutVerifier;
	/** Registry importer that runs only after the layout-validation checkpoint succeeds. */
	readonly importer: OciImageLayoutImporter;
	/** MCP database transaction owner used to load and save product state. */
	readonly unitOfWork: McpOperatorUnitOfWork;
}
