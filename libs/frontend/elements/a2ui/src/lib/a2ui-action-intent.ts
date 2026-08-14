import type { A2UIClientEvent } from "@a2ui/angular/v0_8";

import { AgUiA2uiSurfaceStates } from "@opencrane/contracts";

import type { A2uiDisplayedActionIntent, A2uiDisplayedValue, A2uiDisplayedValueScalar, A2uiSurfacePresentation } from "./a2ui.types";

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

/** Vendor event names that only change local form data; they never become an action. */
const _LOCAL_CONTROL_EVENT_NAMES = new Set<string>(["input", "change"]);

/** Keys that would let a payload change an object's prototype, so they are rejected. */
const _UNSAFE_VALUE_KEYS = new Set<string>(["__proto__", "constructor", "prototype"]);

/**
 * Converts one vendor renderer event into the intent the OpenCrane host may emit, or rejects it.
 *
 * This is the only way data leaves the renderer, so it is deliberately narrow. It returns null —
 * emitting nothing at all — when the surface is not Ready, when the event targets a different
 * surface, when the action or component id is missing or over-long, when the event is a local
 * `input`/`change` (those only prepare a later button press), or when any value in the context is
 * not a scalar or a flat array of scalars within the size limits. One bad value rejects the whole
 * event rather than being silently dropped.
 *
 * Completion Subjects, client timestamps, arbitrary protocol messages and nested objects are
 * always discarded. The ids are copied from the presentation so the server can work out for
 * itself what the action may do.
 *
 * Called by: A2uiCanvasComponent._handleRendererEvent, which emits the result on
 * `displayedAction` only when it is not null.
 *
 * @param presentation - The presentation currently displayed; supplies the ids and the state gate.
 * @param event - The vendor's client event.
 * @returns The intent to emit, or `null` meaning emit nothing — the caller must not fall back to a
 *   partial intent.
 * @see A2uiDisplayedActionIntent
 */
export function _ToA2uiDisplayedActionIntent(presentation: A2uiSurfacePresentation, event: A2UIClientEvent): A2uiDisplayedActionIntent | null
{
	// 1. Accept an action only when the surface is Ready and the ids match; input/change are
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

	// 2. Copy only size-limited scalar values, so raw provider payloads, credentials and arbitrary
	// nested protocol context can never leave this presentational component.
	const values = _admitDisplayedValues(action.context);
	if (values === null)
	{
		return null;
	}

	// 3. Tie the intent to the presentation it was displayed on, so the server can run
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

/** Copy the vendor's action context into display values, within limits, or reject all of it. */
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

/** Whether a value key is short enough and is not one that could alter object inheritance. */
function _isDisplayedValueKey(key: string): boolean
{
	return key.length > 0 && key.length <= _MAX_DISPLAYED_VALUE_KEY_LENGTH && !_UNSAFE_VALUE_KEYS.has(key);
}

/** Whether a context value is a scalar, or a flat array of scalars — the shape is deliberately shallow. */
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

/** Whether a scalar is a finite number, or a string within the length limit, and so may be copied out. */
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
