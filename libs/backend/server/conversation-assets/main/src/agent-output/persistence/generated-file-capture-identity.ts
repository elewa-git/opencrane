import { createHash } from "node:crypto";

import type { GeneratedFileCaptureIdentity, GeneratedFileCurrentExecutionEvidence } from "./generated-file-capture.types";

/** Derive unrelated stable identifiers from the silo and authorization-owned invocation row. */
export function _GeneratedFileCaptureIdentity(evidence: Pick<GeneratedFileCurrentExecutionEvidence, "siloId" | "toolInvocationRowId">): GeneratedFileCaptureIdentity
{
	const coordinates = [evidence.siloId, evidence.toolInvocationRowId] as const;
	return {
		artifactId: _Uuid("opencrane.generated-file.artifact.v1", coordinates),
		assetId: _Uuid("opencrane.generated-file.asset.v1", coordinates),
		capabilityJti: _Uuid("opencrane.generated-file.upload-capability.v1", coordinates),
		operationId: _Uuid("opencrane.generated-file.operation.v1", coordinates),
		revisionId: _Uuid("opencrane.generated-file.revision.v1", coordinates),
		taskKey: `conversation-generated-file:${createHash("sha256").update(JSON.stringify(["opencrane.generated-file.task.v1", ...coordinates]), "utf8").digest("hex")}`,
		uploadLeaseId: _Uuid("opencrane.generated-file.upload-lease.v1", coordinates),
	};
}

/** Produce an RFC 4122-shaped deterministic identifier without sharing a namespace across roles. */
function _Uuid(domain: string, coordinates: readonly string[]): string
{
	const bytes = createHash("sha256").update(JSON.stringify([domain, ...coordinates]), "utf8").digest().subarray(0, 16);
	bytes[6] = (bytes[6]! & 0x0f) | 0x50;
	bytes[8] = (bytes[8]! & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
