import { AG_UI_A2UI_ENVELOPE_VERSION, AgUiA2uiSurfaceStates, type AgUiA2uiOperation } from "@opencrane/contracts";

import { A2uiComponentNames, type A2uiSurfacePresentation } from "./a2ui.types.js";

/** Maximum number of ordered protocol operations admitted in one display envelope. */
const _MAX_OPERATIONS = 256;

/** Maximum number of components admitted in one progressive surface update. */
const _MAX_COMPONENTS_PER_UPDATE = 256;

/** Longest allowed id (conversation, run, message, surface, component or action). */
const _MAX_IDENTIFIER_LENGTH = 256;

/** Longest allowed reason text. */
const _MAX_REASON_LENGTH = 2000;

/** The component names this deliberately small catalogue accepts. */
const _ADMITTED_COMPONENT_NAMES = new Set<string>(Object.values(A2uiComponentNames));

/** The surface states this element accepts. */
const _ADMITTED_SURFACE_STATES = new Set<string>(Object.values(AgUiA2uiSurfaceStates));

/**
 * Checks a whole presentation before the vendor MessageProcessor is allowed to see it.
 *
 * This is a second line of defence at the display layer only. Decoding the envelope, authorizing
 * the action, rebuilding the sequence and keeping raw payloads out are all still done by the
 * server and the state layer — a `true` here is not an authorization decision.
 *
 * It checks, in order: the envelope version and state are ones this element knows; all four ids
 * are non-empty and within {@link _MAX_IDENTIFIER_LENGTH}; `sequence` is a safe non-negative
 * integer; `reason` is within its length limit; there are no more than
 * {@link _MAX_OPERATIONS} operations; and every operation targets this surface and uses only
 * catalogue components.
 *
 * Called by: A2uiCanvasComponent._adoptPresentation, which clears the surface and shows the
 * non-disclosing placeholder when this returns false.
 *
 * @param presentation - The presentation about to be applied.
 * @returns `true` when it is safe to hand to the vendor. `false` means reject the whole
 *   presentation and show the placeholder; never apply it partially.
 * @see A2uiSurfacePresentation
 */
export function _AdmitA2uiSurfacePresentation(presentation: A2uiSurfacePresentation): boolean
{
	// 1. Check the envelope's version, state and ids, so a malformed projection cannot
	// point at another surface, or land on a state this component does not handle.
	if (presentation.version !== AG_UI_A2UI_ENVELOPE_VERSION || !_ADMITTED_SURFACE_STATES.has(presentation.state))
	{
		return false;
	}
	if (!_isIdentifier(presentation.conversationId) || !_isIdentifier(presentation.runId) || !_isIdentifier(presentation.messageId) || !_isIdentifier(presentation.surfaceId))
	{
		return false;
	}
	if (!Number.isSafeInteger(presentation.sequence) || presentation.sequence < 0)
	{
		return false;
	}
	if (presentation.reason !== undefined && presentation.reason.length > _MAX_REASON_LENGTH)
	{
		return false;
	}

	// 2. Cap how many operations there can be and check each one; their order is passed through unchanged.
	if (presentation.operations.length > _MAX_OPERATIONS)
	{
		return false;
	}
	for (const operation of presentation.operations)
	{
		if (!_isAdmittedOperation(operation, presentation.surfaceId))
		{
			return false;
		}
	}
	return true;
}

/** Whether one operation has exactly one key, targets this surface, and uses only catalogue components. */
function _isAdmittedOperation(operation: AgUiA2uiOperation, surfaceId: string): boolean
{
	const keys = Object.keys(operation);
	if (keys.length !== 1)
	{
		return false;
	}
	if ("beginRendering" in operation)
	{
		return operation.beginRendering.surfaceId === surfaceId;
	}
	if ("dataModelUpdate" in operation)
	{
		return operation.dataModelUpdate.surfaceId === surfaceId;
	}
	if (!("surfaceUpdate" in operation) || operation.surfaceUpdate.surfaceId !== surfaceId)
	{
		return false;
	}
	return _hasOnlyAdmittedComponents(operation.surfaceUpdate.components);
}

/** Whether a surface update holds a non-empty, size-limited list of wrappers that each name exactly one component. */
function _hasOnlyAdmittedComponents(components: readonly unknown[]): boolean
{
	if (components.length === 0 || components.length > _MAX_COMPONENTS_PER_UPDATE)
	{
		return false;
	}
	for (const component of components)
	{
		if (!_isRecord(component) || typeof component["id"] !== "string" || !_isIdentifier(component["id"]) || !_isRecord(component["component"]))
		{
			return false;
		}
		const componentNames = Object.keys(component["component"]);
		if (componentNames.length !== 1 || !_ADMITTED_COMPONENT_NAMES.has(componentNames[0]))
		{
			return false;
		}
		const name = componentNames[0];
		const properties = component["component"][name];
		if (_isChoiceName(name) && !_isAdmittedChoiceProperties(name, properties))
		{
			return false;
		}
	}
	return true;
}

/** Whether a component name is SingleChoice, MultipleChoice or Select. */
function _isChoiceName(name: string): name is A2uiComponentNames.SingleChoice | A2uiComponentNames.MultipleChoice | A2uiComponentNames.Select
{
	return name === A2uiComponentNames.SingleChoice || name === A2uiComponentNames.MultipleChoice || name === A2uiComponentNames.Select;
}

/** Whether choice properties stay within limits, are safe for the renderer, and respect maxAllowedSelections. */
function _isAdmittedChoiceProperties(name: A2uiComponentNames.SingleChoice | A2uiComponentNames.MultipleChoice | A2uiComponentNames.Select, value: unknown): boolean
{
	if (!_isRecord(value) || !Array.isArray(value["options"]) || !_isRecord(value["selections"]))
	{
		return false;
	}
	const limit = value["maxAllowedSelections"];
	if (name !== A2uiComponentNames.MultipleChoice && limit !== 1)
	{
		return false;
	}
	if (limit !== undefined && (!Number.isSafeInteger(limit) || Number(limit) < 1))
	{
		return false;
	}
	for (const option of value["options"])
	{
		if (!_isRecord(option) || typeof option["value"] !== "string" || !_isIdentifier(option["value"]) || !_isRecord(option["label"]))
		{
			return false;
		}
	}
	const selections = value["selections"];
	const literal = selections["literalArray"];
	if (literal !== undefined && (!Array.isArray(literal) || literal.some(function _NotSelection(item): boolean { return typeof item !== "string"; })))
	{
		return false;
	}
	const effectiveLimit = limit === undefined ? value["options"].length : Number(limit);
	return !Array.isArray(literal) || literal.length <= effectiveLimit;
}

/** Whether an id is non-empty and no longer than _MAX_IDENTIFIER_LENGTH. */
function _isIdentifier(value: string): boolean
{
	return value.length > 0 && value.length <= _MAX_IDENTIFIER_LENGTH;
}

/** Whether an unknown value is a non-null, non-array object. */
function _isRecord(value: unknown): value is Record<string, unknown>
{
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
