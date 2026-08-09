import type { Types } from "@a2ui/angular/v0_8";

/**
 * The OpenCrane A2UI theme — brings agent-authored canvas surfaces onto our design tokens.
 *
 * A2UI applies `additionalStyles.<Component>` as inline styles on each rendered component, so
 * that channel is the bridge to our CSS variables (no A2UI-named CSS classes exist to target, so
 * the class-map fields stay empty). Markdown inside A2UI Text is NOT themed here — it flows
 * through our vendored pipeline via `provideMarkdownRenderer`, so it already carries our classes.
 *
 * This is the incremental "custom themed catalog" step from #41 §4: it themes the standard
 * catalog rather than swapping in bespoke components. Fine-grained element theming (e.g. input
 * borders, which need per-element class-maps A2UI doesn't expose via additionalStyles) is a
 * further refinement on top of this.
 */
export function _OpenCraneA2uiTheme(): Types.Theme
{
	const on: Record<string, boolean> = {};
	const leaf = { container: on, element: on, label: on };
	return {
		components: {
			AudioPlayer: on,
			Button: on,
			Card: on,
			Column: on,
			CheckBox: leaf,
			DateTimeInput: leaf,
			Divider: on,
			Image: { all: on, icon: on, avatar: on, smallFeature: on, mediumFeature: on, largeFeature: on, header: on },
			Icon: on,
			List: on,
			Modal: { backdrop: on, element: on },
			MultipleChoice: leaf,
			Row: on,
			Slider: leaf,
			Tabs: { container: on, element: on, controls: { all: on, selected: on } },
			Text: { all: on, h1: on, h2: on, h3: on, h4: on, h5: on, caption: on, body: on },
			TextField: leaf,
			Video: on,
		},
		elements: {
			a: on, audio: on, body: on, button: on, h1: on, h2: on, h3: on, h4: on, h5: on,
			iframe: on, input: on, p: on, pre: on, textarea: on, video: on,
		},
		markdown: { p: [], h1: [], h2: [], h3: [], h4: [], h5: [], ul: [], ol: [], li: [], a: [], strong: [], em: [] },
		additionalStyles: {
			Card: { background: "var(--oc-surface-subtle)", border: "1px solid var(--oc-border-default)", "border-radius": "var(--oc-radius-chip)", padding: "12px" },
			Row: { gap: "8px", "align-items": "center" },
			Column: { gap: "8px" },
			List: { gap: "6px" },
			Button: {
				background: "var(--oc-ink-strong)",
				color: "var(--oc-on-strong)",
				border: "none",
				"border-radius": "var(--oc-radius-chip)",
				padding: "6px 14px",
				"font-size": "13px",
				cursor: "pointer",
			},
			Divider: { "border-top": "1px solid var(--oc-border-default)", margin: "8px 0" },
			Icon: { color: "var(--oc-ink-muted)" },
			Image: { "border-radius": "var(--oc-radius-chip)", "max-width": "100%" },
			TextField: { color: "var(--oc-ink-strong)", "font-size": "13px" },
			CheckBox: { color: "var(--oc-ink-strong)", "font-size": "13px", "accent-color": "var(--oc-accent)" },
			DateTimeInput: { color: "var(--oc-ink-strong)", "font-size": "13px" },
			MultipleChoice: { color: "var(--oc-ink-strong)", "font-size": "13px" },
			Slider: { "accent-color": "var(--oc-accent)" },
			Tabs: { "font-size": "13px", color: "var(--oc-ink-strong)" },
			Modal: { background: "var(--oc-surface-subtle)", border: "1px solid var(--oc-border-default)", "border-radius": "var(--oc-radius-chip)", padding: "16px" },
			Text: {
				body: { color: "var(--oc-ink-strong)", "font-size": "14px", "line-height": "1.6" },
				caption: { color: "var(--oc-ink-muted)", "font-size": "12px" },
				h1: { color: "var(--oc-ink-strong)", "font-size": "18px", "font-weight": "600" },
				h2: { color: "var(--oc-ink-strong)", "font-size": "16px", "font-weight": "600" },
				h3: { color: "var(--oc-ink-strong)", "font-size": "14px", "font-weight": "600" },
				h4: { color: "var(--oc-ink-strong)", "font-size": "13px", "font-weight": "600" },
				h5: { color: "var(--oc-ink-strong)", "font-size": "12px", "font-weight": "600" },
			},
		},
	};
}
