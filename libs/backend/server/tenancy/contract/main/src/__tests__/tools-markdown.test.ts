import { describe, expect, it } from "vitest";

import { _RenderToolsMarkdown } from "../core/tools-markdown.js";

describe("_RenderToolsMarkdown", function _suite()
{
	it("renders entitled servers sorted by name", function _renders()
	{
		const md = _RenderToolsMarkdown(
			[
				{ id: "m2", name: "Zeta", description: "last" },
				{ id: "m1", name: "Alpha", description: "first" },
			],
		);

		// Alpha sorts before Zeta regardless of input order (deterministic output).
		expect(md.indexOf("**Alpha**")).toBeLessThan(md.indexOf("**Zeta**"));
		expect(md).toContain("- **Alpha** — first");
	});

	it("emits explicit 'none' notes for empty sections", function _empty()
	{
		const md = _RenderToolsMarkdown([]);
		expect(md).toContain("# TOOLS");
		expect(md).toContain("No MCP servers are currently entitled.");
	});

	it("omits the org-memory section by default and includes it when Cognee is wired", function _orgMemory()
	{
		const without = _RenderToolsMarkdown([]);
		expect(without).not.toContain("Org memory (Cognee)");
		expect(without).not.toContain("cognee_memories");

		const withMemory = _RenderToolsMarkdown([], { orgMemory: true });
		expect(withMemory).toContain("## Org memory (Cognee)");
		expect(withMemory).toContain("Auto-recall");
		expect(withMemory).toContain("Auto-capture");
		// The pinned plugin registers NO agent-callable tool — the doc must describe memory as
		// passive (auto-recall/capture) and must NOT promise a callable `cognee_memories` tool.
		expect(withMemory).toContain("there is " + "no tool for you to call");
		expect(withMemory).not.toContain("**cognee_memories**");
		expect(withMemory.endsWith("\n")).toBe(true);
	});

	it("is deterministic and ends with a trailing newline", function _deterministic()
	{
		const a = _RenderToolsMarkdown([{ id: "1", name: "B", description: "x" }, { id: "2", name: "A", description: "y" }]);
		const b = _RenderToolsMarkdown([{ id: "2", name: "A", description: "y" }, { id: "1", name: "B", description: "x" }]);
		expect(a).toBe(b);
		expect(a.endsWith("\n")).toBe(true);
	});
});
