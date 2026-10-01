import { CONVERSATION_A2UI_SURFACE_PLACEHOLDER, type ConversationA2uiDisplay } from "@opencrane/contracts";

/** Uses a real result layout while keeping provider data and participant identity synthetic. */
export function _StructuredInventoryResult(): ConversationA2uiDisplay
{
	return [
		{ surfaceUpdate: { surfaceId: CONVERSATION_A2UI_SURFACE_PLACEHOLDER, components: [
			{ id: "root", component: { Card: { child: "summary" } } },
			{ id: "summary", component: { Column: { children: { explicitList: ["title", "totals"] } } } },
			{ id: "title", component: { Text: { text: { literalString: "Kisumu inventory <review>" }, usageHint: "h2" } } },
			{ id: "totals", component: { Text: { text: { literalString: "42 recorded units across 3 products." } } } },
		] } },
		{ beginRendering: { surfaceId: CONVERSATION_A2UI_SURFACE_PLACEHOLDER, root: "root" } },
	];
}
