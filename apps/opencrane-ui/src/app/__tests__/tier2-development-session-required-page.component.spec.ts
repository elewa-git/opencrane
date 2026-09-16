// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** Reads the Tier 2 entry-page template from the application test working directory. */
function _template(): string
{
	return readFileSync(join(process.cwd(), "src/app/local-development/tier2-development-session-required-page.component.html"), "utf8");
}

describe("Tier 2 development-session guidance", function _Tier2SessionGuidanceSuite()
{
	it("declares the private launcher handoff without an interactive credential field", function _GuidanceContent()
	{
		document.body.innerHTML = _template();
		const shell = document.querySelector("wo-journey-shell");

		expect(shell?.getAttribute("title")).toBe("Open the private URL printed by the Tier 2 launcher");
		expect(shell?.getAttribute("description")).toBe("This tab has not joined the current local-development session.");
		expect(document.querySelectorAll("ol > li")).toHaveLength(3);
		expect(document.body.textContent).toContain("The URL changes on every launch. Do not share it.");
		expect(document.body.textContent).toContain("Tier 2 requires the private browser URL generated for this launch.");
		expect(document.querySelector("p-message[severity=\"info\"]")).not.toBeNull();
		expect(document.querySelector("button, a, input")).toBeNull();
	});
});
