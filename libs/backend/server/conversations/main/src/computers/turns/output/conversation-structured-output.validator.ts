import { CONVERSATION_A2UI_COMPONENT_LIMIT, CONVERSATION_A2UI_DEPTH_LIMIT, CONVERSATION_A2UI_PAYLOAD_BYTES, ___ConversationA2uiDisplaySchema, type ConversationA2uiDisplay } from "@opencrane/contracts";
import { ___CanonicalizeJson, type JsonValue } from "@opencrane/util";

import { _ConversationStructuredOutputId } from "./conversation-computer-output-receipt";

/**
 * Accepts a complete participant-facing result, not private MCP result data or arbitrary text.
 * Shared contracts validate the official wire shape. This producer additionally requires a finite,
 * fully reachable tree and replaces model placeholders with the server's output identity.
 * @throws Error with fixed copy when the display is incomplete, excessive or unsupported.
 */
export function _PrepareConversationStructuredOutput(candidate: ConversationA2uiDisplay | undefined, sourceCommandId: string): string | null
{
	if (candidate === undefined)
		return null;
	try
	{
		const display = ___ConversationA2uiDisplaySchema.parse(candidate);
		const components = display[0].surfaceUpdate.components;
		const byId = new Map(components.map(component => [component.id, component]));
		if (byId.size !== components.length)
			throw new Error("Repeated component");
		const visited = new Set<string>();
		const pending = [{ id: display[1].beginRendering.root, ancestors: new Set<string>() }];
		let expanded = 0;
		while (pending.length > 0)
		{
			const current = pending.pop()!;
			if (++expanded > CONVERSATION_A2UI_COMPONENT_LIMIT || current.ancestors.size >= CONVERSATION_A2UI_DEPTH_LIMIT || current.ancestors.has(current.id))
				throw new Error("Excessive or cyclic graph");
			const component = byId.get(current.id);
			if (component === undefined)
				throw new Error("Missing component");
			visited.add(current.id);
			const definition = component.component;
			const children = definition.Card ? [definition.Card.child] : definition.Row?.children.explicitList ?? definition.Column?.children.explicitList ?? [];
			const ancestors = new Set([...current.ancestors, current.id]);
			for (const id of children)
				pending.push({ id, ancestors });
		}
		if (visited.size !== components.length)
			throw new Error("Unreachable component");
		const surfaceId = _ConversationStructuredOutputId(sourceCommandId);
		const payload = ___CanonicalizeJson([{ surfaceUpdate: { ...display[0].surfaceUpdate, surfaceId } }, { beginRendering: { ...display[1].beginRendering, surfaceId } }] as unknown as JsonValue);
		if (new TextEncoder().encode(payload).byteLength > CONVERSATION_A2UI_PAYLOAD_BYTES)
			throw new Error("Excessive payload");
		return payload;
	}
	catch
	{
		throw new Error("Conversation structured output is invalid");
	}
}
