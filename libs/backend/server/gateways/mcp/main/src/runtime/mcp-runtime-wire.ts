import type { RuntimeWorkloadBinding } from "@opencrane/backend/agents/runtime/workloads/contract";

import type { McpOciServerPromotionCommand, McpRuntimeCleanupCommand, McpRuntimePodRegistrationCommand, McpRuntimeReleaseCommand } from "./mcp-runtime.types";

/** Parse the bounded administrator fields accepted by OCI server promotion. */
export function __ParseMcpOciServerPromotionCommand(value: unknown): McpOciServerPromotionCommand
{
	if (!_Exact(value, ["name", "description"]) || !_Text(value["name"], 120, false) || !_Text(value["description"], 1_000, true))
		throw new Error("MCP OCI server promotion has an invalid shape");
	return { name: value["name"].trim(), description: value["description"].trim() };
}

/** Parse one controller assignment and require the path and body claim IDs to agree. */
export function __ParseMcpRuntimeAssignment(claimId: string, value: unknown): RuntimeWorkloadBinding
{
	const keys = ["claimId", "claimedAt", "deliveryCount", "profileName", "workloadUid"];
	if (!_Coordinate(claimId, 256) || !_Exact(value, keys) || value["claimId"] !== claimId || !_Instant(value["claimedAt"]) || !_PositiveInteger(value["deliveryCount"]) || !_Coordinate(value["profileName"], 128) || !_Coordinate(value["workloadUid"], 256))
		throw new Error("MCP runtime assignment has an invalid shape");
	return value as unknown as RuntimeWorkloadBinding;
}

/** Parse one release fence without accepting a caller-selected silo, image, or profile. */
export function __ParseMcpRuntimeReleaseCommand(value: unknown): McpRuntimeReleaseCommand
{
	if (!_Exact(value, ["releaseClaimedAt", "releaseDeliveryCount", "workloadUid"]) || !_Instant(value["releaseClaimedAt"]) || !_PositiveInteger(value["releaseDeliveryCount"]) || !_Coordinate(value["workloadUid"], 256))
		throw new Error("MCP runtime release has an invalid shape");
	return value as unknown as McpRuntimeReleaseCommand;
}

/** Parse one cleanup fence without accepting a caller-selected silo, image, or profile. */
export function __ParseMcpRuntimeCleanupCommand(value: unknown): McpRuntimeCleanupCommand
{
	if (!_Exact(value, ["cleanupClaimedAt", "cleanupDeliveryCount", "workloadUid"]) || !_Instant(value["cleanupClaimedAt"]) || !_PositiveInteger(value["cleanupDeliveryCount"]) || !_Coordinate(value["workloadUid"], 256))
		throw new Error("MCP runtime cleanup has an invalid shape");
	return value as unknown as McpRuntimeCleanupCommand;
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
