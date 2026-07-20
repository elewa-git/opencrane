import { describe, expect, it } from "vitest";

import { _AssertNoL0Directives, _FindL0Directives } from "../core/l0-guard.js";

describe("_FindL0Directives (P4C L0 sandbox guard)", function _suite()
{
	it("passes clean voice/identity content", function _clean()
	{
		const soul = "# Our Voice\n\nWe are warm, concise, and curious. Always cite sources.";
		expect(_FindL0Directives(soul)).toEqual([]);
	});

	it("flags managed-mode and Obot gateway directives", function _managed()
	{
		const matched = _FindL0Directives("You run in managed mode and route tools via the Obot gateway.");
		expect(matched).toContain("managed-mode");
		expect(matched).toContain("obot-gateway");
	});

	it("flags feat-skill-registry, effective-contract, env vars, workspace path and L0 files", function _mechanics()
	{
		const matched = _FindL0Directives([
			"Pull from the skill registry.",
			"Re-read your effective contract.",
			"Set OPENCRANE_RUNTIME_MODE.",
			"Write to /data/openclaw/workspace.",
			"Edit AGENTS.md directly.",
		].join("\n"));
		expect(matched).toEqual(expect.arrayContaining(["feat-skill-registry", "effective-contract", "opencrane-env", "workspace-path", "platform-l0-file"]));
	});

	it("_AssertNoL0Directives throws listing the matches, passes when clean", function _assert()
	{
		expect(function _bad() { _AssertNoL0Directives("Operate in managed mode."); }).toThrow(/managed-mode/);
		expect(function _ok() { _AssertNoL0Directives("Be kind and precise."); }).not.toThrow();
	});
});
