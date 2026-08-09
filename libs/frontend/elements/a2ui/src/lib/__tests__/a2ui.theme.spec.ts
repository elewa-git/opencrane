import { describe, expect, it } from "vitest";

import { _OpenCraneA2uiTheme } from "../a2ui.theme";

describe("_OpenCraneA2uiTheme", () =>
{
	const theme = _OpenCraneA2uiTheme();

	it("maps key components onto OpenCrane design tokens via additionalStyles", () =>
	{
		expect(theme.additionalStyles?.Card?.["background"]).toBe("var(--oc-surface-subtle)");
		expect(theme.additionalStyles?.Button?.["background"]).toBe("var(--oc-ink-strong)");
		expect(theme.additionalStyles?.Divider?.["border-top"]).toContain("var(--oc-border-default)");
	});

	it("themes Text typography per usage hint (body + headings) with tokens", () =>
	{
		const text = theme.additionalStyles?.Text as Record<string, Record<string, string>> | undefined;
		expect(text?.["body"]?.["color"]).toBe("var(--oc-ink-strong)");
		expect(text?.["h1"]?.["font-size"]).toBe("18px");
	});

	it("leaves the class-map + markdown channels empty (markdown flows through our pipeline)", () =>
	{
		expect(theme.components.Button).toEqual({});
		expect(theme.markdown.p).toEqual([]);
	});
});
