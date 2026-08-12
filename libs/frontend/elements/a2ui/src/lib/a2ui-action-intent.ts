import type { A2UIClientEvent } from "@a2ui/angular/v0_8";

import { AgUiA2uiSurfaceStates } from "@opencrane/contracts";

import type { A2uiDisplayedActionIntent, A2uiDisplayedValue, A2uiDisplayedValueScalar, A2uiSurfacePresentation } from "./a2ui.types.js";

/** Maximum length of a displayed action or source-component identifier. */
const _MAX_IDENTIFIER_LENGTH = 256;

/** Maximum number of displayed values copied into one action intent. */
const _MAX_DISPLAYED_VALUE_COUNT = 32;

/** Maximum length of a displayed value key. */
const _MAX_DISPLAYED_VALUE_KEY_LENGTH = 128;

/** Maximum length of a displayed string value. */
const _MAX_DISPLAYED_STRING_LENGTH = 4096;

/** Maximum number of scalars admitted in one displayed array value. */
const _MAX_DISPLAYED_ARRAY_LENGTH = 64;

/** Upstream control events that mutate local display data but are not displayed action ids. */
const _LOCAL_CONTROL_EVENT_NAMES = new Set<string>(["input", "change"]);

/** Property names that could mutate an ordinary JavaScript object's prototype chain. */
const _UNSAFE_VALUE_KEYS = new Set<string>(["__proto__", "constructor", "prototype"]);

/**
 * Convert one upstream renderer event into the narrow intent accepted by the OpenCrane host.
 *
 * Completion subjects, client timestamps, arbitrary protocol messages, and nested objects are
 * deliberately discarded. The server reconstructs authority from the copied display coordinates.
 */
export function _ToA2uiDisplayedActionIntent(presentation: A2uiSurfacePresentation, event: A2UIClientEvent): A2uiDisplayedActionIntent | null
{
	// 1. Accept only explicit actions displayed on the exact ready presentation; input/change are
	// local data-model events used to prepare a later displayed button action.
	const action = event.message.userAction;
	if (presentation.state !== AgUiA2uiSurfaceStates.Ready || !action || action.surfaceId !== presentation.surfaceId)
	{
		return null;
	}
	if (!_isIdentifier(action.name) || !_isIdentifier(action.sourceComponentId) || _LOCAL_CONTROL_EVENT_NAMES.has(action.name))
	{
		return null;
	}

	// 2. Copy only bounded scalar values so raw provider payloads, proof material, and arbitrary
	// nested protocol context can never leave this presentational component.
	const values = _admitDisplayedValues(action.context);
	if (values === null)
	{
		return null;
	}

	// 3. Bind the intent to the exact displayed projection so the authenticated server can perform
	// its own authorization and one-use checks without trusting the renderer for authority.
	return {
		version: presentation.version,
		conversationId: presentation.conversationId,
		runId: presentation.runId,
		messageId: presentation.messageId,
		surfaceId: presentation.surfaceId,
		sequence: presentation.sequence,
		displayedActionId: action.name,
		sourceComponentId: action.sourceComponentId,
		values
	};
}

/** Copy and bound the upstream action context as display values, or reject it wholesale. */
function _admitDisplayedValues(raw: Record<string, unknown> | undefined): Readonly<Record<string, A2uiDisplayedValue>> | null
{
	if (raw === undefined)
	{
		return Object.freeze({});
	}
	const entries = Object.entries(raw);
	if (entries.length > _MAX_DISPLAYED_VALUE_COUNT)
	{
		return null;
	}
	const values: Record<string, A2uiDisplayedValue> = {};
	for (const [key, value] of entries)
	{
		if (!_isDisplayedValueKey(key) || !_isDisplayedValue(value))
		{
			return null;
		}
		values[key] = Array.isArray(value) ? Object.freeze([...value]) as readonly A2uiDisplayedValueScalar[] : value;
	}
	return Object.freeze(values);
}

/** Whether a copied value key is bounded and cannot alter object inheritance. */
function _isDisplayedValueKey(key: string): boolean
{
	return key.length > 0 && key.length <= _MAX_DISPLAYED_VALUE_KEY_LENGTH && !_UNSAFE_VALUE_KEYS.has(key);
}

/** Whether an upstream context value fits the intentionally shallow displayed-value contract. */
function _isDisplayedValue(value: unknown): value is A2uiDisplayedValue
{
	if (_isDisplayedScalar(value))
	{
		return true;
	}
	if (!Array.isArray(value) || value.length > _MAX_DISPLAYED_ARRAY_LENGTH)
	{
		return false;
	}
	for (const item of value)
	{
		if (!_isDisplayedScalar(item))
		{
			return false;
		}
	}
	return true;
}

/** Whether a scalar is finite and bounded enough to cross the displayed-action boundary. */
function _isDisplayedScalar(value: unknown): value is A2uiDisplayedValueScalar
{
	if (value === null || typeof value === "boolean")
	{
		return true;
	}
	if (typeof value === "number")
	{
		return Number.isFinite(value);
	}
	return typeof value === "string" && value.length <= _MAX_DISPLAYED_STRING_LENGTH;
}

/** Whether a displayed action or component identifier is present and bounded. */
function _isIdentifier(value: string): boolean
{
	return value.length > 0 && value.length <= _MAX_IDENTIFIER_LENGTH;
}
