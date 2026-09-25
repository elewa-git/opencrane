import { describe, expect, it } from "vitest";

import { ConversationEntryKinds, type ApprovalLogEntry } from "@opencrane/contracts";

import { _ApprovalInvalidationSequence } from "../conversation-workspace-selection.coordinator";

/** Build one participant-visible approval log without equating its approval id to an elicitation. */
function _Approval(position: string, approvalId: string): ApprovalLogEntry
{
	return { schemaVersion: 1, id: `entry-${position}`, conversationId: "conversation-1", position, author: { kind: "service", serviceId: "approval-authority", name: "Approval authority" }, provenance: "service-attested", visibility: { audience: "conversation" }, runId: "run-1", causationId: "cause-1", correlationId: "correlation-1", idempotencyKey: `entry-${position}`, occurredAt: "2026-09-10T08:00:00.000Z", attestation: null, kind: ConversationEntryKinds.Log, summary: "Approval requested", detailsRef: null, logKind: "approval", approvalId, action: "Create calendar event", phase: "requested" };
}

describe("conversation approval invalidation", function _ApprovalInvalidationSuite()
{
	it("uses the latest history position and never exposes the approval identifier as a request coordinate", function _LatestPosition()
	{
		expect(_ApprovalInvalidationSequence([_Approval("12", "not-an-elicitation"), _Approval("14", "also-not-an-elicitation")])).toBe("14");
	});

	it("returns no refresh coordinate before an approval log is visible", function _NoApproval()
	{
		expect(_ApprovalInvalidationSequence([])).toBeNull();
	});
});
