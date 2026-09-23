import { _ConversationAssetsOpenapiPaths } from "@opencrane/backend/server/conversation-assets";
import { spec } from "@opencrane/backend/server/api-spec";

/**
 * Describe only conversation-file routes that this public process actually mounts.
 *
 * The production document remains the generated-client source; Tier 2 omits the file fragment
 * because its local process has no ArtifactStore service or mounted signing keys.
 */
export function _CreatePublicOpenapiSpec(artifactStorageAvailable: boolean)
{
	if (artifactStorageAvailable)
		return spec;

	const unavailablePaths = new Set(Object.keys(_ConversationAssetsOpenapiPaths));
	const entries = Object.entries(spec.paths).filter(([path]) => !unavailablePaths.has(path));
	const paths = Object.fromEntries(entries);
	const localSpec = { ...spec, paths };

	return localSpec;
}
