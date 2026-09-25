import { A2uiMessageProcessor, type AnyComponentNode, type CardNode, type ColumnNode, type RowNode, type Surface, type TextNode } from "@a2ui/web_core/v0_8";

import { ConversationA2uiDisplayStates, type ConversationA2uiDisplayPresentation } from "./conversation-a2ui-display.types";
import { _ConversationA2uiGraphComplete, _ConversationA2uiSdkComponents } from "./conversation-a2ui-graph";
import type { ConversationA2uiFrame } from "./conversation-a2ui-replay.types";

/**
 * Builds a render-only SDK snapshot. The caller already validated the wire catalogue and graph.
 * Incomplete roots, children or string bindings produce Waiting with no retained previous tree.
 * Raw data and component definitions never leave this synchronous projection.
 */
export function _ConversationA2uiSnapshot(frame: ConversationA2uiFrame, surfaceId: string, authorName: string): ConversationA2uiDisplayPresentation
{
	if (!_ConversationA2uiGraphComplete(frame))
		return _ConversationA2uiWaiting(surfaceId, authorName);
	const processor = new A2uiMessageProcessor();
	const normalized = _ConversationA2uiSdkComponents(frame);
	processor.processMessages([...frame.data.map(dataModelUpdate => ({ dataModelUpdate })), { surfaceUpdate: { surfaceId, components: normalized.components } }, { beginRendering: { surfaceId, root: normalized.root } }]);
	const source = processor.getSurfaces().get(surfaceId);
	if (!source?.componentTree)
		throw new Error("Structured display could not be reconstructed");
	let missingBinding = false;
	/** Reads each binding once and gives the Angular renderer only escaped literal text. */
	function _LiteralTree(node: AnyComponentNode): AnyComponentNode
	{
		switch (node.type)
		{
			case "Text":
			{
				const text = node as TextNode;
				const binding = text.properties.text;
				const value = binding.path !== undefined ? processor.getData(node, binding.path, surfaceId) : binding.literalString;
				if (value === null || value === undefined)
					missingBinding = true;
				else if (typeof value !== "string")
					throw new Error("Structured display text binding is not a string");
				return { ...text, properties: { ...text.properties, text: { literalString: typeof value === "string" ? value : "" } } };
			}
			case "Row":
			case "Column":
			{
				const layout = node as RowNode | ColumnNode;
				return { ...layout, properties: { ...layout.properties, children: layout.properties.children.map(_LiteralTree) } };
			}
			case "Card":
			{
				const card = node as CardNode;
				return { ...card, properties: { child: _LiteralTree(card.properties.child), children: [] } };
			}
			case "Divider": return node;
			default: throw new Error("Structured display component is not supported");
		}
	}
	const componentTree = _LiteralTree(source.componentTree);
	if (missingBinding)
		return _ConversationA2uiWaiting(surfaceId, authorName);
	const surface: Surface = { rootComponentId: normalized.root, componentTree, dataModel: new Map(), components: new Map(), styles: {} };
	return { state: ConversationA2uiDisplayStates.Ready, surfaceId, authorName, surface, detail: null };
}

/** Uses fixed copy instead of exposing missing references or private binding coordinates. */
function _ConversationA2uiWaiting(surfaceId: string, authorName: string): ConversationA2uiDisplayPresentation
{
	return { state: ConversationA2uiDisplayStates.Waiting, surfaceId, authorName, surface: null, detail: "Waiting for the rest of this display." };
}
