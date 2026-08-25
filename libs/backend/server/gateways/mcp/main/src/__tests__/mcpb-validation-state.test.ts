import { describe, expect, it } from "vitest";

import { McpbValidationActions, McpbValidationEvents, __McpbValidationTransition } from "../mcpb-validation/mcpb-validation-state";
import { McpbValidationStates } from "../mcpb-validation/mcpb-validation.types";

describe("MCP bundle validation state", function _McpbValidationStateSuite()
{
	it("runs verification only while the saved record is pending", function _RunsPendingVerification()
	{
		expect(__McpbValidationTransition(McpbValidationStates.Pending, McpbValidationEvents.Replay)).toBe(McpbValidationActions.Verify);
		expect(__McpbValidationTransition(McpbValidationStates.Pending, McpbValidationEvents.VerificationAccepted)).toBe(McpbValidationActions.StoreVerified);
		expect(__McpbValidationTransition(McpbValidationStates.Pending, McpbValidationEvents.VerificationRejected)).toBe(McpbValidationActions.StoreRejected);
	});

	it("returns stored final states and rejects a second decision", function _ReturnsStoredDecision()
	{
		expect(__McpbValidationTransition(McpbValidationStates.Verified, McpbValidationEvents.Replay)).toBe(McpbValidationActions.ReturnStored);
		expect(__McpbValidationTransition(McpbValidationStates.Rejected, McpbValidationEvents.Replay)).toBe(McpbValidationActions.ReturnStored);
		expect(__McpbValidationTransition(McpbValidationStates.Verified, McpbValidationEvents.VerificationRejected)).toBe(McpbValidationActions.Invalid);
		expect(__McpbValidationTransition(McpbValidationStates.Rejected, McpbValidationEvents.VerificationAccepted)).toBe(McpbValidationActions.Invalid);
	});
});
