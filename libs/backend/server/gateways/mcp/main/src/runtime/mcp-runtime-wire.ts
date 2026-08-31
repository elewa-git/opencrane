import type { RuntimeWorkloadBinding } from "@opencrane/backend/agents/runtime/workloads/contract";

import { _ParseMcpOciServerPromotionCommand as _ParsePromotion, _ParseMcpRuntimeAssignment as _ParseAssignment, _ParseMcpRuntimeClaimId, _ParseMcpRuntimeCleanupCommand as _ParseCleanup, _ParseMcpRuntimePodRegistrationCommand as _ParsePodRegistration, _ParseMcpRuntimeReleaseCommand as _ParseRelease } from "./mcp-runtime-wire.validator";
import type { McpOciServerPromotionCommand, McpRuntimeCleanupCommand, McpRuntimePodRegistrationCommand, McpRuntimeReleaseCommand } from "./mcp-runtime.types";

/** Parse the bounded administrator fields accepted by OCI server promotion. */
export function __ParseMcpOciServerPromotionCommand(value: unknown): McpOciServerPromotionCommand
{
	return _ParsePromotion(value);
}

/**
 * Parses controller assignment evidence and binds its body claim ID to the route claim ID.
 *
 * The strict body excludes controller-selected silo, image, and workload-class fields. Correlation
 * then prevents a valid body from being replayed through another claim URL.
 *
 * Called by: mcp-runtime-controller.router.ts.
 * @param claimId - Controller-supplied claim coordinate from the request path.
 * @param value - Controller-supplied assignment evidence.
 * @returns The checked assignment whose body and route claim IDs match.
 * @throws Error When the route, body, unknown fields, or correlation is invalid.
 */
export function __ParseMcpRuntimeAssignment(claimId: string, value: unknown): RuntimeWorkloadBinding
{
	// 1. Reject unknown fields before the controller evidence crosses into persistence.
	const assignment = _ParseAssignment(value);

	// 2. Validate the path independently because it comes from the same untrusted request.
	const routeClaimId = _ParseMcpRuntimeClaimId(claimId);

	// 3. Bind both coordinates so the evidence cannot be retargeted to another claim.
	if (assignment.claimId !== routeClaimId)
		throw new Error("MCP runtime assignment has an invalid shape");
	return assignment;
}

/** Parse one release fence without accepting a caller-selected silo, image, or profile. */
export function __ParseMcpRuntimeReleaseCommand(value: unknown): McpRuntimeReleaseCommand
{
	return _ParseRelease(value);
}

/** Parse one cleanup fence without accepting a caller-selected silo, image, or profile. */
export function __ParseMcpRuntimeCleanupCommand(value: unknown): McpRuntimeCleanupCommand
{
	return _ParseCleanup(value);
}

/** Parse first-Pod evidence carried under the current release fence. */
export function __ParseMcpRuntimePodRegistrationCommand(value: unknown): McpRuntimePodRegistrationCommand
{
	return _ParsePodRegistration(value);
}
