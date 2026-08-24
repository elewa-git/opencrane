import { z } from "zod";

import type { AgentControllerMcpbValidationAssignmentCommand, AgentControllerMcpbValidationAssignmentResult, AgentControllerMcpbValidationClaim } from "./agent-controller-mcpb-validation.types";
import { _AgentControllerBoundedIdentifierSchema, _AgentControllerMillisecondInstantSchema, _AgentControllerPositiveIntegerSchema, _ParseAgentControllerCommand, _ParseAgentControllerModel } from "./agent-controller-wire.validator";

/** Keep MCP bundle controller messages in one place so the server and controller validate the same fields. */

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

/** Parse one MCP bundle inspection claim from the internal server response. */
export function ___ParseAgentControllerMcpbValidationClaim(value: unknown): AgentControllerMcpbValidationClaim
{
	return _ParseAgentControllerModel(_McpbValidationClaimSchema, value, "MCP bundle validation claim");
}

/** Parse an exact Job-assignment command, or return null for an HTTP rejection. */
export function ___ParseAgentControllerMcpbValidationAssignmentCommand(value: unknown): AgentControllerMcpbValidationAssignmentCommand | null
{
	return _ParseAgentControllerCommand(_McpbValidationAssignmentCommandSchema, value);
}

/** Parse an assignment response and reject it unless it confirms the same Job the controller submitted. */
export function ___ParseAgentControllerMcpbValidationAssignmentResult(value: unknown, workloadId: string, command: AgentControllerMcpbValidationAssignmentCommand): AgentControllerMcpbValidationAssignmentResult
{
	const result = _ParseAgentControllerModel(_McpbValidationAssignmentResultSchema, value, "MCP bundle validation assignment result");
	if (result.workloadId !== workloadId || result.workloadUid !== command.workloadUid)
		throw new Error("OpenCrane returned a mismatched MCP bundle validation assignment result");
	return result;
}
