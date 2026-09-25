import { DestroyRef, Injector, runInInjectionContext, type InputSignal, ɵInputSignalNode as InputSignalNode, ɵSIGNAL as SIGNAL } from "@angular/core";
import { describe, expect, it, vi } from "vitest";

import type { ConversationDirectoryParticipant } from "@opencrane/state/conversation/workspace";

import { ConversationParticipantPickerComponent } from "../conversation-participant-picker.component";

/** Supplies real signal inputs without pretending that source-mode JIT discovers them. */
function _setInput<TValue>(target: InputSignal<TValue>, value: TValue): void
{
	const node = target[SIGNAL] as InputSignalNode<TValue, TValue>;
	node.applyValueToInputSignal(node, value);
}

/** Creates the presentation contract without a network gateway or conversation store. */
function _setup()
{
	const injector = Injector.create({ providers: [{ provide: DestroyRef, useValue: { onDestroy: vi.fn() } }] });
	const component = runInInjectionContext(injector, function _create() { return new ConversationParticipantPickerComponent(); });
	const participants: readonly ConversationDirectoryParticipant[] = [{ participantRef: "self", isSelf: true, label: "You" }, { participantRef: "peer", isSelf: false, label: "Mary Wanjiku" }];
	_setInput(component.participants, participants);
	const toggled = vi.fn();
	component.participantToggled.subscribe(toggled);
	return { component, toggled };
}

describe("ConversationParticipantPickerComponent", function _suite()
{
	it("emits a known peer reference without mutating controlled selection", function _peerIntent()
	{
		const { component, toggled } = _setup();
		component.toggleParticipant("peer");
		expect(toggled).toHaveBeenCalledExactlyOnceWith("peer");
		expect(component.selectedParticipantRefs()).toEqual([]);
	});

	it("does not allow the fixed requester to be toggled", function _requester()
	{
		const { component, toggled } = _setup();
		component.toggleParticipant("self");
		expect(toggled).not.toHaveBeenCalled();
	});

	it("does not emit references absent from the displayed choices", function _unknownReference()
	{
		const { component, toggled } = _setup();
		component.toggleParticipant("another-group");
		expect(toggled).not.toHaveBeenCalled();
	});

	it("guards pending interaction independently of the disabled checkbox", function _pending()
	{
		const { component, toggled } = _setup();
		_setInput(component.disabled, true);
		component.toggleParticipant("peer");
		expect(toggled).not.toHaveBeenCalled();
	});
});
