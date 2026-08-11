import { describe, expect, it } from "vitest";

import { CONVERSATION_ELICITATION_VERSION, ElicitationBodyKinds, ElicitationPurposes, ElicitationRequestStates, type ConversationElicitation } from "@opencrane/contracts";

import { _CanSubmitElicitation } from "../conversation-elicitation-card.component.js";

/** Build one requested interaction with the supplied body. */
function _Request(body: ConversationElicitation["body"]): ConversationElicitation
{
	return { version: CONVERSATION_ELICITATION_VERSION, requestId: "request-1", conversationId: "conversation-1", runId: "run-1", attempt: 1, assignedParticipantId: "user-1", purpose: ElicitationPurposes.RuntimeInput, state: ElicitationRequestStates.Requested, body, requiresStepUp: false, requestedAt: "2026-08-11T08:00:00.000Z", expiresAt: "2026-08-11T09:00:00.000Z" };
}

describe("conversation elicitation submit boundary", function _SubmitBoundarySuite()
{
	it("requires a separate valid draft for every supported body kind", function _BodyKinds()
	{
		expect(_CanSubmitElicitation(_Request({ kind: ElicitationBodyKinds.Approval, prompt: "Proceed?", action: "Publish", target: "Report", dataUse: "Report content", consequence: "The report is shared." }), { kind: ElicitationBodyKinds.Approval, approved: false }, false)).toBe(true);
		expect(_CanSubmitElicitation(_Request({ kind: ElicitationBodyKinds.SingleChoice, prompt: "Choose", choices: [{ value: "a", label: "A" }] }), { kind: ElicitationBodyKinds.SingleChoice, selection: "a" }, false)).toBe(true);
		expect(_CanSubmitElicitation(_Request({ kind: ElicitationBodyKinds.MultipleChoice, prompt: "Choose two", choices: [{ value: "a", label: "A" }, { value: "b", label: "B" }], minimumSelections: 2, maximumSelections: 2 }), { kind: ElicitationBodyKinds.MultipleChoice, selections: ["a"] }, false)).toBe(false);
		expect(_CanSubmitElicitation(_Request({ kind: ElicitationBodyKinds.FreeText, prompt: "Explain", maximumLength: 20, allowEmpty: false }), { kind: ElicitationBodyKinds.FreeText, text: "" }, false)).toBe(false);
	});

	it("blocks submission while busy or after the server resolves the request", function _LifecycleFence()
	{
		const request = _Request({ kind: ElicitationBodyKinds.FreeText, prompt: "Explain", maximumLength: 20, allowEmpty: false });
		const draft = { kind: ElicitationBodyKinds.FreeText, text: "Done" } as const;
		expect(_CanSubmitElicitation(request, draft, true)).toBe(false);
		expect(_CanSubmitElicitation({ ...request, state: ElicitationRequestStates.Answered }, draft, false)).toBe(false);
	});
});
