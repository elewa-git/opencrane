import { describe, expect, it } from "vitest";

import { __IsImmutableRegistryReference } from "../immutable-registry-reference";

describe("immutable registry references", function _Suite()
{
	it("accepts nested repositories pinned to one manifest digest", function _AcceptsReference()
	{
		expect(__IsImmutableRegistryReference(`registry.example.test:5000/team/mcp-server@sha256:${"a".repeat(64)}`)).toBe(true);
	});

	it("rejects tags, empty segments, repeated digest separators, and adversarial paths", function _RejectsInvalidReferences()
	{
		expect(__IsImmutableRegistryReference("registry.example.test/team/mcp-server:latest")).toBe(false);
		expect(__IsImmutableRegistryReference(`registry.example.test/team//mcp-server@sha256:${"a".repeat(64)}`)).toBe(false);
		expect(__IsImmutableRegistryReference(`registry.example.test/team/mcp@sha256:${"a".repeat(64)}@sha256:${"b".repeat(64)}`)).toBe(false);
		expect(__IsImmutableRegistryReference(`0/${"0/".repeat(50_000)}image`)).toBe(false);
	});
});
