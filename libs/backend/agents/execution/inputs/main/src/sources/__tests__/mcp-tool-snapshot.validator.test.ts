import { describe, expect, it } from "vitest";

import { ___DigestCanonicalJson } from "@opencrane/util";

import { __AreRunInputSnapshotMcpToolsValid } from "../mcp-tool-snapshot.validator";

/** Build one immutable snapshot entry with an exact source name. */
function _Tool(toolRevisionId: string, name: string)
{
	const inputSchema = { type: "object", additionalProperties: false } as const;
	return { toolRevisionId, name, description: null, inputSchema, inputSchemaDigest: ___DigestCanonicalJson(inputSchema) };
}

describe("MCP tool snapshot set validation", function _McpToolSnapshotSuite()
{
	it("allows two immutable revisions to retain the same exact source name", function _AllowsRepeatedSourceName()
	{
		expect(__AreRunInputSnapshotMcpToolsValid([_Tool("revision-1", "files.export"), _Tool("revision-2", "files.export")])).toBe(true);
	});

	it("still rejects a duplicate immutable revision", function _RejectsDuplicateRevision()
	{
		expect(__AreRunInputSnapshotMcpToolsValid([_Tool("revision-1", "files.export"), _Tool("revision-1", "files.export_v2")])).toBe(false);
	});
});
