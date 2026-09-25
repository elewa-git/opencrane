// @vitest-environment jsdom

import { ElementRef, Injector, runInInjectionContext, type InputSignal, ɵInputSignalNode as InputSignalNode, ɵSIGNAL as SIGNAL } from "@angular/core";
import { describe, expect, it, vi } from "vitest";

import { CONVERSATION_ELICITATION_VERSION, ElicitationBodyKinds, ElicitationConnectionOwnerKinds, ElicitationPurposes, ElicitationRequestStates, McpCredentialRequirement, type ConversationElicitation } from "@opencrane/state/conversation/elicitation";

import { ConversationElicitationCardComponent } from "../conversation-elicitation-card.component";

/** Supply an admissible tool approval without requiring a live server or browser session. */
const _REQUEST: ConversationElicitation = { version: CONVERSATION_ELICITATION_VERSION, requestId: "request-1", conversationId: "conversation-1", runId: "run-1", attempt: 1, assignedParticipantId: "human-requester", purpose: ElicitationPurposes.ToolApproval, state: ElicitationRequestStates.Requested, body: { kind: ElicitationBodyKinds.Approval, prompt: "Proceed?", action: "Create event", target: "Calendar", dataUse: "Meeting details", proposedArguments: { title: "Planning" }, consequence: "An event is created.", executionConnection: { ownerKind: ElicitationConnectionOwnerKinds.CompanyAssistant, ownerLabel: "Finance assistant", credentialRequirement: McpCredentialRequirement.PrincipalCredential } }, requiresStepUp: false, requestedAt: "2026-09-22T08:00:00.000Z", expiresAt: "2026-09-22T09:00:00.000Z" };

/** Set controlled signal inputs directly for command-admission tests without compiling templates. */
function _setInput<TValue>(target: InputSignal<TValue>, value: TValue): void
{
	const node = target[SIGNAL] as InputSignalNode<TValue, TValue>;
	node.applyValueToInputSignal(node, value);
}

/** Construct the card with its normal injection context and a local host for focus recovery. */
function _card(request: ConversationElicitation = _REQUEST): ConversationElicitationCardComponent
{
	const injector = Injector.create({ providers: [{ provide: ElementRef, useValue: new ElementRef(document.createElement("div")) }] });
	const component = runInInjectionContext(injector, function _construct() { return new ConversationElicitationCardComponent(); });
	_setInput(component.elicitation, request);
	return component;
}

describe("elicitation card command admission", function _commandSuite()
{
	it("keeps selection and explicit confirmation separate", function _separateConfirmation()
	{
		const component = _card();
		const selected = vi.fn();
		const submitted = vi.fn();
		component.draftSelected.subscribe(selected);
		component.submitRequested.subscribe(submitted);
		component["selectApproval"](true);
		expect(selected).toHaveBeenCalledWith({ kind: ElicitationBodyKinds.Approval, approved: true });
		expect(submitted).not.toHaveBeenCalled();
		component["submit"]();
		expect(submitted).not.toHaveBeenCalled();
		_setInput(component.draft, { kind: ElicitationBodyKinds.Approval, approved: true });
		component["submit"]();
		expect(submitted).toHaveBeenCalledOnce();
	});

	it.each([undefined, { ownerKind: ElicitationConnectionOwnerKinds.Personal, ownerLabel: "", credentialRequirement: McpCredentialRequirement.PrincipalCredential }])("refuses affirmative commands with incomplete connection details: %j", function _incompleteDisclosure(executionConnection)
	{
		const component = _card({ ..._REQUEST, body: { ..._REQUEST.body, executionConnection } });
		const selected = vi.fn();
		const submitted = vi.fn();
		component.draftSelected.subscribe(selected);
		component.submitRequested.subscribe(submitted);
		_setInput(component.draft, { kind: ElicitationBodyKinds.Approval, approved: true });
		component["selectApproval"](true);
		component["submit"]();
		expect(selected).not.toHaveBeenCalled();
		expect(submitted).not.toHaveBeenCalled();
		component["selectApproval"](false);
		expect(selected).toHaveBeenCalledWith({ kind: ElicitationBodyKinds.Approval, approved: false });
		_setInput(component.draft, { kind: ElicitationBodyKinds.Approval, approved: false });
		component["submit"]();
		expect(submitted).toHaveBeenCalledOnce();
	});

	it("does not emit a decision or confirmation during sign-in recovery", function _stepUp()
	{
		const component = _card();
		const selected = vi.fn();
		const submitted = vi.fn();
		component.draftSelected.subscribe(selected);
		component.submitRequested.subscribe(submitted);
		_setInput(component.draft, { kind: ElicitationBodyKinds.Approval, approved: true });
		_setInput(component.stepUpPath, "/api/v1/auth/reauthenticate");
		component["selectApproval"](true);
		component["selectApproval"](false);
		component["submit"]();
		expect(selected).not.toHaveBeenCalled();
		expect(submitted).not.toHaveBeenCalled();
	});

	it.each(["busy", "disabled"] as const)("does not emit decisions while %s", function _disabledCommands(inputName)
	{
		const component = _card();
		const selected = vi.fn();
		const submitted = vi.fn();
		component.draftSelected.subscribe(selected);
		component.submitRequested.subscribe(submitted);
		_setInput(component.draft, { kind: ElicitationBodyKinds.Approval, approved: true });
		_setInput(component[inputName], true);
		component["selectApproval"](true);
		component["selectApproval"](false);
		component["submit"]();
		expect(selected).not.toHaveBeenCalled();
		expect(submitted).not.toHaveBeenCalled();
	});
});
