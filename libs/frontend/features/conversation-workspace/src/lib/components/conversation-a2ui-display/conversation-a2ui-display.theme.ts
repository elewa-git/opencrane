import { Theme } from "@a2ui/angular/v0_8";

/**
 * Maps the admitted containers to existing product tokens without accepting payload styles.
 * Called by: ConversationA2uiDisplayComponent's local Theme provider.
 * @returns An instance-local theme; text is styled by its literal-text component.
 */
export function _CreateConversationA2uiDisplayTheme(): Theme
{
	const theme = new Theme();
	theme.components.Card = {};
	theme.components.Row = {};
	theme.components.Column = {};
	theme.components.Divider = {};
	theme.additionalStyles = {
		Card: { background: "var(--oc-surface-subtle)", border: "1px solid var(--oc-border-default)", "border-radius": "var(--oc-radius-card)", padding: "var(--oc-space-4)", "min-width": "0" },
		Row: { gap: "var(--oc-space-3)", "flex-wrap": "wrap", "min-width": "0" },
		Column: { gap: "var(--oc-space-3)", "min-width": "0" },
		Divider: { background: "var(--oc-border-default)", margin: "var(--oc-space-2) 0" }
	};
	return theme;
}
