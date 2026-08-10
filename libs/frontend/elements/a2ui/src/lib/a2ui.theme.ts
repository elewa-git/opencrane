import type { Types } from "@a2ui/angular/v0_8";

/**
 * The OpenCrane A2UI theme brings projected canvas surfaces onto shared design tokens.
 *
 * A2UI applies `additionalStyles.<Component>` as inline styles on each rendered component, so
 * that channel is the bridge to our CSS variables (no A2UI-named CSS classes exist to target, so
 * the class-map fields stay empty). Markdown inside A2UI Text is not themed here; the browser
 * composition root supplies the package's required safe HTML sanitizer port.
 *
 * The catalogue is constrained separately; this complete upstream theme shape is required by the
 * A2UI renderer even though unsupported component entries can never be selected.
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
			Card: { background: "var(--oc-surface-subtle)", border: "1px solid var(--oc-border-default)", "border-radius": "var(--oc-radius-chip)", padding: "var(--oc-space-3)" },
			Row: { gap: "var(--oc-space-2)", "align-items": "center" },
			Column: { gap: "var(--oc-space-2)" },
			List: { gap: "var(--oc-space-2)" },
			Button: {
				background: "var(--oc-ink-strong)",
				color: "var(--oc-on-strong)",
				border: "none",
				"border-radius": "var(--oc-radius-chip)",
				padding: "var(--oc-space-2) var(--oc-space-3)",
				"font-size": "var(--oc-text-sm)",
				cursor: "pointer",
			},
			Divider: { "border-top": "1px solid var(--oc-border-default)", margin: "var(--oc-space-2) 0" },
			Icon: { color: "var(--oc-ink-muted)" },
			Image: { "border-radius": "var(--oc-radius-chip)", "max-width": "100%" },
			TextField: { color: "var(--oc-ink-strong)", "font-size": "var(--oc-text-sm)" },
			CheckBox: { color: "var(--oc-ink-strong)", "font-size": "var(--oc-text-sm)", "accent-color": "var(--oc-accent)" },
			DateTimeInput: { color: "var(--oc-ink-strong)", "font-size": "var(--oc-text-sm)" },
			MultipleChoice: { color: "var(--oc-ink-strong)", "font-size": "var(--oc-text-sm)" },
			Slider: { "accent-color": "var(--oc-accent)" },
			Tabs: { "font-size": "var(--oc-text-sm)", color: "var(--oc-ink-strong)" },
			Modal: { background: "var(--oc-surface-subtle)", border: "1px solid var(--oc-border-default)", "border-radius": "var(--oc-radius-chip)", padding: "var(--oc-space-4)" },
			Text: {
				body: { color: "var(--oc-ink-strong)", "font-size": "var(--oc-text-md)", "line-height": "1.6" },
				caption: { color: "var(--oc-ink-muted)", "font-size": "var(--oc-text-sm)" },
				h1: { color: "var(--oc-ink-strong)", "font-size": "var(--oc-text-lg)", "font-weight": "var(--oc-font-weight-medium)" },
				h2: { color: "var(--oc-ink-strong)", "font-size": "var(--oc-text-md)", "font-weight": "var(--oc-font-weight-medium)" },
				h3: { color: "var(--oc-ink-strong)", "font-size": "var(--oc-text-md)", "font-weight": "var(--oc-font-weight-medium)" },
				h4: { color: "var(--oc-ink-strong)", "font-size": "var(--oc-text-sm)", "font-weight": "var(--oc-font-weight-medium)" },
				h5: { color: "var(--oc-ink-strong)", "font-size": "var(--oc-text-xs)", "font-weight": "var(--oc-font-weight-medium)" },
			},
		},
	};
}
