import { Schemas } from "@a2ui/web_core/v0_8";
import { Ajv } from "ajv";

import { AG_UI_A2UI_ENVELOPE_VERSION, AgUiA2uiSurfaceStates, type AgUiA2uiEnvelope } from "./ag-ui-projection.types.js";

/** Maximum number of ordered operations admitted in one governed surface envelope. */
const _MAX_A2UI_OPERATIONS = 256;

/** Maximum number of components admitted in one progressive surface update. */
const _MAX_A2UI_COMPONENTS = 256;

/** Maximum length of a stable presentation coordinate. */
const _MAX_A2UI_IDENTIFIER_LENGTH = 256;

/** Maximum length of a server-selected display-safe lifecycle explanation. */
const _MAX_A2UI_REASON_LENGTH = 2000;

/** Canonical OpenCrane v4 component contracts admitted by the governed catalogue. */
const _A2UI_COMPONENT_NAMES = new Set<string>(["Text", "Button", "TextField", "SingleChoice", "MultipleChoice", "Select", "Slider", "DateTimeInput", "Image", "Card", "List"]);

/** Exact authoritative presentation states admitted across the public projection boundary. */
const _A2UI_SURFACE_STATES = new Set<string>(Object.values(AgUiA2uiSurfaceStates));

/** Pinned upstream v0.8 operation validator, compiled once for every projection consumer. */
const _VALIDATE_A2UI_OPERATION = new Ajv({ strict: false }).compile(Schemas.A2UIClientEventMessage);

/**
 * Parse one complete governed A2UI envelope without granting local action or lifecycle authority.
 *
 * The pinned upstream schema validates complete component properties and data updates. OpenCrane's
 * additional boundary admits only its exact envelope, operation vocabulary, surface coordinate,
 * bounds, and eleven-name catalogue before those values can reach a renderer.
 */
export function ___ParseAgUiA2uiEnvelope(value: unknown): AgUiA2uiEnvelope
{
	if (!_Record(value) || !_ExactKeys(value, ["version", "conversationId", "runId", "messageId", "surfaceId", "sequence", "state", "operations"], ["reason"])) throw new TypeError("invalid governed A2UI envelope");
	if (value["version"] !== AG_UI_A2UI_ENVELOPE_VERSION || !_Identifier(value["conversationId"]) || !_Identifier(value["runId"]) || !_Identifier(value["messageId"]) || !_Identifier(value["surfaceId"])) throw new TypeError("invalid governed A2UI coordinates");
	if (!Number.isSafeInteger(value["sequence"]) || (value["sequence"] as number) < 0 || typeof value["state"] !== "string" || !_A2UI_SURFACE_STATES.has(value["state"])) throw new TypeError("invalid governed A2UI lifecycle");
	if (value["reason"] !== undefined && (typeof value["reason"] !== "string" || value["reason"].length > _MAX_A2UI_REASON_LENGTH || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value["reason"]))) throw new TypeError("invalid governed A2UI reason");
	if (!Array.isArray(value["operations"]) || value["operations"].length === 0 || value["operations"].length > _MAX_A2UI_OPERATIONS || value["operations"].some(function _Invalid(operation): boolean { return !_A2uiOperation(operation, value["surfaceId"] as string); })) throw new TypeError("invalid governed A2UI operations");
	if (_HasSecretField(value)) throw new TypeError("governed A2UI envelope contains a sensitive field");
	return value as unknown as AgUiA2uiEnvelope;
}

/** Whether one operation is singular, surface-bound, bounded, and catalogue-safe. */
function _A2uiOperation(value: unknown, surfaceId: string): boolean
{
	if (!_Record(value) || Object.keys(value).length !== 1 || !_VALIDATE_A2UI_OPERATION(_UpstreamA2uiOperation(value))) return false;
	if (value["beginRendering"] !== undefined) return _BeginRendering(value["beginRendering"], surfaceId);
	if (value["dataModelUpdate"] !== undefined) return _DataModelUpdate(value["dataModelUpdate"], surfaceId);
	return _SurfaceUpdate(value["surfaceUpdate"], surfaceId);
}

/** Validate the two OpenCrane one-value display contracts through the upstream MultipleChoice property schema. */
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

/** Whether one begin-rendering operation uses only the pinned upstream fields. */
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

/** Whether one data-model update is exact, surface-bound, and recursively typed. */
function _DataModelUpdate(value: unknown, surfaceId: string): boolean
{
	if (!_Record(value) || !_ExactKeys(value, ["surfaceId", "contents"], ["path"]) || value["surfaceId"] !== surfaceId || !Array.isArray(value["contents"]) || value["contents"].length > _MAX_A2UI_COMPONENTS) return false;
	if (value["path"] !== undefined && (typeof value["path"] !== "string" || _SensitiveName(value["path"]))) return false;
	return value["contents"].every(function _Valid(entry): boolean { return _DataValue(entry, 1); });
}

/** Whether one recursive A2UI data value has exactly one typed value member. */
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

/** Whether one surface update contains only exact component wrappers from the governed catalogue. */
function _SurfaceUpdate(value: unknown, surfaceId: string): boolean
{
	if (!_Record(value) || !_ExactKeys(value, ["surfaceId", "components"], []) || value["surfaceId"] !== surfaceId || !Array.isArray(value["components"]) || value["components"].length === 0 || value["components"].length > _MAX_A2UI_COMPONENTS) return false;
	return value["components"].every(_A2uiComponent);
}

/** Whether one component instance has one admitted OpenCrane catalogue contract and exact outer fields. */
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

/** Whether a stable coordinate is present, bounded, and free from control characters. */
function _Identifier(value: unknown): value is string
{
	return typeof value === "string" && value.length > 0 && value.length <= _MAX_A2UI_IDENTIFIER_LENGTH && !/[\u0000-\u001f\u007f]/u.test(value);
}

/** Whether a record contains exactly its required and optional key vocabulary. */
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

/** Whether a field or logical data key is shaped like forbidden credential material. */
function _SensitiveName(value: string): boolean { return /secret|token|password|credential|authorization/iu.test(value); }

/** Whether an unknown value is a non-null, non-array object. */
function _Record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
