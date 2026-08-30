import type { RuntimeWorkloadBinding } from "@opencrane/backend/agents/runtime/workloads/contract";

import { _ParseMcpRuntimeAssignment as _ParseAssignment, _ParseMcpRuntimeClaimId } from "./mcp-runtime-wire.validator";
import type { McpOciServerPromotionCommand, McpRuntimePodRegistrationCommand, McpRuntimeReleaseCommand } from "./mcp-runtime.types";

/** Parse the bounded administrator fields accepted by OCI server promotion. */
export function __ParseMcpOciServerPromotionCommand(value: unknown): McpOciServerPromotionCommand
{
	if (!_Exact(value, ["name", "description"]) || !_Text(value["name"], 120, false) || !_Text(value["description"], 1_000, true))
		throw new Error("MCP OCI server promotion has an invalid shape");
	return { name: value["name"].trim(), description: value["description"].trim() };
}

/**
 * Parses controller assignment evidence and binds its body claim ID to the route claim ID.
 *
 * The router calls this before the authoritative repository writes the binding. It rejects an
 * extra server-owned field and rejects a valid body sent through another claim URL, so callers get
 * either one fenced binding or an error to map to a bad request.
 *
 * Called by: mcp-runtime-controller.router.ts.
 * @param claimId - The controller-supplied claim coordinate from the request path.
 * @param value - The controller-supplied assignment body.
 * @returns The strict assignment binding whose claim ID matches the request path.
 * @throws Error When the path, body, unknown fields, or claim-ID correlation is invalid.
 */
export function __ParseMcpRuntimeAssignment(claimId: string, value: unknown): RuntimeWorkloadBinding
{
	// 1. Parse a strict body so the controller cannot inject a silo, image, class, or other server-owned field.
	const assignment = _ParseAssignment(value);

	// 2. Validate the path independently because it is supplied by the same untrusted controller request.
	const routeClaimId = _ParseMcpRuntimeClaimId(claimId);

	// 3. Bind both claim IDs so a valid controller body cannot be retargeted through another claim URL.
	if (assignment.claimId !== routeClaimId)
		throw new Error("MCP runtime assignment has an invalid shape");

	// 4. Keep the delivery, time, profile, and Job UID fence intact for the authoritative repository write.
	return assignment;
}

/** Parse one release fence without accepting a caller-selected silo, image, or profile. */
export function __ParseMcpRuntimeReleaseCommand(value: unknown): McpRuntimeReleaseCommand
{
	if (!_Exact(value, ["releaseClaimedAt", "releaseDeliveryCount", "workloadUid"]) || !_Instant(value["releaseClaimedAt"]) || !_PositiveInteger(value["releaseDeliveryCount"]) || !_Coordinate(value["workloadUid"], 256))
		throw new Error("MCP runtime release has an invalid shape");
	return value as unknown as McpRuntimeReleaseCommand;
}

/** Parse first-Pod evidence carried under the current release fence. */
export function __ParseMcpRuntimePodRegistrationCommand(value: unknown): McpRuntimePodRegistrationCommand
{
	if (!_Exact(value, ["releaseClaimedAt", "releaseDeliveryCount", "workloadUid", "podUid"]) || !_Instant(value["releaseClaimedAt"]) || !_PositiveInteger(value["releaseDeliveryCount"]) || !_Coordinate(value["workloadUid"], 256) || !_Coordinate(value["podUid"], 128))
		throw new Error("MCP runtime Pod registration has an invalid shape");
	return value as unknown as McpRuntimePodRegistrationCommand;
}

function _Exact(value: unknown, keys: readonly string[]): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(function _HasKey(key) { return Object.hasOwn(value, key); });
}

function _Text(value: unknown, maximum: number, allowEmpty: boolean): value is string
{
	return typeof value === "string" && value.trim().length <= maximum && (allowEmpty || value.trim().length > 0) && !/[\u0000-\u001f\u007f]/u.test(value);
}

function _Coordinate(value: unknown, maximum: number): value is string { return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(value); }
function _Instant(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value)); }
function _PositiveInteger(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) > 0; }
