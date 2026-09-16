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
	it("offers one same-tab handoff without displaying an interactive credential field", function _GuidanceContent()
	{
		document.body.innerHTML = _template();
		const shell = document.querySelector("wo-journey-shell");
		const handoff = document.querySelector("a");

		expect(shell?.getAttribute("title")).toBe("Join the current Tier 2 session");
		expect(shell?.getAttribute("description")).toBe("This tab has not joined the current local-development session.");
		expect(handoff?.getAttribute("href")).toBe("/api/v1/auth/development-session");
		expect(handoff?.getAttribute("target")).toBeNull();
		expect(handoff?.textContent?.trim()).toBe("Open current Tier 2 session");
		expect(document.body.textContent).not.toContain("development-session=");
		expect(document.querySelector("p-message[severity=\"info\"]")).not.toBeNull();
		expect(document.querySelector("button, input")).toBeNull();
	});
});
