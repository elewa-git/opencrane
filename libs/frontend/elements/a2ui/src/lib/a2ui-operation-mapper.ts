import type { Types } from "@a2ui/angular/v0_8";

import { A2uiComponentNames } from "./a2ui.types.js";

/**
 * Map the three admitted OpenCrane choice contracts onto the upstream MultipleChoice wire shape.
 *
 * Component order and ids are retained exactly. Rewriting the wrapper name lets the upstream v0.8
 * schema and model processor validate all three contracts through its owned MultipleChoice path.
 */
export function _MapA2uiOperationsToUpstream(operations: readonly Types.ServerToClientMessage[]): Types.ServerToClientMessage[]
{
	const mapped: Types.ServerToClientMessage[] = [];
	for (const operation of operations)
	{
		if (!operation.surfaceUpdate)
		{
			mapped.push(operation);
			continue;
		}
		const components: unknown[] = [];
		for (const component of operation.surfaceUpdate.components)
		{
			components.push(_mapChoiceComponent(component));
		}
		mapped.push({
			surfaceUpdate:
			{
				...operation.surfaceUpdate,
				components
			}
		} as Types.ServerToClientMessage);
	}
	return mapped;
}

/** Rewrite an admitted choice wrapper while leaving every other component object untouched. */
function _mapChoiceComponent(component: unknown): unknown
{
	if (!_isRecord(component) || !_isRecord(component["component"]))
	{
		return component;
	}
	const wrapper = component["component"];
	const componentName = Object.keys(wrapper)[0];
	if (componentName !== A2uiComponentNames.SingleChoice && componentName !== A2uiComponentNames.Select)
	{
		return component;
	}
	return {
		...component,
		component: { [A2uiComponentNames.MultipleChoice]: wrapper[componentName] }
	};
}

/** Whether an unknown value is a non-null, non-array object. */
function _isRecord(value: unknown): value is Record<string, unknown>
{
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
