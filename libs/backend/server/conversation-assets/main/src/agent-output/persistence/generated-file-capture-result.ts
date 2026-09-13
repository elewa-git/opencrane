import { GeneratedFileResultKinds, type GeneratedFileResultMetadata, type McpToolCallResult } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

import type { GeneratedFileCaptureIdentity } from "./generated-file-capture.types";
import type { GeneratedFileResource } from "../generated-file-resource.types";

/** Replace embedded bytes with a fixed summary and server-owned operation metadata. */
export function _GeneratedFileCaptureResult(identity: GeneratedFileCaptureIdentity, file: GeneratedFileResource): McpToolCallResult
{
	const metadata: GeneratedFileResultMetadata = {
		kind: GeneratedFileResultKinds.Captured,
		operationId: identity.operationId,
		assetId: identity.assetId,
		artifactId: identity.artifactId,
		artifactRevisionId: identity.revisionId,
		rawResultDigest: file.rawResultDigest,
		displayName: file.displayName,
		mediaType: file.mediaType,
		byteLength: file.bytes.byteLength,
	};
	return _GeneratedFileCapturedMetadataResult(metadata);
}

/** Rebuild the one canonical metadata result from server-read operation coordinates. */
export function _GeneratedFileCapturedMetadataResult(metadata: GeneratedFileResultMetadata): McpToolCallResult
{
	return {
		isError: false,
		content: [{ type: "text", text: "Generated file captured and queued for safety scanning." }],
		structuredContent: metadata as unknown as JsonValue,
	};
}
