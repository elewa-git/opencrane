import { DestroyRef, Injector } from "@angular/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationLifecycles, ConversationModes, GroupChildStates, type GroupChildView } from "@opencrane/models/conversations";

import { ConversationWorkspaceGatewayError, ConversationWorkspaceGatewayErrorKinds } from "../conversation-workspace-gateway.errors";
import { CONVERSATION_GROUP_CHILD_GATEWAY } from "../conversation-workspace.gateway";
import { ConversationGroupChildStore } from "../conversation-group-child.store";
import { ConversationGroupCommandStates } from "../conversation-group-child.types";
import type { ConversationDirectoryParticipant, ConversationWorkspaceDetail } from "../conversation-workspace.types";

/** Represents the currently authorized parent group. */
const _GROUP: ConversationWorkspaceDetail = { id: "group", mode: ConversationModes.Group, lifecycle: ConversationLifecycles.Open, agentServiceId: null, participantRefs: ["self", "member-b", "member-a"], archivedAt: null, readThroughPosition: "0", updatedAt: "2026-09-07T00:00:00.000Z", visibleFromPosition: "1", accessEndedPosition: null, parent: null };
/** Includes one directory member who does not belong to this parent group. */
const _PARTICIPANTS: readonly ConversationDirectoryParticipant[] = [{ participantRef: "self", isSelf: true, label: "You" }, { participantRef: "member-b", isSelf: false, label: "Amina" }, { participantRef: "member-a", isSelf: false, label: "Kamau" }, { participantRef: "outside", isSelf: false, label: "Njeri" }];
/** Represents the person's immutable group message. */
const _SOURCE = { entryId: "57de859d-1fb6-4782-aa0b-2b3d4dfd2292", position: "2", text: "Compare the proposals." };
/** Represents an admitted request whose creation is still owed. */
const _CHILD: GroupChildView = { conversationId: "child", parentConversationId: "group", parentMessageId: _SOURCE.entryId, parentMessagePosition: _SOURCE.position, state: GroupChildStates.Pending, agentName: "Research assistant" };

/** Creates the store with controllable promises and no live transport. */
function _Setup()
{
	const gateway = { listChildren: vi.fn().mockResolvedValue([]), createChild: vi.fn().mockResolvedValue(_CHILD), shareChild: vi.fn().mockResolvedValue(undefined) };
	const injector = Injector.create({ providers: [ConversationGroupChildStore, { provide: DestroyRef, useValue: { onDestroy: vi.fn() } }, { provide: CONVERSATION_GROUP_CHILD_GATEWAY, useValue: gateway }] });
	return { gateway, store: injector.get(ConversationGroupChildStore) };
}

/** Selects the child in the ordinary conversation workspace. */
function _ChildDetail(): ConversationWorkspaceDetail
{
	return { ..._GROUP, id: "child", mode: ConversationModes.AgentSession, agentServiceId: "company", parent: { requestId: _SOURCE.entryId, parentConversationId: "group", parentMessageId: _SOURCE.entryId, parentMessagePosition: "2" } };
}

afterEach(function _Timers() { vi.useRealTimers(); });

describe("group assistant commands", function _Describe()
{
	it("starts with requester-only sharing and ignores self or unlisted selections", async function _PrivateDefault()
	{
		vi.useFakeTimers();
		const { store, gateway } = _Setup();
		store.select(_GROUP, _PARTICIPANTS);
		store.ask(_SOURCE);
		store.chooseAssistant("company");
		store.toggleParticipant("self");
		store.toggleParticipant("outside");
		expect(store.requestParticipants().map(participant => participant.participantRef)).toEqual(["self", "member-b", "member-a"]);
		await store.create();
		expect(gateway.createChild.mock.calls[0]![1].participantRefs).toEqual([]);
		store.select(null, []);
	});

	it("preserves selected recipients on retry and changes the intent when the audience changes", async function _AudienceRetry()
	{
		vi.useFakeTimers();
		const { store, gateway } = _Setup();
		store.select(_GROUP, _PARTICIPANTS);
		store.ask(_SOURCE);
		store.chooseAssistant("company");
		store.toggleParticipant("member-b");
		store.toggleParticipant("member-a");
		gateway.createChild.mockRejectedValue(new Error("lost response"));
		await store.create();
		const first = gateway.createChild.mock.calls[0]![1];
		expect(first.participantRefs).toEqual(["member-a", "member-b"]);
		await store.create();
		expect(gateway.createChild.mock.calls[1]![1]).toEqual(first);
		expect(store.selectedParticipantRefs()).toEqual(["member-a", "member-b"]);
		store.toggleParticipant("member-b");
		await store.create();
		expect(gateway.createChild.mock.calls[2]![1].participantRefs).toEqual(["member-a"]);
		expect(gateway.createChild.mock.calls[2]![1].idempotencyKey).not.toBe(first.idempotencyKey);
		store.select(null, []);
	});

	it("locks recipients during submission and purges the draft when parent membership changes", async function _AudienceChange()
	{
		const { store, gateway } = _Setup();
		let finish!: (value: GroupChildView) => void;
		gateway.createChild.mockImplementation(function _Pending() { return new Promise(function _Wait(resolve) { finish = resolve; }); });
		store.select(_GROUP, _PARTICIPANTS);
		store.ask(_SOURCE);
		store.chooseAssistant("company");
		store.toggleParticipant("member-a");
		const pending = store.create();
		store.toggleParticipant("member-b");
		expect(store.selectedParticipantRefs()).toEqual(["member-a"]);
		const signal = gateway.createChild.mock.calls[0]![2];
		store.select({ ..._GROUP, participantRefs: ["self", "member-b"] }, _PARTICIPANTS);
		expect(signal.aborted).toBe(true);
		expect(store.selectedParticipantRefs()).toEqual([]);
		expect(store.requestSource()).toBeNull();
		finish(_CHILD);
		await pending;
		expect(store.children()).toEqual([]);
		store.select(null, []);
	});

	it("refreshes labels without changing a reviewed audience or its retry key", async function _Labels()
	{
		const { store, gateway } = _Setup();
		gateway.createChild.mockRejectedValue(new Error("lost response"));
		store.select(_GROUP, _PARTICIPANTS);
		store.ask(_SOURCE);
		store.chooseAssistant("company");
		store.toggleParticipant("member-a");
		await store.create();
		store.select(_GROUP, [..._PARTICIPANTS].reverse().map(participant => ({ ...participant, label: `${participant.label} updated` })));
		await store.create();
		expect(gateway.createChild.mock.calls[1]![1]).toEqual(gateway.createChild.mock.calls[0]![1]);
		expect(store.requestParticipants()[0]?.label).toBe("Kamau updated");
		store.select(null, []);
	});

	it("requires the requester in the named directory and clears selected people on access denial", async function _RequesterAndRevocation()
	{
		const { store, gateway } = _Setup();
		store.select(_GROUP, _PARTICIPANTS.filter(participant => !participant.isSelf));
		store.ask(_SOURCE);
		store.chooseAssistant("company");
		await store.create();
		expect(gateway.createChild).not.toHaveBeenCalled();
		store.select(_GROUP, _PARTICIPANTS);
		store.ask(_SOURCE);
		store.chooseAssistant("company");
		store.toggleParticipant("member-a");
		gateway.createChild.mockRejectedValue(new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.AccessChanged, "denied"));
		await store.create();
		expect(store.requestParticipants()).toEqual([]);
		expect(store.selectedParticipantRefs()).toEqual([]);
		expect(store.requestSource()).toBeNull();
	});

	it("retains an unchanged request UUID after a lost response and creates a new intent when its service changes", async function _Retry()
	{
		vi.useFakeTimers();
		const { store, gateway } = _Setup();
		store.select(_GROUP, _PARTICIPANTS);
		store.ask(_SOURCE);
		await store.create();
		expect(gateway.createChild).not.toHaveBeenCalled();
		store.chooseAssistant("company");
		gateway.createChild.mockRejectedValueOnce(new Error("private upstream details"));
		await store.create();
		const command = gateway.createChild.mock.calls[0]![1];
		expect(store.requestError()).not.toContain("private");
		await store.create();
		expect(gateway.createChild.mock.calls[1]![1]).toEqual(command);
		expect(store.children()).toEqual([_CHILD]);
		expect(store.childToOpen("child")).toBeNull();
		store.ask(_SOURCE);
		store.chooseAssistant("other-company");
		await store.create();
		expect(gateway.createChild.mock.calls[2]![1].idempotencyKey).not.toBe(command.idempotencyKey);
		store.select(null, []);
	});

	it("does not let an older list response erase a newly accepted child", async function _ListBeforeCreate()
	{
		vi.useFakeTimers();
		const { store, gateway } = _Setup();
		let finish!: (children: readonly GroupChildView[]) => void;
		gateway.listChildren.mockImplementationOnce(function _Pending() { return new Promise(function _Wait(resolve) { finish = resolve; }); });
		store.select(_GROUP, _PARTICIPANTS);
		store.ask(_SOURCE);
		store.chooseAssistant("company");
		await store.create();
		finish([]);
		await Promise.resolve();
		expect(store.children()).toEqual([_CHILD]);
		store.select(null, []);
	});

	it("does not restart denied child reads when the same workspace selection emits again", async function _DeniedRead()
	{
		const { store, gateway } = _Setup();
		gateway.listChildren.mockRejectedValueOnce(new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.AccessChanged, "denied"));
		store.select(_GROUP, _PARTICIPANTS);
		await Promise.resolve();
		store.select(_GROUP, _PARTICIPANTS);
		expect(gateway.listChildren).toHaveBeenCalledTimes(1);
		store.select(null, []);
		store.select(_GROUP, _PARTICIPANTS);
		await Promise.resolve();
		expect(gateway.listChildren).toHaveBeenCalledTimes(2);
	});

	it("locks request input and discards a late accepted child after selection changes", async function _FenceCreation()
	{
		const { store, gateway } = _Setup();
		let finish!: (value: GroupChildView) => void;
		gateway.createChild.mockImplementation(function _Pending() { return new Promise(function _Wait(resolve) { finish = resolve; }); });
		store.select(_GROUP, _PARTICIPANTS);
		store.ask(_SOURCE);
		store.chooseAssistant("company");
		const pending = store.create();
		store.chooseAssistant("other");
		store.dismissRequest();
		await store.create();
		expect(store.agentServiceId()).toBe("company");
		expect(store.requestSource()).not.toBeNull();
		expect(gateway.createChild).toHaveBeenCalledTimes(1);
		const signal = gateway.createChild.mock.calls[0]![2];
		store.select({ ..._GROUP, id: "other" }, _PARTICIPANTS);
		expect(signal.aborted).toBe(true);
		finish(_CHILD);
		await pending;
		expect(store.children()).toEqual([]);
		expect(store.requestSource()).toBeNull();
	});

	it("refreshes pending creation until Ready without an unbounded background loop", async function _Refresh()
	{
		vi.useFakeTimers();
		const { store, gateway } = _Setup();
		gateway.listChildren.mockResolvedValueOnce([_CHILD]).mockResolvedValueOnce([{ ..._CHILD, state: GroupChildStates.Ready }]);
		store.select(_GROUP, _PARTICIPANTS);
		await vi.advanceTimersByTimeAsync(5_000);
		expect(store.childToOpen("child")).toBe("child");
		await vi.advanceTimersByTimeAsync(60_000);
		expect(gateway.listChildren).toHaveBeenCalledTimes(2);
		store.select(null, []);
	});

	it("ends automatic pending refreshes after one minute", async function _RefreshBound()
	{
		vi.useFakeTimers();
		const { store, gateway } = _Setup();
		gateway.listChildren.mockResolvedValue([_CHILD]);
		store.select(_GROUP, _PARTICIPANTS);
		await vi.advanceTimersByTimeAsync(120_000);
		expect(gateway.listChildren).toHaveBeenCalledTimes(13);
		store.select(null, []);
	});

	it("keeps reviewed human text and its share key on retry, then changes the key after an edit", async function _ShareRetry()
	{
		const { store, gateway } = _Setup();
		store.select(_ChildDetail(), _PARTICIPANTS);
		store.reviewShare(_SOURCE);
		store.editShare("My reviewed conclusion.");
		gateway.shareChild.mockRejectedValueOnce(new Error("lost response")).mockRejectedValueOnce(new Error("lost again"));
		await store.share();
		const first = gateway.shareChild.mock.calls[0]![1];
		await store.share();
		expect(gateway.shareChild.mock.calls[1]![1]).toEqual(first);
		expect(store.shareText()).toBe("My reviewed conclusion.");
		store.editShare("My changed conclusion.");
		await store.share();
		expect(gateway.shareChild.mock.calls[2]![1]).toMatchObject({ text: "My changed conclusion.", sourceEntryId: _SOURCE.entryId, sourcePosition: "2" });
		expect(gateway.shareChild.mock.calls[2]![1].idempotencyKey).not.toBe(first.idempotencyKey);
		expect(store.shareState()).toBe(ConversationGroupCommandStates.Accepted);
		await store.share();
		expect(gateway.shareChild).toHaveBeenCalledTimes(3);
	});

	it("purges reviewed text on denied access and ignores a late share after leaving the child", async function _PurgeShare()
	{
		const { store, gateway } = _Setup();
		store.select(_ChildDetail(), _PARTICIPANTS);
		store.reviewShare(_SOURCE);
		gateway.shareChild.mockRejectedValueOnce(new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.AccessChanged, "private"));
		await store.share();
		expect(store.shareText()).toBe("");
		expect(store.shareSource()).toBeNull();
		store.select(null, []);
		store.select(_ChildDetail(), _PARTICIPANTS);
		store.reviewShare(_SOURCE);
		let finish!: () => void;
		gateway.shareChild.mockImplementationOnce(function _Pending() { return new Promise<void>(function _Wait(resolve) { finish = resolve; }); });
		const pending = store.share();
		store.select(null, []);
		finish();
		await pending;
		expect(store.shareState()).toBe(ConversationGroupCommandStates.Idle);
		expect(store.shareText()).toBe("");
	});
});
