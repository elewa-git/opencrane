import { createHash } from "node:crypto";

import type { McpToolCallResult } from "@opencrane/contracts";
import { ___CreateCsvFile, GENERATED_CSV_MEDIA_TYPE } from "@opencrane/models/conversation-assets";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { GeneratedFileResourceOutcomes, type GeneratedFileResourceResult } from "./generated-file-resource.types";

/** Selects the first supported producer after the caller verifies its actual tool and server revision. */
const _TOOL_NAME = "opencrane.files.create_csv";
/** The producer's metadata URI is an identifier, never a location to open. */
const _RESOURCE_URI = "urn:opencrane:generated-file:csv";

/**
 * Extracts the supported producer's embedded bytes before terminal tool-result persistence.
 * A rejected result must not fall back to ordinary JSON persistence. Tool-name matching is
 * format selection only: the caller must verify the admitted OCI revision, current invocation,
 * personal requester and ArtifactCollection/Create before saving the returned bytes.
 */
export function _ParseGeneratedFileResource(toolName: string, argumentsValue: JsonValue, result: McpToolCallResult): GeneratedFileResourceResult
{
	if (toolName !== _TOOL_NAME)
	{
		const embedded = result.content.some(block => _Record(block) && block["type"] === "resource");
		return { outcome: embedded ? GeneratedFileResourceOutcomes.Rejected : GeneratedFileResourceOutcomes.NotApplicable };
	}
	const expected = ___CreateCsvFile(argumentsValue);
	if (!expected.accepted || result.isError || result.structuredContent !== undefined || result.content.length !== 1)
		return { outcome: GeneratedFileResourceOutcomes.Rejected };
	const block = result.content[0];
	if (!_Record(block) || !_Keys(block, ["type", "resource"]) || block["type"] !== "resource")
		return { outcome: GeneratedFileResourceOutcomes.Rejected };
	const resource = block["resource"];
	if (!_Record(resource) || !_Keys(resource, ["uri", "mimeType", "text"]) || resource["uri"] !== _RESOURCE_URI || resource["mimeType"] !== GENERATED_CSV_MEDIA_TYPE || typeof resource["text"] !== "string")
		return { outcome: GeneratedFileResourceOutcomes.Rejected };
	const text = resource["text"];
	// Scanning cannot establish spreadsheet safety. Compare against the shared renderer's checked
	// interpretation of the admitted arguments before any content enters encrypted custody.
	if (text !== expected.file.text)
		return { outcome: GeneratedFileResourceOutcomes.Rejected };
	const bytes = Buffer.from(text, "utf8");
	if (bytes.toString("utf8") !== text)
		return { outcome: GeneratedFileResourceOutcomes.Rejected };
	return {
		outcome: GeneratedFileResourceOutcomes.Accepted,
		file: { displayName: expected.file.displayName, mediaType: GENERATED_CSV_MEDIA_TYPE, bytes, contentAddress: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, rawResultDigest: ___DigestCanonicalJson(result as unknown as JsonValue) },
	};
}

/** Accepts an object without accepting arrays or null as resource maps. */
function _Record(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue }
{
	return value !== undefined && value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Rejects extra resource fields that could smuggle another content representation into capture. */
function _Keys(value: { readonly [key: string]: JsonValue }, expected: readonly string[]): boolean
{
	return Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}
