/**
 * Error categories returned by the registry import adapter.
 *
 * The workflow may retry transport failures. Configuration, input, registry-response, and digest
 * failures need operator or code changes instead. These values are not persisted or sent over a
 * public API, but callers may branch on them when deciding whether to retry an import.
 */
export enum OciRegistryImportErrorCodes
{
	/** The registry address, repository name, timeout, or authorization value is not safe to use. */
	InvalidConfiguration = "invalid_configuration",
	/** The supplied bytes do not match their SHA-256 digest or the import plan is incomplete. */
	InvalidPlan = "invalid_plan",
	/** The registry request did not complete, so a later call may retry the same import. */
	TransportFailed = "transport_failed",
	/** The registry returned a status or required header that the OCI Distribution flow does not allow. */
	InvalidRegistryResponse = "invalid_registry_response",
	/** The registry identified stored content with a different digest, so the import must stop. */
	DigestMismatch = "digest_mismatch",
}

/** One config or layer blob referenced by an already-checked OCI image manifest. */
export interface OciRegistryBlob
{
	/** SHA-256 digest that addresses these bytes in the registry. */
	readonly digest: string;
	/** Complete blob bytes whose SHA-256 digest matches `digest`. */
	readonly bytes: Uint8Array;
}

/** The single-image manifest uploaded after all of its blobs exist in the repository. */
export interface OciRegistryManifest
{
	/** SHA-256 digest of the exact manifest byte representation. */
	readonly digest: string;
	/** OCI image manifest media type sent as the HTTP content type. */
	readonly mediaType: string;
	/** Exact JSON bytes that admission checked and the registry must store unchanged. */
	readonly bytes: Uint8Array;
}

/** Complete import request produced after OCI Image Layout admission has checked every descriptor. */
export interface OciRegistryImportPlan
{
	/** Config and layer blobs referenced by `manifest`. */
	readonly blobs: readonly OciRegistryBlob[];
	/** Single-image manifest uploaded by digest after every blob is present. */
	readonly manifest: OciRegistryManifest;
}

/** Successful immutable registry coordinate returned to persistence and runtime callers. */
export interface OciRegistryImportResult
{
	/** Full registry coordinate in `host/repository@sha256:...` form. */
	readonly reference: string;
	/** Manifest digest repeated separately for callers that store it in its own field. */
	readonly manifestDigest: string;
}

/** Configures one client for one operator-owned registry repository. */
export interface OciRegistryClientOptions
{
	/** HTTPS registry origin, without a path, query, fragment, or embedded credentials. */
	readonly baseUrl: string;
	/** Repository name accepted by the OCI Distribution specification. */
	readonly repository: string;
	/** Deadline applied separately to each registry HTTP request. */
	readonly requestTimeoutMilliseconds: number;
	/** Optional reader that returns the current complete Authorization header for each request. */
	readonly readAuthorizationHeader?: () => Promise<string | undefined>;
	/** Fetch implementation override used by focused tests. */
	readonly request?: typeof fetch;
}

/** Prepared client configuration shared by this package's HTTP helpers. */
export interface OciRegistryContext
{
	/** Reviewed HTTPS registry origin. */
	readonly baseUrl: URL;
	/** Repository path with each segment escaped for an HTTP URL. */
	readonly repositoryPath: string;
	/** Registry host and repository used in the returned immutable reference. */
	readonly referenceRepository: string;
	/** Deadline applied to each HTTP request. */
	readonly requestTimeoutMilliseconds: number;
	/** Optional credential reader called only after the request origin is checked. */
	readonly readAuthorizationHeader?: () => Promise<string | undefined>;
	/** Fetch implementation used for registry HTTP requests. */
	readonly request: typeof fetch;
}

/** Imports checked OCI image bytes into the configured repository. */
export interface OciRegistryClient
{
	/**
	 * Uploads missing blobs and then stores the manifest by its SHA-256 digest.
	 *
	 * Repeating the same plan is safe: each blob is checked before upload, and the manifest address
	 * is its digest rather than a mutable tag.
	 *
	 * Called by: the OCI image admission workflow after layout validation and before it records an
	 * immutable runtime image reference.
	 *
	 * @param plan - Checked manifest bytes plus every config and layer blob it references.
	 * @returns The full immutable registry coordinate and manifest digest.
	 * @throws OciRegistryImportError When the plan, transport, or registry response is unsafe.
	 * @see https://github.com/opencontainers/distribution-spec/blob/v1.1.1/spec.md
	 */
	import(plan: OciRegistryImportPlan): Promise<OciRegistryImportResult>;
}
