import { describe, expect, it } from "vitest";

import { _OpenCraneA2uiTheme } from "../a2ui.theme";

describe("_OpenCraneA2uiTheme", function _OpenCraneA2uiThemeSuite()
{
	/** Shared theme fixture used to prove token-backed upstream inline styles. */
	const theme = _OpenCraneA2uiTheme();

	it("maps key components onto defined OpenCrane surface, spacing, and colour tokens", function _MapsComponentTokens()
	{
		expect(theme.additionalStyles?.Card?.["background"]).toBe("var(--oc-surface-subtle)");
		expect(theme.additionalStyles?.Card?.["padding"]).toBe("var(--oc-space-3)");
		expect(theme.additionalStyles?.Button?.["background"]).toBe("var(--oc-ink-strong)");
		expect(theme.additionalStyles?.Button?.["font-size"]).toBe("var(--oc-text-sm)");
		expect(theme.additionalStyles?.Divider?.["border-top"]).toContain("var(--oc-border-default)");
	});

	it("themes text usage hints with the shared type scale", function _MapsTypographyTokens()
	{
		const text = theme.additionalStyles?.Text as Record<string, Record<string, string>> | undefined;
		expect(text?.["body"]?.["color"]).toBe("var(--oc-ink-strong)");
		expect(text?.["body"]?.["font-size"]).toBe("var(--oc-text-md)");
		expect(text?.["h1"]?.["font-size"]).toBe("var(--oc-text-lg)");
	});

	it("leaves class-map and markdown channels empty for the injected sanitizer", function _LeavesSanitizerChannelsEmpty()
	{
		expect(theme.components.Button).toEqual({});
		expect(theme.markdown.p).toEqual([]);
	});
});
