import { Schemas } from "@a2ui/web_core/v0_8";
import { Ajv } from "ajv";

import { AG_UI_A2UI_ENVELOPE_VERSION, AgUiA2uiSurfaceStates, type AgUiA2uiEnvelope } from "./ag-ui-projection.types.js";

/** Maximum number of operations one A2UI envelope may carry. */
const _MAX_A2UI_OPERATIONS = 256;

/** Maximum number of components one surface update may carry. */
const _MAX_A2UI_COMPONENTS = 256;

/** Maximum length of an id in the envelope, such as `surfaceId` or `messageId`. */
const _MAX_A2UI_IDENTIFIER_LENGTH = 256;

/** Maximum length of the server-written `reason` text shown to the user. */
const _MAX_A2UI_REASON_LENGTH = 2000;

/** The eleven component names OpenCrane's v4 catalogue allows. */
const _A2UI_COMPONENT_NAMES = new Set<string>(["Text", "Button", "TextField", "SingleChoice", "MultipleChoice", "Select", "Slider", "DateTimeInput", "Image", "Card", "List"]);

/** The only display states this parser accepts. @see AgUiA2uiSurfaceStates */
const _A2UI_SURFACE_STATES = new Set<string>(Object.values(AgUiA2uiSurfaceStates));

/**
 * Validator built from the upstream A2UI v0.8 schema, compiled once and shared by every consumer.
 *
 * The version is pinned to v0.8 because that is what the `@a2ui/web_core` dependency ships. Upstream
 * has since moved on and marks v0.8 legacy, so this cannot be bumped by editing the string here — the
 * dependency and this schema move together.
 * @see https://a2ui.org/specification/v0.8-a2ui/ — the pinned revision.
 */
const _VALIDATE_A2UI_OPERATION = new Ajv({ strict: false }).compile(Schemas.A2UIClientEventMessage);

/**
 * Parse one A2UI envelope sent by an agent, returning it only if every part is allowed.
 *
 * A2UI lets an agent describe a user interface as JSON, which the client then renders with its own
 * components. That means the agent's output reaches the screen, so it is checked twice. The upstream
 * schema checks the shape of components and data updates. Everything after that is OpenCrane's own
 * limit: the envelope's exact keys, the operations it may contain, its size caps, and a fixed
 * catalogue of eleven component names. A component the agent invents is refused rather than rendered.
 *
 * The envelope is data, never code, and parsing it grants nothing: it cannot start an action or move
 * a run's lifecycle.
 *
 * @param value - Untrusted JSON as it arrived from the agent runtime.
 * @returns The same envelope, once every check has passed.
 * @throws TypeError with a short reason when any check fails. There is no partial success — a
 * rejected envelope renders nothing.
 * @see https://a2ui.org/specification/v0.8-a2ui/ — the A2UI revision this accepts.
 * @see https://docs.ag-ui.com — AG-UI, the event protocol that carries this envelope to the client.
 */
export function ___ParseAgUiA2uiEnvelope(value: unknown): AgUiA2uiEnvelope
{
	if (!_Record(value) || !_ExactKeys(value, ["version", "conversationId", "runId", "messageId", "surfaceId", "sequence", "state", "operations"], ["reason", "actionBinding"])) throw new TypeError("invalid governed A2UI envelope");
	if (value["version"] !== AG_UI_A2UI_ENVELOPE_VERSION || !_Identifier(value["conversationId"]) || !_Identifier(value["runId"]) || !_Identifier(value["messageId"]) || !_Identifier(value["surfaceId"])) throw new TypeError("invalid governed A2UI coordinates");
	if (!Number.isSafeInteger(value["sequence"]) || (value["sequence"] as number) < 0 || typeof value["state"] !== "string" || !_A2UI_SURFACE_STATES.has(value["state"])) throw new TypeError("invalid governed A2UI lifecycle");
	if (value["reason"] !== undefined && (typeof value["reason"] !== "string" || value["reason"].length > _MAX_A2UI_REASON_LENGTH || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value["reason"]))) throw new TypeError("invalid governed A2UI reason");
	if (value["actionBinding"] !== undefined && !_ActionBinding(value["actionBinding"])) throw new TypeError("invalid governed A2UI action binding");
	if (!Array.isArray(value["operations"]) || value["operations"].length === 0 || value["operations"].length > _MAX_A2UI_OPERATIONS || value["operations"].some(function _Invalid(operation): boolean { return !_A2uiOperation(operation, value["surfaceId"] as string); })) throw new TypeError("invalid governed A2UI operations");
	if (_HasSecretField(value)) throw new TypeError("governed A2UI envelope contains a sensitive field");
	return value as unknown as AgUiA2uiEnvelope;
}

/** Whether one display action names only its exact existing server-side elicitation request. */
function _ActionBinding(value: unknown): boolean
{
	return _Record(value)
		&& _ExactKeys(value, ["displayedActionId", "sourceComponentId", "elicitationRequestId"], [])
		&& _Identifier(value["displayedActionId"])
		&& _Identifier(value["sourceComponentId"])
		&& _Identifier(value["elicitationRequestId"]);
}

/** Whether an operation has exactly one member, targets this `surfaceId`, stays within the size caps, and uses only catalogue components. */
function _A2uiOperation(value: unknown, surfaceId: string): boolean
{
	if (!_Record(value) || Object.keys(value).length !== 1 || !_VALIDATE_A2UI_OPERATION(_UpstreamA2uiOperation(value))) return false;
	if (value["beginRendering"] !== undefined) return _BeginRendering(value["beginRendering"], surfaceId);
	if (value["dataModelUpdate"] !== undefined) return _DataModelUpdate(value["dataModelUpdate"], surfaceId);
	return _SurfaceUpdate(value["surfaceUpdate"], surfaceId);
}

/** Validate `SingleChoice` and `Select` against the upstream `MultipleChoice` schema, since upstream has no schema for either. */
function _UpstreamA2uiOperation(value: Record<string, unknown>): Record<string, unknown>
{
	const update = value["surfaceUpdate"];
	if (!_Record(update) || !Array.isArray(update["components"])) return value;
	const components = update["components"].map(function _UpstreamComponent(component): unknown
	{
		if (!_Record(component) || !_Record(component["component"])) return component;
		const wrapper = component["component"];
		const name = Object.keys(wrapper)[0];
		if (name !== "SingleChoice" && name !== "Select") return component;
		return { ...component, component: { MultipleChoice: wrapper[name] } };
	});
	return { surfaceUpdate: { ...update, components } };
}

/** Whether a begin-rendering operation carries only the fields the pinned upstream schema defines. */
function _BeginRendering(value: unknown, surfaceId: string): boolean
{
	if (!_Record(value) || !_ExactKeys(value, ["surfaceId", "root"], ["catalogId", "styles"]) || value["surfaceId"] !== surfaceId || !_Identifier(value["root"])) return false;
	if (value["catalogId"] !== undefined && !_Identifier(value["catalogId"])) return false;
	if (value["styles"] === undefined) return true;
	if (!_Record(value["styles"]) || !_ExactKeys(value["styles"], [], ["font", "primaryColor"])) return false;
	const font = value["styles"]["font"];
	const primaryColor = value["styles"]["primaryColor"];
	return (font === undefined || typeof font === "string") && (primaryColor === undefined || typeof primaryColor === "string" && /^#[0-9a-f]{6}$/iu.test(primaryColor));
}

/** Whether a data-model update has only its allowed keys, targets this `surfaceId`, and has valid values at every nesting level. */
function _DataModelUpdate(value: unknown, surfaceId: string): boolean
{
	if (!_Record(value) || !_ExactKeys(value, ["surfaceId", "contents"], ["path"]) || value["surfaceId"] !== surfaceId || !Array.isArray(value["contents"]) || value["contents"].length > _MAX_A2UI_COMPONENTS) return false;
	if (value["path"] !== undefined && (typeof value["path"] !== "string" || _SensitiveName(value["path"]))) return false;
	return value["contents"].every(function _Valid(entry): boolean { return _DataValue(entry, 1); });
}

/** Whether an A2UI data value sets exactly one of `valueString`, `valueNumber`, `valueBoolean`, or `valueMap`. */
function _DataValue(value: unknown, depth: number): boolean
{
	if (depth > 5 || !_Record(value) || !_ExactKeys(value, ["key"], ["valueString", "valueNumber", "valueBoolean", "valueMap"]) || typeof value["key"] !== "string" || _SensitiveName(value["key"])) return false;
	const members = [value["valueString"], value["valueNumber"], value["valueBoolean"], value["valueMap"]].filter(function _Present(member): boolean { return member !== undefined; });
	if (members.length !== 1) return false;
	if (value["valueString"] !== undefined) return typeof value["valueString"] === "string";
	if (value["valueNumber"] !== undefined) return typeof value["valueNumber"] === "number" && Number.isFinite(value["valueNumber"]);
	if (value["valueBoolean"] !== undefined) return typeof value["valueBoolean"] === "boolean";
	return Array.isArray(value["valueMap"]) && value["valueMap"].every(function _Valid(entry): boolean { return _DataValue(entry, depth + 1); });
}

/** Whether a surface update contains only components from the allowed catalogue. */
function _SurfaceUpdate(value: unknown, surfaceId: string): boolean
{
	if (!_Record(value) || !_ExactKeys(value, ["surfaceId", "components"], []) || value["surfaceId"] !== surfaceId || !Array.isArray(value["components"]) || value["components"].length === 0 || value["components"].length > _MAX_A2UI_COMPONENTS) return false;
	return value["components"].every(_A2uiComponent);
}

/** Whether a component names one allowed catalogue component and carries only `id`, `component`, and optional `weight`. */
function _A2uiComponent(value: unknown): boolean
{
	if (!_Record(value) || !_ExactKeys(value, ["id", "component"], ["weight"]) || !_Identifier(value["id"]) || !_Record(value["component"])) return false;
	if (value["weight"] !== undefined && (typeof value["weight"] !== "number" || !Number.isFinite(value["weight"]))) return false;
	const names = Object.keys(value["component"]);
	const name = names[0] ?? "";
	const properties = value["component"][name];
	if (names.length !== 1 || !_A2UI_COMPONENT_NAMES.has(name) || !_Record(properties)) return false;
	return name !== "SingleChoice" && name !== "Select" || properties["maxAllowedSelections"] === 1;
}

/** Whether an id is non-empty, within the length cap, and free of control characters. */
function _Identifier(value: unknown): value is string
{
	return typeof value === "string" && value.length > 0 && value.length <= _MAX_A2UI_IDENTIFIER_LENGTH && !/[\u0000-\u001f\u007f]/u.test(value);
}

/** Whether a record has every required key and no key outside the optional list. */
function _ExactKeys(value: Readonly<Record<string, unknown>>, required: readonly string[], optional: readonly string[]): boolean
{
	const keys = Object.keys(value);
	return required.every(function _Required(key): boolean { return Object.hasOwn(value, key); }) && keys.every(function _Known(key): boolean { return required.includes(key) || optional.includes(key); });
}

/** Reject credential-like field names recursively before the presentation boundary. */
function _HasSecretField(value: unknown): boolean
{
	if (Array.isArray(value)) return value.some(_HasSecretField);
	if (!_Record(value)) return false;
	return Object.entries(value).some(function _Sensitive([key, nested]): boolean { return _SensitiveName(key) || _HasSecretField(nested); });
}

/** Whether a field or data key name contains secret, token, password, credential, or authorization. */
function _SensitiveName(value: string): boolean { return /secret|token|password|credential|authorization/iu.test(value); }

/** Whether an unknown value is a non-null, non-array object. */
function _Record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
