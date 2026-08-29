import { _CreateOciRegistryContext } from "./oci-registry-http";
import { _CheckOciRegistryImportPlan } from "./oci-registry-plan";
import { _EnsureOciRegistryBlob, _UploadOciRegistryManifest } from "./oci-registry-upload";
import type { OciRegistryClient, OciRegistryClientOptions, OciRegistryImportResult } from "./oci-registry.types";

/**
 * Creates a client that imports checked OCI image content into one fixed repository.
 *
 * The client never accepts tags or a repository per call. It checks every local digest, skips blobs
 * already present, uploads missing blobs through the OCI Distribution monolithic flow, and writes
 * the manifest last by digest. Authorization is never placed in errors or sent to another origin.
 *
 * Called by: OpenCrane application composition, which supplies the registry origin and repository.
 *
 * @param options - Fixed registry origin, repository, request deadline, and optional credential.
 * @returns An importer whose successful result is safe to save as an immutable runtime image.
 * @throws OciRegistryImportError When the fixed client configuration is invalid.
 * @see https://github.com/opencontainers/distribution-spec/blob/v1.1.1/spec.md
 * @see https://github.com/opencontainers/image-spec/blob/v1.0.1/manifest.md
 */
export function __CreateOciRegistryClient(options: OciRegistryClientOptions): OciRegistryClient
{
	const context = _CreateOciRegistryContext(options);
	return {
		async import(plan): Promise<OciRegistryImportResult>
		{
			// 1. Recheck content addresses before any external write uses the supplied bytes.
			_CheckOciRegistryImportPlan(plan);

			// 2. Upload each referenced config or layer blob before the manifest that points to it.
			for (const blob of plan.blobs)
				await _EnsureOciRegistryBlob(context, blob);

			// 3. Publish by digest so retries cannot move a tag or create another image identity.
			await _UploadOciRegistryManifest(context, plan);
			return { reference: `${context.referenceRepository}@${plan.manifest.digest}`, manifestDigest: plan.manifest.digest };
		},
	};
}
