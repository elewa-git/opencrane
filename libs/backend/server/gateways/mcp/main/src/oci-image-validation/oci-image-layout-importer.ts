import { ___DoWithTrace } from "@opencrane/backend/observability";
import { OciRegistryImportError, OciRegistryImportErrorCodes } from "@opencrane/backend/server/infra/oci-registry";
import type { OciRegistryClient } from "@opencrane/backend/server/infra/oci-registry";

import { OciImageImportFailure } from "./oci-image-import-failure";
import { _InspectOciImageLayoutForImport, _ReadOciImageLayoutZip } from "./oci-image-layout-verifier";
import type { OciImageLayoutArtifactReader, OciImageLayoutArtifactTarget, OciImageImportedLayout, OciImageLayoutImporter, OciImageValidatedLayout } from "./oci-image-validation.types";

/** Returns whether another workflow attempt may succeed after this registry failure. */
function _Retryable(error: OciRegistryImportError): boolean
{
	if (error.code === OciRegistryImportErrorCodes.TransportFailed)
		return true;
	return error.status === 408 || error.status === 429 || (error.status !== undefined && error.status >= 500 && error.status <= 599);
}

/**
 * Creates the adapter that rechecks validated layout bytes and copies them to the configured registry.
 * A changed artifact or registry identity becomes a non-retryable failure; temporary registry failures
 * remain retryable by the saved workflow.
 */
export function __CreateOciImageLayoutImporter(reader: OciImageLayoutArtifactReader, registry: OciRegistryClient): OciImageLayoutImporter
{
	return {
		async import(target: OciImageLayoutArtifactTarget, expected: OciImageValidatedLayout): Promise<OciImageImportedLayout>
		{
			return await ___DoWithTrace("oci-image-layout.import", { siloId: target.siloId, artifactId: target.artifactId, artifactRevisionId: target.artifactRevisionId }, async function _ImportLayout(): Promise<OciImageImportedLayout>
			{
				const layoutZip = await _ReadOciImageLayoutZip(reader, target);
				if (layoutZip === null)
					throw new OciImageImportFailure("OCI image artifact bytes changed after validation.", false);
				const inspected = _InspectOciImageLayoutForImport(layoutZip);
				if (!inspected.validation.accepted || inspected.plan === null)
					throw new OciImageImportFailure("OCI image layout no longer matches its completed validation.", false);
				const actual = inspected.validation.layout;
				if (actual.indexDigest !== expected.indexDigest || actual.imageManifestDigest !== expected.imageManifestDigest || actual.configDigest !== expected.configDigest)
					throw new OciImageImportFailure("OCI image digest evidence changed after validation.", false);
				try
				{
					const imported = await registry.import(inspected.plan);
					if (imported.manifestDigest !== expected.imageManifestDigest || !imported.reference.endsWith(`@${expected.imageManifestDigest}`))
						throw new OciImageImportFailure("OCI registry returned a different image identity.", false);
					return { ...expected, registryReference: imported.reference };
				}
				catch (error)
				{
					if (error instanceof OciImageImportFailure)
						throw error;
					if (error instanceof OciRegistryImportError)
						throw new OciImageImportFailure("OCI registry import did not finish.", _Retryable(error));
					throw new OciImageImportFailure("OCI registry import did not finish.", true);
				}
			});
		},
	};
}
