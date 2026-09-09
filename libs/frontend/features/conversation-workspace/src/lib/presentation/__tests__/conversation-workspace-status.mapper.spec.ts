import { describe, expect, it } from "vitest";
import { ConversationComputerStates } from "@opencrane/contracts";
import { ConversationComposerStates } from "@opencrane/elements/conversation";
import { ConversationEventStreamStatuses, ConversationLifecycles } from "@opencrane/state/conversation/workspace";
import { _ComposerState, _ComputerStatus, _ConnectionStatus } from "../conversation-workspace-status.mapper";

describe("workspace status presentation", function _Status()
{
	it("allows message input only for a live open conversation", function _ComposerAdmission()
	{
		expect(_ComposerState(false, ConversationEventStreamStatuses.Live, ConversationLifecycles.Open)).toBe(ConversationComposerStates.Available);
		expect(_ComposerState(true, ConversationEventStreamStatuses.Live, ConversationLifecycles.Open)).toBe(ConversationComposerStates.Submitting);
		for (const status of [null, ConversationEventStreamStatuses.Connecting, ConversationEventStreamStatuses.Reconnecting, ConversationEventStreamStatuses.Failed])
			expect(_ComposerState(false, status, ConversationLifecycles.Open)).toBe(ConversationComposerStates.Disabled);
		expect(_ComposerState(false, ConversationEventStreamStatuses.Live, ConversationLifecycles.Closed)).toBe(ConversationComposerStates.Disabled);
	});
	it("offers recovery only for reconnecting or failed connections", function _ConnectionRecovery()
	{
		expect(_ConnectionStatus(ConversationEventStreamStatuses.Connecting, 0)?.reconnectAvailable).toBe(false);
		expect(_ConnectionStatus(ConversationEventStreamStatuses.Reconnecting, 3)?.status.label).toContain("3");
		expect(_ConnectionStatus(ConversationEventStreamStatuses.Failed, 3)?.reconnectAvailable).toBe(true);
		expect(_ConnectionStatus(ConversationEventStreamStatuses.Live, 0)).toBeNull();
		expect(_ConnectionStatus(null, 0)).toBeNull();
	});
	it("renders every logical computer state without exposing runtime coordinates", function _ComputerStates()
	{
		for (const state of Object.values(ConversationComputerStates))
			expect(_ComputerStatus(state)?.label).toMatch(/^Computer /);
		expect(_ComputerStatus(undefined)).toBeNull();
	});
});
