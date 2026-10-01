import { createHash } from "node:crypto";

/**
 * Derives the provider name from an already saved, server-generated catalog identifier.
 *
 * The immutable dataset id lets an interrupted provisioning task address the same dataset before
 * Cognee returns its UUID. Callers must load this id from the personal catalog, never from a tool
 * argument or a subject identifier. Hashing keeps the name within the gateway's fixed length
 * bounds even when the catalog uses short identifiers. The name grants no read authority.
 */
export function __PersonalMemoryProviderDatasetName(datasetId: string): string
{
	if (datasetId.length === 0 || datasetId.length > 128 || datasetId.trim() !== datasetId)
		throw new Error("personal memory dataset identifier cannot form a provider name");
	const digest = createHash("sha256").update(datasetId, "utf8").digest("hex");
	return `opencrane-memory-${digest}`;
}
