// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** Production template rendered by the Tier 2 guidance component. */
const _TEMPLATE = readFileSync(join(process.cwd(), "src/app/local-development/tier2-development-session-required-page.component.html"), "utf8");

/** Parses the production markup so both finite branches can be inspected without Angular JIT. */
function _templateDocument(): HTMLElement
{
	const element = document.createElement("div");
	element.innerHTML = _TEMPLATE;

	return element;
}

describe("Tier 2 development-session guidance", function _Tier2SessionGuidanceSuite()
{
	it("offers a same-tab handoff when this tab has not joined the launch", function _MissingGuidance()
	{
		const element = _templateDocument();
		const shell = element.querySelectorAll("wo-journey-shell")[0];
		const handoff = element.querySelectorAll("a")[0];

		expect(shell?.getAttribute("title")).toBe("Join the current Tier 2 session");
		expect(shell?.getAttribute("description")).toBe("This tab has not joined the current local-development session.");
		expect(handoff?.getAttribute("href")).toBe("/api/v1/auth/development-session");
		expect(handoff?.getAttribute("target")).toBeNull();
		expect(handoff?.textContent?.trim()).toBe("Open current Tier 2 session");
		expect(element.textContent).not.toContain("development-session=");
		expect(element.querySelector("p-message[severity=\"info\"]")).not.toBeNull();
		expect(element.querySelector("button, input")).toBeNull();
	});

	it("offers an explicit new-tab handoff after Tier 2 replaces the tab session", function _ReplacedGuidance()
	{
		const element = _templateDocument();
		const shell = element.querySelectorAll("wo-journey-shell")[1];
		const handoff = element.querySelectorAll("a")[1];

		expect(shell?.getAttribute("title")).toBe("This tab belongs to an earlier Tier 2 session");
		expect(shell?.getAttribute("description")).toContain("Tier 2 restarted");
		expect(handoff?.getAttribute("href")).toBe("/api/v1/auth/development-session");
		expect(handoff?.getAttribute("target")).toBe("_blank");
		expect(handoff?.getAttribute("rel")).toBe("noopener");
		expect(handoff?.textContent?.trim()).toBe("Open current Tier 2 session in a new tab");
		expect(element.textContent).not.toContain("development-session=");
		expect(element.querySelector("p-message[severity=\"warn\"]")).not.toBeNull();
		expect(element.querySelector("button, input")).toBeNull();
	});
});
