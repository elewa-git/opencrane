import { CONVERSATION_ELICITATION_VERSION, ElicitationBodyKinds, ElicitationPurposes, ElicitationRequestStates, type ConversationElicitation, type ElicitationBody, type ElicitationChoice, type ElicitationResponseProjection } from "@opencrane/contracts";

/** Parse one untrusted browser-safe request projection. */
export function __ParseConversationElicitation(value: unknown): ConversationElicitation
{
	if (!_Record(value)) throw new TypeError("elicitation response is not an object");
	const body = _Body(value["body"]);
	const state = value["state"];
	const purpose = value["purpose"];
	if (value["version"] !== CONVERSATION_ELICITATION_VERSION || !_Identifier(value["requestId"]) || !_Identifier(value["conversationId"]) || !_Identifier(value["runId"]) || !Number.isSafeInteger(value["attempt"]) || (value["attempt"] as number) < 1 || !_Identifier(value["assignedParticipantId"]) || !Object.values(ElicitationPurposes).includes(purpose as ElicitationPurposes) || !Object.values(ElicitationRequestStates).includes(state as ElicitationRequestStates) || typeof value["requiresStepUp"] !== "boolean" || !_Instant(value["requestedAt"]) || !_Instant(value["expiresAt"])) throw new TypeError("elicitation response has invalid coordinates");
	if (value["resolvedAt"] !== undefined && !_Instant(value["resolvedAt"])) throw new TypeError("elicitation terminal time is invalid");
	if (value["safeReason"] !== undefined && !_BoundedString(value["safeReason"], 200)) throw new TypeError("elicitation reason is invalid");
	const resolvedAt = value["resolvedAt"] === undefined ? {} : { resolvedAt: value["resolvedAt"] as string };
	const safeReason = value["safeReason"] === undefined ? {} : { safeReason: value["safeReason"] as string };
	return { version: CONVERSATION_ELICITATION_VERSION, requestId: value["requestId"], conversationId: value["conversationId"], runId: value["runId"], attempt: value["attempt"] as number, assignedParticipantId: value["assignedParticipantId"], purpose: purpose as ElicitationPurposes, state: state as ElicitationRequestStates, body, requiresStepUp: value["requiresStepUp"], requestedAt: value["requestedAt"], expiresAt: value["expiresAt"], ...resolvedAt, ...safeReason };
}

/** Parse the authoritative response acknowledgement. */
export function __ParseElicitationResponseProjection(value: unknown): ElicitationResponseProjection
{
	if (!_Record(value) || !_Identifier(value["requestId"]) || !Object.values(ElicitationRequestStates).includes(value["state"] as ElicitationRequestStates) || typeof value["idempotent"] !== "boolean" || !_Instant(value["resolvedAt"])) throw new TypeError("elicitation response acknowledgement is invalid");
	return { requestId: value["requestId"], state: value["state"] as ElicitationRequestStates, idempotent: value["idempotent"], resolvedAt: value["resolvedAt"] };
}

/** Parse one supported interaction body. */
function _Body(value: unknown): ElicitationBody
{
	if (!_Record(value) || !_BoundedString(value["prompt"], 4_000)) throw new TypeError("elicitation body is invalid");
	if (value["kind"] === ElicitationBodyKinds.Approval && _BoundedString(value["action"], 1_000) && _BoundedString(value["target"], 1_000) && _BoundedString(value["dataUse"], 2_000) && _BoundedString(value["consequence"], 2_000))
	{
		const externalSystem = _BoundedString(value["externalSystem"], 500) ? { externalSystem: value["externalSystem"] } : {};
		const cost = _BoundedString(value["cost"], 500) ? { cost: value["cost"] } : {};
		return { kind: value["kind"], prompt: value["prompt"], action: value["action"], target: value["target"], dataUse: value["dataUse"], consequence: value["consequence"], ...externalSystem, ...cost };
	}
	const choices = _Choices(value["choices"]);
	if (value["kind"] === ElicitationBodyKinds.SingleChoice && choices !== null) return { kind: value["kind"], prompt: value["prompt"], choices };
	if (value["kind"] === ElicitationBodyKinds.MultipleChoice && choices !== null && Number.isSafeInteger(value["minimumSelections"]) && Number.isSafeInteger(value["maximumSelections"]) && (value["minimumSelections"] as number) >= 0 && (value["maximumSelections"] as number) >= (value["minimumSelections"] as number) && (value["maximumSelections"] as number) <= choices.length) return { kind: value["kind"], prompt: value["prompt"], choices, minimumSelections: value["minimumSelections"] as number, maximumSelections: value["maximumSelections"] as number };
	if (value["kind"] === ElicitationBodyKinds.FreeText && Number.isSafeInteger(value["maximumLength"]) && (value["maximumLength"] as number) > 0 && (value["maximumLength"] as number) <= 20_000 && typeof value["allowEmpty"] === "boolean") return { kind: value["kind"], prompt: value["prompt"], maximumLength: value["maximumLength"] as number, allowEmpty: value["allowEmpty"] };
	throw new TypeError("elicitation body kind is invalid");
}

/** Parse a bounded unique choice list. */
function _Choices(value: unknown): readonly ElicitationChoice[] | null
{
	if (!Array.isArray(value) || value.length < 1 || value.length > 50) return null;
	const choices: ElicitationChoice[] = [];
	const values = new Set<string>();
	for (const candidate of value)
	{
		if (!_Record(candidate) || !_Identifier(candidate["value"]) || !_BoundedString(candidate["label"], 1_000) || values.has(candidate["value"])) return null;
		if (candidate["description"] !== undefined && !_BoundedString(candidate["description"], 2_000)) return null;
		values.add(candidate["value"]);
		choices.push({ value: candidate["value"], label: candidate["label"], ...(candidate["description"] === undefined ? {} : { description: candidate["description"] as string }) });
	}
	return choices;
}

function _Record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function _Identifier(value: unknown): value is string { return _BoundedString(value, 256); }
function _BoundedString(value: unknown, maximum: number): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= maximum; }
function _Instant(value: unknown): value is string { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }
