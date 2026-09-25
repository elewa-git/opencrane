import type { ArtifactReadLeaseRepository } from "@opencrane/backend/server/agents/artifacts";
import type { OciImageLayoutArtifactResolver } from "./oci-image-validation-submission.types";

/** Resolves immutable OCI inputs through the published artifact catalogue. */
export function _CreateOciImageArtifactResolver(catalogue: Pick<ArtifactReadLeaseRepository, "loadPublishedReadTarget">): OciImageLayoutArtifactResolver
{
	return {
		async resolve(siloId, artifactId, artifactRevisionId)
		{
			return await catalogue.loadPublishedReadTarget({ siloId, artifactId, artifactRevisionId });
		},
	};
}
