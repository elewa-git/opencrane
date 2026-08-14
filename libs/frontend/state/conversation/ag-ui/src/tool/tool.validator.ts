import { AgUiToolRecoveryProviderOutcomes, type AgUiToolFailureEnvelope, type AgUiToolRecoveryRequiredEnvelope } from "@opencrane/contracts";

import { _BoundedIdentifier, _CanonicalInstant } from "../bounded-value.validator.js";

/** The provider outcomes a recovery event may carry; anything else is rejected. */
const _TOOL_RECOVERY_PROVIDER_OUTCOMES = new Set<string>(Object.values(AgUiToolRecoveryProviderOutcomes));

/** Whether a CUSTOM payload is a valid tool-failure envelope: no unexpected keys, and the exact eventType. */
export function _IsToolFailure(value: unknown): value is AgUiToolFailureEnvelope
{
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const candidate = value as Record<string, unknown>;
	const keys = Object.keys(candidate);
	if (keys.some(function _Unknown(key): boolean { return key !== "eventType" && key !== "toolCallId" && key !== "failureCode" && key !== "retrying" && key !== "technicalDetails"; })) return false;
	return candidate["eventType"] === "tool.failed" && _BoundedIdentifier(candidate["toolCallId"]) && (candidate["failureCode"] === undefined || typeof candidate["failureCode"] === "string") && typeof candidate["retrying"] === "boolean" && _IsSafeToolTechnicalDetails(candidate["technicalDetails"]);
}

/** Admit only the exact progressive-disclosure fields selected by the server. */
export function _IsSafeToolTechnicalDetails(value: unknown): value is AgUiToolFailureEnvelope["technicalDetails"]
{
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const candidate = value as Record<string, unknown>;
	const required = ["toolIdentifier", "toolRevision", "occurredAt", "retryCount", "retryLimit"];
	const optional = ["externalSystem", "failureCategory", "providerCode", "httpStatus", "summary"];
	if (required.some(function _Missing(key) { return !Object.hasOwn(candidate, key); }) || Object.keys(candidate).some(function _Unknown(key) { return !required.includes(key) && !optional.includes(key); })) return false;
	if (!_BoundedIdentifier(candidate["toolIdentifier"]) || !_BoundedIdentifier(candidate["toolRevision"]) || !_CanonicalInstant(candidate["occurredAt"])) return false;
	if (!Number.isSafeInteger(candidate["retryCount"]) || (candidate["retryCount"] as number) < 0 || candidate["retryLimit"] !== 3 || (candidate["retryCount"] as number) > 3) return false;
	if (candidate["httpStatus"] !== undefined && (!Number.isSafeInteger(candidate["httpStatus"]) || (candidate["httpStatus"] as number) < 100 || (candidate["httpStatus"] as number) > 599)) return false;
	return optional.filter(function _StringField(key) { return key !== "httpStatus"; }).every(function _BoundedOptional(key) { const field = candidate[key]; return field === undefined || _BoundedIdentifier(field); });
}

/** Whether a CUSTOM payload is a valid recovery envelope: exact key set, bounded ids, and a known provider outcome. */
export function _IsToolRecoveryRequired(value: unknown): value is AgUiToolRecoveryRequiredEnvelope
{
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const candidate = value as Record<string, unknown>;
	const keys = Object.keys(candidate);
	const required = ["eventType", "runId", "expectedAttempt", "toolCallId", "occurredAt", "recoveryCategory", "preparationRetryCount", "preparationRetryLimit"];
	if (required.some(function _Missing(key): boolean { return !Object.hasOwn(candidate, key); })) return false;
	if (keys.some(function _Unknown(key): boolean { return !required.includes(key) && key !== "providerOutcome"; })) return false;
	if (candidate["eventType"] !== "tool.recovery_required" || candidate["recoveryCategory"] !== "manual_action_required") return false;
	if (!_BoundedIdentifier(candidate["runId"]) || !_BoundedIdentifier(candidate["toolCallId"])) return false;
	if (!Number.isSafeInteger(candidate["expectedAttempt"]) || (candidate["expectedAttempt"] as number) < 1) return false;
	if (!Number.isSafeInteger(candidate["preparationRetryCount"]) || (candidate["preparationRetryCount"] as number) < 0 || (candidate["preparationRetryCount"] as number) > 3) return false;
	if (candidate["preparationRetryLimit"] !== 3 || !_CanonicalInstant(candidate["occurredAt"])) return false;
	return candidate["providerOutcome"] === undefined || (typeof candidate["providerOutcome"] === "string" && _TOOL_RECOVERY_PROVIDER_OUTCOMES.has(candidate["providerOutcome"]));
}
