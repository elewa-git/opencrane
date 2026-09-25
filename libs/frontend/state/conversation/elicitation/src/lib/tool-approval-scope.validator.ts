import { ToolApprovalScopeStates, type ListMyToolApprovalScopesResponse, type RevokeMyToolApprovalScopeResponse, type ToolApprovalScopeSummary } from "@opencrane/contracts";

/** Parse one generated list response without accepting unsafe or duplicate rows. */
export function _ParseToolApprovalScopeList(value: unknown): ListMyToolApprovalScopesResponse
{
	if (!_Record(value) || !Array.isArray(value["scopes"]) || value["scopes"].length > 100)
		throw new TypeError("standing approval list is invalid");
	const scopes = value["scopes"].map(_ParseToolApprovalScope);
	if (new Set(scopes.map(scope => scope.id)).size !== scopes.length)
		throw new TypeError("standing approval list contains duplicate scopes");
	const nextCursor = value["nextCursor"];
	if (nextCursor !== undefined && !_BoundedString(nextCursor, 2_000))
		throw new TypeError("standing approval continuation is invalid");
	return nextCursor === undefined ? { scopes } : { scopes, nextCursor };
}

/** Parse the authoritative response to one revocation command. */
export function _ParseToolApprovalScopeRevocation(value: unknown): RevokeMyToolApprovalScopeResponse
{
	if (!_Record(value) || typeof value["idempotent"] !== "boolean")
		throw new TypeError("standing approval revocation is invalid");
	const scope = _ParseToolApprovalScope(value["scope"]);
	if (scope.state !== ToolApprovalScopeStates.Revoked || scope.revokedAt === undefined)
		throw new TypeError("standing approval revocation did not return revoked state");
	return { scope, idempotent: value["idempotent"] };
}

/** Parse one safe owner summary and reject lifecycle/time contradictions. */
function _ParseToolApprovalScope(value: unknown): ToolApprovalScopeSummary
{
	if (!_Record(value) || !_BoundedString(value["id"], 256) || !Object.values(ToolApprovalScopeStates).includes(value["state"] as ToolApprovalScopeStates) || !_BoundedString(value["action"], 1_000) || !_BoundedString(value["target"], 1_000) || !_BoundedString(value["connectionOwnerLabel"], 1_000) || !_Instant(value["createdAt"]))
		throw new TypeError("standing approval summary is invalid");
	if (value["externalSystem"] !== undefined && !_BoundedString(value["externalSystem"], 500))
		throw new TypeError("standing approval external system is invalid");
	if (value["assistantLabel"] !== undefined && !_BoundedString(value["assistantLabel"], 1_000))
		throw new TypeError("standing approval assistant is invalid");
	if (value["revokedAt"] !== undefined && !_Instant(value["revokedAt"]))
		throw new TypeError("standing approval revocation time is invalid");
	if ((value["state"] === ToolApprovalScopeStates.Revoked) !== (value["revokedAt"] !== undefined))
		throw new TypeError("standing approval lifecycle is inconsistent");
	return {
		id: value["id"],
		state: value["state"] as ToolApprovalScopeStates,
		action: value["action"],
		target: value["target"],
		...(value["externalSystem"] === undefined ? {} : { externalSystem: value["externalSystem"] }),
		...(value["assistantLabel"] === undefined ? {} : { assistantLabel: value["assistantLabel"] }),
		connectionOwnerLabel: value["connectionOwnerLabel"],
		createdAt: value["createdAt"],
		...(value["revokedAt"] === undefined ? {} : { revokedAt: value["revokedAt"] }),
	};
}

/** Check for a non-array object. */
function _Record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
/** Check one trimmed browser-safe string bound. */
function _BoundedString(value: unknown, maximum: number): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= maximum; }
/** Check one ISO-compatible timestamp. */
function _Instant(value: unknown): value is string { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }
