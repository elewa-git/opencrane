import { describe, expect, it } from "vitest";

import { CONVERSATION_ELICITATION_VERSION, ElicitationApprovalScopes, ElicitationBodyKinds, ElicitationConnectionOwnerKinds, ElicitationPurposes, ElicitationRequestStates, McpCredentialRequirement, type ConversationElicitation } from "@opencrane/state/conversation/elicitation";

import { _CanSubmitElicitation } from "../conversation-elicitation-card.component";

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

	it("allows denial but refuses approval when complete proposal arguments are hidden", function _HiddenArgumentsFence()
	{
		const request = _Request({ kind: ElicitationBodyKinds.Approval, prompt: "Proceed?", action: "Create event", target: "Calendar", dataUse: "Meeting details", proposedArguments: null, consequence: "The event may be visible to invitees." });
		expect(_CanSubmitElicitation(request, { kind: ElicitationBodyKinds.Approval, approved: true }, false)).toBe(false);
		expect(_CanSubmitElicitation(request, { kind: ElicitationBodyKinds.Approval, approved: false }, false)).toBe(true);
		const omittedToolProposal = { ...request, purpose: ElicitationPurposes.ToolApproval, body: { ...request.body, proposedArguments: undefined } };
		expect(_CanSubmitElicitation(omittedToolProposal, { kind: ElicitationBodyKinds.Approval, approved: true }, false)).toBe(false);
		expect(_CanSubmitElicitation(omittedToolProposal, { kind: ElicitationBodyKinds.Approval, approved: false }, false)).toBe(true);
	});

	it("refuses incomplete tool connection disclosure even when parsing was bypassed", function _MissingDisclosureFence()
	{
		const request = { ..._Request({ kind: ElicitationBodyKinds.Approval, prompt: "Proceed?", action: "Create event", target: "Calendar", dataUse: "Meeting details", proposedArguments: { title: "Planning" }, consequence: "An event is created." }), purpose: ElicitationPurposes.ToolApproval };
		expect(_CanSubmitElicitation(request, { kind: ElicitationBodyKinds.Approval, approved: true }, false)).toBe(false);
		expect(_CanSubmitElicitation(request, { kind: ElicitationBodyKinds.Approval, approved: false }, false)).toBe(true);
		const complete = { ...request, body: { ...request.body, offeredScopes: [ElicitationApprovalScopes.Once], executionConnection: { ownerKind: ElicitationConnectionOwnerKinds.CompanyAssistant, ownerLabel: "Finance assistant", credentialRequirement: McpCredentialRequirement.PrincipalCredential } } };
		expect(_CanSubmitElicitation(complete, { kind: ElicitationBodyKinds.Approval, approved: true }, false)).toBe(true);
	});

	it("admits Always only while the current server offer keeps its complete explanation", function _StandingOfferFence()
	{
		const request = { ..._Request({ kind: ElicitationBodyKinds.Approval, prompt: "Proceed?", action: "Create event", target: "Calendar", dataUse: "Meeting details", proposedArguments: { title: "Planning" }, consequence: "An event is created.", offeredScopes: [ElicitationApprovalScopes.Once, ElicitationApprovalScopes.Always], standingScope: { explanation: "Future actions must match the exact reviewed binding and can be revoked." }, executionConnection: { ownerKind: ElicitationConnectionOwnerKinds.CompanyAssistant, ownerLabel: "Finance assistant", credentialRequirement: McpCredentialRequirement.PrincipalCredential } }), purpose: ElicitationPurposes.ToolApproval };
		expect(_CanSubmitElicitation(request, { kind: ElicitationBodyKinds.Approval, approved: true, scope: ElicitationApprovalScopes.Always }, false)).toBe(true);
		expect(_CanSubmitElicitation({ ...request, body: { ...request.body, standingScope: undefined } }, { kind: ElicitationBodyKinds.Approval, approved: true, scope: ElicitationApprovalScopes.Always }, false)).toBe(false);
		expect(_CanSubmitElicitation({ ...request, body: { ...request.body, offeredScopes: [ElicitationApprovalScopes.Once] } }, { kind: ElicitationBodyKinds.Approval, approved: true, scope: ElicitationApprovalScopes.Always }, false)).toBe(false);
	});
});
