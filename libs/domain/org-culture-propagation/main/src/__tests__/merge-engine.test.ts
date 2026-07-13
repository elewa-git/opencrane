import { describe, expect, it } from "vitest";

import { _DeterministicCultureMerge } from "../core/merge-engine.js";

describe("_DeterministicCultureMerge (P4C.4 3-way merge fallback)", function _suite()
{
	const engine = new _DeterministicCultureMerge();

	it("fast-forwards to the culture version when the tenant never diverged", async function _ff()
	{
		const base = "# Voice\nWarm and concise.";
		const out = await engine.merge({ docName: "SOUL", base, ours: "# Voice\nWarm, concise, curious.", theirs: base });
		expect(out.merged).toBe("# Voice\nWarm, concise, curious.");
		expect(out.diff).toContain("+ Warm, concise, curious.");
	});

	it("culture wins but preserves tenant-only additions under an addendum", async function _conflict()
	{
		const base = "# Voice\nWarm.";
		const ours = "# Voice\nWarm and precise.";
		const theirs = "# Voice\nWarm.\nWe love puns.";
		const out = await engine.merge({ docName: "SOUL", base, ours, theirs });
		// Culture content is the spine...
		expect(out.merged).toContain("Warm and precise.");
		// ...and the tenant's own added line survives under the preserved-additions heading.
		expect(out.merged).toContain("Tenant additions (preserved)");
		expect(out.merged).toContain("We love puns.");
	});

	it("emits no addendum when the tenant added nothing beyond base/ours", async function _noAdd()
	{
		const out = await engine.merge({ docName: "SOUL", base: "A", ours: "A and B", theirs: "A and B" });
		expect(out.merged).toBe("A and B");
		expect(out.merged).not.toContain("Tenant additions");
	});
});
