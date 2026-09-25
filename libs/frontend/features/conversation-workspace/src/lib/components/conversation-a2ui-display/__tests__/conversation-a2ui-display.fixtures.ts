import { A2uiMessageProcessor, type ResolvedText, type ServerToClientMessage } from "@a2ui/web_core/v0_8";

import { ConversationA2uiDisplayStates, type ConversationA2uiDisplayPresentation } from "../../../a2ui/conversation-a2ui-display.types";

/** Builds an official static message batch without actions, media or unresolved text bindings. */
export function _ConversationA2uiDisplayFixture(text = "Customer records checked.", surfaceId = "display-fixture", headingHint: ResolvedText["usageHint"] = "h2"): ConversationA2uiDisplayPresentation
{
	const messages: ServerToClientMessage[] = [
		{ surfaceUpdate: { surfaceId, components: [
			{ id: "root", component: { Card: { child: "content" } } },
			{ id: "content", component: { Column: { children: { explicitList: ["heading", "row", "divider", "caption-copy"] } } } },
			{ id: "heading", component: { Text: { text: { literalString: "Customer summary" }, usageHint: headingHint } } },
			{ id: "row", component: { Row: { children: { explicitList: ["label", "body-copy"] } } } },
			{ id: "label", component: { Text: { text: { literalString: "Status" }, usageHint: "body" } } },
			{ id: "body-copy", component: { Text: { text: { literalString: text }, usageHint: "body" } } },
			{ id: "divider", component: { Divider: { axis: "horizontal" } } },
			{ id: "caption-copy", component: { Text: { text: { literalString: "Based on the records in this conversation." }, usageHint: "caption" } } }
		] } },
		{ beginRendering: { surfaceId, root: "root" } }
	];
	const processor = new A2uiMessageProcessor();
	processor.processMessages(messages);
	const surface = processor.getSurfaces().get(surfaceId);
	if (surface === undefined)
		throw new Error("The static display fixture did not produce a surface.");
	return { state: ConversationA2uiDisplayStates.Ready, authorName: "Company assistant", surfaceId, surface, detail: null };
}
