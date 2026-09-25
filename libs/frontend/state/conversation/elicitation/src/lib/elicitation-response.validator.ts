import { CONVERSATION_ELICITATION_VERSION, ElicitationApprovalScopes, ElicitationBodyKinds, ElicitationPurposes, ElicitationRequestStates, ___ConversationToolArgumentsSchema, ___ElicitationExecutionConnectionSchema, type ConversationElicitation, type ElicitationBody, type ElicitationChoice, type ElicitationResponseProjection } from "@opencrane/contracts";

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
	if (purpose === ElicitationPurposes.ToolApproval && body.kind === ElicitationBodyKinds.Approval && body.proposedArguments === undefined)
		throw new TypeError("tool approval arguments are missing");
	if (purpose === ElicitationPurposes.ToolApproval && (body.kind !== ElicitationBodyKinds.Approval || body.executionConnection === undefined))
		throw new TypeError("tool approval connection disclosure is missing");
	if (purpose !== ElicitationPurposes.ToolApproval && body.kind === ElicitationBodyKinds.Approval && body.executionConnection !== undefined)
		throw new TypeError("connection disclosure is only supported for tool approvals");
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
	if (value["kind"] !== ElicitationBodyKinds.Approval && "executionConnection" in value)
		throw new TypeError("connection disclosure requires an approval body");
	if (value["kind"] === ElicitationBodyKinds.Approval && _BoundedString(value["action"], 1_000) && _BoundedString(value["target"], 1_000) && _BoundedString(value["dataUse"], 2_000) && _BoundedString(value["consequence"], 2_000))
	{
		const externalSystem = _BoundedString(value["externalSystem"], 500) ? { externalSystem: value["externalSystem"] } : {};
		const cost = _BoundedString(value["cost"], 500) ? { cost: value["cost"] } : {};
		const proposedArguments = _ProposedArguments(value);
		const executionConnection = _ExecutionConnection(value);
		const approvalScopes = _ApprovalScopes(value);
		return { kind: value["kind"], prompt: value["prompt"], action: value["action"], target: value["target"], dataUse: value["dataUse"], consequence: value["consequence"], ...proposedArguments, ...externalSystem, ...cost, ...executionConnection, ...approvalScopes };
	}
	const choices = _Choices(value["choices"]);
	if (value["kind"] === ElicitationBodyKinds.SingleChoice && choices !== null) return { kind: value["kind"], prompt: value["prompt"], choices };
	if (value["kind"] === ElicitationBodyKinds.MultipleChoice && choices !== null && Number.isSafeInteger(value["minimumSelections"]) && Number.isSafeInteger(value["maximumSelections"]) && (value["minimumSelections"] as number) >= 0 && (value["maximumSelections"] as number) >= (value["minimumSelections"] as number) && (value["maximumSelections"] as number) <= choices.length) return { kind: value["kind"], prompt: value["prompt"], choices, minimumSelections: value["minimumSelections"] as number, maximumSelections: value["maximumSelections"] as number };
	if (value["kind"] === ElicitationBodyKinds.FreeText && Number.isSafeInteger(value["maximumLength"]) && (value["maximumLength"] as number) > 0 && (value["maximumLength"] as number) <= 20_000 && typeof value["allowEmpty"] === "boolean") return { kind: value["kind"], prompt: value["prompt"], maximumLength: value["maximumLength"] as number, allowEmpty: value["allowEmpty"] };
	throw new TypeError("elicitation body kind is invalid");
}

/** Preserve only the two server-owned approval scopes and require complete standing-scope copy. */
function _ApprovalScopes(value: Record<string, unknown>): Pick<Extract<ElicitationBody, { readonly kind: ElicitationBodyKinds.Approval }>, "offeredScopes" | "standingScope"> | Record<string, never>
{
	if (!("offeredScopes" in value) && !("standingScope" in value))
		return {};
	if (!Array.isArray(value["offeredScopes"]) || value["offeredScopes"].length < 1 || value["offeredScopes"].length > 2 || value["offeredScopes"][0] !== ElicitationApprovalScopes.Once || new Set(value["offeredScopes"]).size !== value["offeredScopes"].length || value["offeredScopes"].some(scope => !Object.values(ElicitationApprovalScopes).includes(scope as ElicitationApprovalScopes)))
		throw new TypeError("elicitation approval scopes are invalid");
	const offeredScopes = value["offeredScopes"] as ElicitationApprovalScopes[];
	const offersAlways = offeredScopes.includes(ElicitationApprovalScopes.Always);
	if (!offersAlways && value["standingScope"] !== undefined)
		throw new TypeError("standing approval explanation was not offered");
	if (!offersAlways)
		return { offeredScopes };
	const standingScope = value["standingScope"];
	if (!_Record(standingScope) || Object.keys(standingScope).length !== 1 || !_BoundedString(standingScope["explanation"], 4_000))
		throw new TypeError("standing approval explanation is invalid");
	if (value["proposedArguments"] === null || value["proposedArguments"] === undefined)
		throw new TypeError("standing approval requires reviewable arguments");
	return { offeredScopes, standingScope: { explanation: standingScope["explanation"] } };
}

/** Validate supplied connection details without dropping unknown or malformed fields. */
function _ExecutionConnection(value: Record<string, unknown>): Pick<Extract<ElicitationBody, { readonly kind: ElicitationBodyKinds.Approval }>, "executionConnection"> | Record<string, never>
{
	if (!("executionConnection" in value))
		return {};
	const parsed = ___ElicitationExecutionConnectionSchema.safeParse(value["executionConnection"]);
	if (!parsed.success)
		throw new TypeError("elicitation connection disclosure is invalid");
	return { executionConnection: parsed.data };
}

/** Preserve omitted and explicitly hidden proposal arguments while validating every visible object. */
function _ProposedArguments(value: Record<string, unknown>): Pick<Extract<ElicitationBody, { readonly kind: ElicitationBodyKinds.Approval }>, "proposedArguments"> | Record<string, never>
{
	if (!("proposedArguments" in value))
		return {};
	if (value["proposedArguments"] === null)
		return { proposedArguments: null };
	const parsed = ___ConversationToolArgumentsSchema.safeParse(value["proposedArguments"]);
	if (!parsed.success)
		throw new TypeError("elicitation approval arguments are invalid");
	return { proposedArguments: parsed.data };
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
