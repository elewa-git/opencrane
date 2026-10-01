import { CONVERSATION_A2UI_COMPONENT_LIMIT, CONVERSATION_A2UI_DEPTH_LIMIT, type ConversationA2uiComponent } from "@opencrane/contracts";
import type { ConversationA2uiFrame } from "./conversation-a2ui-replay.types";

/** Returns only the static references admitted by the adjacent protocol validator. */
export function _ConversationA2uiChildren(component: ConversationA2uiComponent): readonly string[]
{
	const definition = component.component;
	if (definition.Card)
		return [definition.Card.child];
	return definition.Row?.children.explicitList ?? definition.Column?.children.explicitList ?? [];
}

/**
 * Checks the intended graph before the SDK expands it. Missing definitions are a valid waiting
 * state; cycles, excessive nesting and oversized expanded DAGs reject the update.
 */
export function _ConversationA2uiGraphComplete(frame: ConversationA2uiFrame): boolean
{
	if (frame.components.size > CONVERSATION_A2UI_COMPONENT_LIMIT)
		throw new Error("Structured display has too many components");
	if (frame.root === null)
		return false;
	let expanded = 0;
	/** Counts every rendered occurrence, not merely each distinct stored component. */
	function _Visit(id: string, ancestors: ReadonlySet<string>): boolean
	{
		if (++expanded > CONVERSATION_A2UI_COMPONENT_LIMIT || ancestors.size >= CONVERSATION_A2UI_DEPTH_LIMIT || ancestors.has(id))
			throw new Error("Structured display graph exceeds its limits");
		const component = frame.components.get(id);
		if (!component)
			return false;
		const next = new Set([...ancestors, id]);
		let complete = true;
		for (const child of _ConversationA2uiChildren(component))
			complete = _Visit(child, next) && complete;
		return complete;
	}
	return _Visit(frame.root, new Set());
}

/**
 * The installed SDK interprets any string matching a component id as a child reference. Prefix
 * internal ids until none match a wire string, then rewrite only the actual reference fields.
 * Literal text, usage hints and binding paths retain their original meaning.
 */
export function _ConversationA2uiSdkComponents(frame: ConversationA2uiFrame): { readonly root: string; readonly components: ConversationA2uiComponent[] }
{
	const strings = new Set<string>();
	const pending: unknown[] = [...frame.components.values()];
	while (pending.length > 0)
	{
		const value = pending.pop();
		if (typeof value === "string")
			strings.add(value);
		else if (value !== null && typeof value === "object")
			pending.push(...Object.values(value));
	}
	let prefix = "display:";
	while ([...frame.components.keys()].some(id => strings.has(prefix + id)))
		prefix = "_" + prefix;
	const components = [...frame.components.values()].map(function _Rename(component): ConversationA2uiComponent
	{
		const definition = component.component;
		if (definition.Card)
			return { ...component, id: prefix + component.id, component: { Card: { child: prefix + definition.Card.child } } };
		if (definition.Row)
			return { ...component, id: prefix + component.id, component: { Row: { ...definition.Row, children: { explicitList: _ConversationA2uiChildren(component).map(id => prefix + id) } } } };
		if (definition.Column)
			return { ...component, id: prefix + component.id, component: { Column: { ...definition.Column, children: { explicitList: _ConversationA2uiChildren(component).map(id => prefix + id) } } } };
		return { ...component, id: prefix + component.id };
	});
	return { root: prefix + frame.root, components };
}
