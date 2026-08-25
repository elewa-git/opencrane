import { z } from "zod";

import type { AgentControllerMcpbValidationAssignmentCommand, AgentControllerMcpbValidationAssignmentResult, AgentControllerMcpbValidationClaim } from "./agent-controller-mcpb-validation.types";
import { _AgentControllerBoundedIdentifierSchema, _AgentControllerMillisecondInstantSchema, _AgentControllerPositiveIntegerSchema, _ParseAgentControllerCommand, _ParseAgentControllerModel } from "./agent-controller-wire.validator";

/**
 * Keeps the MCP bundle controller's private messages in one shared contract.
 *
 * Claim and response parsers remove untrusted extra fields, while the assignment parser rejects
 * them before they reach the server authority.
 */

/** Validate a claimed inspection job and ensure its database lease timestamps are in the right order. */
const _McpbValidationClaimSchema: z.ZodType<AgentControllerMcpbValidationClaim> = z.object({
	workloadId: _AgentControllerBoundedIdentifierSchema,
	siloId: _AgentControllerBoundedIdentifierSchema,
	validationId: _AgentControllerBoundedIdentifierSchema,
	claimedAt: _AgentControllerMillisecondInstantSchema,
	deliveryCount: _AgentControllerPositiveIntegerSchema,
	expiresAt: _AgentControllerMillisecondInstantSchema,
}).strip().superRefine(function _ValidateChronology(claim, context)
{
	if (Date.parse(claim.claimedAt) >= Date.parse(claim.expiresAt))
		context.addIssue({ code: z.ZodIssueCode.custom, message: "must expire after it is claimed" });
});

/** Accept only the Job evidence that the database needs to bind an assignment to its claim. */
const _McpbValidationAssignmentCommandSchema: z.ZodType<AgentControllerMcpbValidationAssignmentCommand> = z.object({
	claimedAt: _AgentControllerMillisecondInstantSchema,
	deliveryCount: _AgentControllerPositiveIntegerSchema,
	workloadUid: _AgentControllerBoundedIdentifierSchema,
}).strict();

/** Validate a successful assignment response before binding it to the controller's command. */
const _McpbValidationAssignmentResultSchema: z.ZodType<AgentControllerMcpbValidationAssignmentResult> = z.object({
	outcome: z.enum(["assigned", "idempotent"]),
	workloadId: _AgentControllerBoundedIdentifierSchema,
	workloadUid: _AgentControllerBoundedIdentifierSchema,
}).strip();

/**
 * Parses one inspection claim returned by the internal server.
 * @param value - Untrusted response body returned to the controller.
 * @returns The validated claim and its database lease fence.
 * @throws Error when the response is not a valid claim or its lease timestamps are invalid.
 */
export function ___ParseAgentControllerMcpbValidationClaim(value: unknown): AgentControllerMcpbValidationClaim
{
	return _ParseAgentControllerModel(_McpbValidationClaimSchema, value, "MCP bundle validation claim");
}

/**
 * Parses the controller's Job-assignment command at the server route boundary.
 *
 * The route treats `null` as a 400 response, so extra or malformed fields never reach the database authority.
 * Called by: `__CreateMcpbValidationControllerRouter`.
 * @param value - Untrusted request body sent by the controller.
 * @returns The accepted command, or `null` when the route must reject it.
 */
export function ___ParseAgentControllerMcpbValidationAssignmentCommand(value: unknown): AgentControllerMcpbValidationAssignmentCommand | null
{
	return _ParseAgentControllerCommand(_McpbValidationAssignmentCommandSchema, value);
}

/**
 * Parses an assignment response and binds it to the Job assignment the controller submitted.
 *
 * A mismatched workload or Job UID means the response cannot confirm this controller's lease, so the
 * parser throws instead of returning an assignment that belongs to another request.
 * @param value - Untrusted response body returned by the internal server.
 * @param workloadId - Workload ID from the controller's request path.
 * @param command - Claim fence and Job UID submitted by the controller.
 * @returns The matching saved or replayed assignment result.
 * @throws Error when the response is malformed or does not match the submitted assignment.
 */
export function ___ParseAgentControllerMcpbValidationAssignmentResult(value: unknown, workloadId: string, command: AgentControllerMcpbValidationAssignmentCommand): AgentControllerMcpbValidationAssignmentResult
{
	const result = _ParseAgentControllerModel(_McpbValidationAssignmentResultSchema, value, "MCP bundle validation assignment result");
	if (result.workloadId !== workloadId || result.workloadUid !== command.workloadUid)
		throw new Error("OpenCrane returned a mismatched MCP bundle validation assignment result");
	return result;
}
