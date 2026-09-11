import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationHistoryAuthority, ConversationHistoryModes, ConversationHistoryReader } from "@opencrane/backend/server/conversations/history";
import { ConversationModelToolModes } from "@opencrane/contracts";

import { CurrentConversationToolResultNotificationEvidenceReader } from "../../tools/results/current-conversation-tool-result-notification-evidence";
import { ConversationToolResultNotificationOutcomes } from "../tool-result-notifications/conversation-tool-result-notification.types";
import { KurrentConversationToolResultNotificationPublisher } from "../tool-result-notifications/kurrent-conversation-tool-result-notification";
import { _ToolContinuationHarness } from "./conversation-tool-continuation.fixture";

afterEach(function _Restore() { vi.restoreAllMocks(); });

/** Use the real turn, encrypted custody, current lease reader and history publisher together. */
async function _ResultJourney()
{
	const f = await _ToolContinuationHarness();
	const historyAuthority = new ConversationHistoryAuthority(f.history);
	const genesis = historyAuthority.genesisAppend({ schemaVersion: 1, siloId: "silo-1", conversationId: "conversation-1", mode: ConversationHistoryModes.AgentSession, agentServiceId: "service-1", createdByPrincipalId: "owner-1", createdAt: new Date().toISOString() }, "71c1f1dc-0010-4f13-9c2f-d3841ffd6651");
	f.history.streams.get(f.stream)![0] = { ...f.history.streams.get(f.stream)![0], ...genesis.events[0], metadata: Object.fromEntries(Object.entries(genesis.events[0].metadata).map(([key, value]) => [key, String(value)])) };
	function _Publisher()
	{
		const evidence = new CurrentConversationToolResultNotificationEvidenceReader(f.store, f.candidates, f.results);
		return new KurrentConversationToolResultNotificationPublisher(evidence, new ConversationHistoryAuthority(f.history), new ConversationHistoryReader(f.history), f.history);
	}
	f.notifications.publishTerminal.mockImplementation(function _Publish(command) { return _Publisher().publishTerminal(command); });
	return { ...f, publisher: _Publisher };
}

describe("terminal tool history before the final model call", function _Suite()
{
	it.each(["notification", "answer"])("recovers a lost %s response with one tool execution and the original allowance", async function _LostReply(boundary)
	{
		const f = await _ResultJourney();
		let lost = false;
		f.history.afterAppend = async function _LoseReply(append)
		{
			const isNotification = append.streamName.startsWith("conversation-tool-result-notification-");
			const entry = append.events[0].data["entry"];
			const isAnswer = append.streamName === f.stream && typeof entry === "object" && entry !== null && "kind" in entry && entry.kind === "message";
			if (!lost && (boundary === "notification" ? isNotification : isAnswer))
			{
				lost = true;
				throw new Error("committed response lost");
			}
		};
		const firstPass = await f.authority.advance(f.step);
		expect(firstPass.outcome).toBe(boundary === "notification" ? "retry" : "model_pending");
		const paused = (await f.store.load(f.step))!;
		if (boundary === "notification")
		{
			expect(paused.continuationReservation).toBeNull();
			expect(f.model.request).toHaveBeenCalledOnce();
			expect(f.toolFlags.consumed).toBe(false);
		}
		expect(await f.restart().advance(f.step)).toEqual({ outcome: "completed" });
		expect(await f.restart().advance(f.step)).toEqual({ outcome: "completed" });
		const completed = (await f.store.load(f.step))!;
		expect(completed.modelReservation).toEqual(paused.modelReservation);
		expect(completed.outputReceipt?.expectedRevision).toBe("2");
		const entries = f.history.streams.get(f.stream)!;
		expect(entries).toHaveLength(4);
		expect(entries[2].data["entry"]).toMatchObject({ position: "2", kind: "log", logKind: "tool_call", toolName: "lookup_record", phase: "completed", visibility: { audience: "conversation" }, detailsRef: null, resultArtifactRevisionId: null });
		expect(entries[3].data).toEqual(completed.outputReceipt!.event.data);
		const reader = new ConversationHistoryReader(f.history);
		const replay = await reader.read({ siloId: "silo-1", conversationId: "conversation-1", fromRevision: 2n, maxCount: 2, maximumBytes: 65_536 });
		expect(replay.entries.map(entry => entry.kind)).toEqual(["log", "message"]);
		expect(f.history.streams.get(`conversation-tool-result-notification-${completed.toolSelection!.proposalId}`)).toHaveLength(1);
		expect(f.model.request).toHaveBeenCalledTimes(2);
		const [first, final] = f.model.request.mock.calls.map(call => call[0]);
		expect(first.maxCompletionTokens + final.maxCompletionTokens).toBe(f.candidate.compiledInput.budget.maxCompletionTokens);
		expect(final).toMatchObject({ tools: ConversationModelToolModes.None, compiledInput: first.compiledInput, key: first.key });
		expect(f.credentials.issueOnce).toHaveBeenCalledOnce();
		expect(f.credentials.reuseExact).toHaveBeenCalledOnce();
		expect(f.toolFlags).toMatchObject({ executions: 1, acknowledgements: 1, consumed: true });
		const visible = JSON.stringify(entries[2].data);
		for (const privateValue of ["private-query", "private-result", "test-only-key", "Private assistant declaration", completed.continuationReservation!.resultDigest])
			expect(visible).not.toContain(privateValue);
		expect(lost).toBe(true);
	});

	it("does not reserve or consume a continuation while publication is unavailable", async function _Unavailable()
	{
		const f = await _ResultJourney();
		f.notifications.publishTerminal.mockRejectedValueOnce(new Error("history unavailable"));
		expect(await f.authority.advance(f.step)).toEqual({ outcome: "retry" });
		const paused = (await f.store.load(f.step))!;
		expect(paused.continuationReservation).toBeNull();
		expect(f.toolFlags.consumed).toBe(false);
		expect(f.model.request).toHaveBeenCalledOnce();
		expect(await f.restart().advance(f.step)).toEqual({ outcome: "completed" });
		expect(f.model.request).toHaveBeenCalledTimes(2);
		expect(f.toolFlags.executions).toBe(1);
	});

	it("ends model progression when current publication authority is withdrawn", async function _Withdrawn()
	{
		const f = await _ResultJourney();
		f.notifications.publishTerminal.mockResolvedValue(ConversationToolResultNotificationOutcomes.NoLongerVisible);
		expect(await f.authority.advance(f.step)).toEqual({ outcome: "authority_ended" });
		expect((await f.store.load(f.step))?.continuationReservation).toBeNull();
		expect(f.toolFlags.consumed).toBe(false);
		expect(f.model.request).toHaveBeenCalledOnce();
		expect(f.history.streams.get(f.stream)).toHaveLength(2);
	});
});
