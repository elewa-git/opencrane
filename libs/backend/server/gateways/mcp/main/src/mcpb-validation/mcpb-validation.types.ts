import type { IWorkflowEngine, IWorkflowTaskReceipt, IWorkflowTransaction } from "@opencrane/backend/server/infra/workflows/contract";

import type { McpOperatorUnitOfWork } from "../core/mcp-operator-repository.types";

/** The one MCPB manifest format accepted by OpenCrane in the 0.9.3 release. */
export const MCPB_MANIFEST_VERSION = "0.3" as const;

/** Maximum compressed bundle size read by the OpenCrane server. */
export const MCPB_MAXIMUM_BUNDLE_BYTES = 64 * 1024 * 1024;

/** Maximum size of the root `manifest.json` after it is decompressed. */
export const MCPB_MAXIMUM_MANIFEST_BYTES = 1024 * 1024;

/**
 * Stable reasons why OpenCrane can reject an MCP bundle before running it.
 *
 * These values are saved with the bundle validation record. They describe the bundle without
 * copying parser errors, certificate details, file names, or bundle contents into the database.
 */
export enum McpbVerificationFailureCodes
{
	/** The stored bytes do not match the immutable artifact revision recorded at admission. */
	ArtifactMismatch = "artifact_mismatch",
	/** The compressed bundle exceeds the server's fixed input limit. */
	BundleTooLarge = "bundle_too_large",
	/** The file is not a readable ZIP archive with one root manifest. */
	InvalidArchive = "invalid_archive",
	/** The root manifest is not valid JSON or does not follow the pinned MCPB schema. */
	InvalidManifest = "invalid_manifest",
	/** The bundle has no signature from a certificate trusted by the server operating system. */
	InvalidSignature = "invalid_signature",
	/** The root manifest uses an MCPB version that this release does not accept. */
	UnsupportedManifestVersion = "unsupported_manifest_version",
}

/**
 * Product states saved for one MCP bundle check.
 *
 * The MCP repository maps Prisma values into this enum. Absurd keeps its own task attempts and
 * checkpoints; these states only tell an administrator whether the exact bundle passed.
 */
export enum McpbValidationStates
{
	/** The saved background job has not committed a final answer. */
	Pending = "Pending",
	/** The exact bundle has a trusted signature and valid pinned manifest. */
	Verified = "Verified",
	/** The exact bundle failed a fixed manifest, archive, artifact, or signature check. */
	Rejected = "Rejected",
}

/** Stable task names registered for MCP bundle work. */
export enum McpbValidationTaskNames
{
	/** Coordinates the saved package inspection and stores its final product decision. */
	Verify = "mcpb-validation.verify",
	/** Reads one exact bundle revision and checks its signature and archive layout. */
	Inspect = "mcpb-validation.inspect",
}

/** Immutable artifact facts saved before a bundle verification job starts. */
export interface McpbBundleArtifactTarget
{
	/** Silo that owns both the saved validation and artifact. */
	readonly siloId: string;
	/** Artifact catalogue identifier; it never grants access to the stored bytes. */
	readonly artifactId: string;
	/** Exact published revision selected when the validation was admitted. */
	readonly artifactRevisionId: string;
	/** Canonical SHA-256 address rechecked after the bytes are read. */
	readonly contentAddress: string;
	/** Exact compressed byte count rechecked before parsing starts. */
	readonly byteLength: number;
	/** Stored media type kept for audit and later sandbox input checks. */
	readonly mediaType: string;
}

/** Reads one authorized immutable artifact without exposing an ArtifactStore lease or URL. */
export interface McpbBundleArtifactReader
{
	/**
	 * Opens the exact published revision named by the saved target.
	 *
	 * @param target - Stored silo, artifact, revision, and byte facts.
	 * @returns A stream owned by the caller; the reader never returns storage credentials.
	 */
	read(target: McpbBundleArtifactTarget): Promise<ReadableStream<Uint8Array>>;
}

/** Trusted certificate facts returned by the pinned MCPB signature verifier. */
export interface McpbSignatureObservation
{
	/** Says whether the signature chain is trusted, self-signed, or absent or invalid. */
	readonly status: "signed" | "self-signed" | "unsigned";
	/** Certificate common name when the package could read one. */
	readonly publisher?: string;
	/** Lowercase SHA-256 certificate fingerprint when verification succeeded. */
	readonly fingerprint?: string;
}

/** Bounded metadata taken from a trusted and schema-valid MCPB bundle. */
export interface McpbVerifiedManifest
{
	/** Pinned MCPB manifest version. */
	readonly manifestVersion: typeof MCPB_MANIFEST_VERSION;
	/** SHA-256 digest of the exact root manifest bytes. */
	readonly manifestDigest: string;
	/** Machine-readable bundle name from the manifest. */
	readonly name: string;
	/** Bundle release version from the manifest. */
	readonly version: string;
	/** Certificate common name returned by the trusted signature check. */
	readonly publisher: string;
	/** SHA-256 fingerprint of the trusted signing certificate. */
	readonly signerFingerprint: string;
}

/** Final answer from the manifest and signature check. */
export type McpbVerificationResult =
	| { readonly accepted: true; readonly manifest: McpbVerifiedManifest }
	| { readonly accepted: false; readonly failureCode: McpbVerificationFailureCodes };

/** Checks one saved MCP bundle without owning its workflow or product state. */
export interface McpbBundleVerifier
{
	/**
	 * Reads and checks an immutable bundle.
	 *
	 * @param target - Product-owned artifact facts saved with the validation.
	 * @returns Bounded accepted metadata or one stable rejection reason.
	 */
	verify(target: McpbBundleArtifactTarget): Promise<McpbVerificationResult>;
}

/** Input saved with one MCP bundle verification task. */
export interface McpbValidationTaskInput extends McpbBundleArtifactTarget
{
	/** Product validation row created in the same database transaction as this task. */
	readonly validationId: string;
	/** Digest that binds the task to every immutable submission field. */
	readonly submissionDigest: string;
}

/** Receipt returned after a bundle submission transaction admits its saved job. */
export interface McpbValidationAdmission
{
	/** Stable key that makes repeated task admission return the same task. */
	readonly taskKey: string;
	/** Engine-neutral receipt for the admitted task. */
	readonly receipt: IWorkflowTaskReceipt;
}

/** Transaction-bound admission API for the MCP bundle verification job. */
export interface McpbValidationWorkflow
{
	/**
	 * Saves or returns the task through the database transaction that created the validation row.
	 *
	 * @param transaction - Opaque database transaction owned by the caller.
	 * @param input - Immutable validation and artifact facts saved with the task.
	 * @returns Stable task key and engine-neutral receipt.
	 */
	admit(transaction: IWorkflowTransaction, input: McpbValidationTaskInput): Promise<McpbValidationAdmission>;
}

/** Dependencies used to register and run the MCP bundle verification task. */
export interface McpbValidationWorkflowOptions
{
	/** Engine-neutral workflow engine supplied by the OpenCrane composition root. */
	readonly execution: IWorkflowEngine;
	/** Manifest and signature checker that reads no database state. */
	readonly verifier: McpbBundleVerifier;
	/** MCP database transaction owner used to load and save product state. */
	readonly unitOfWork: McpOperatorUnitOfWork;
}
