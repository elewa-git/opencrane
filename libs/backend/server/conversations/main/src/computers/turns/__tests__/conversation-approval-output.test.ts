import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationHistoryAuthority, ConversationHistoryModes, ConversationHistoryReader } from "@opencrane/backend/server/conversations/history";
import { CONVERSATION_ELICITATION_VERSION, ConversationModelToolModes, ConversationToolProposalOutcomes, ElicitationBodyKinds, ElicitationPurposes, ElicitationRequestStates, type ConversationElicitation } from "@opencrane/contracts";

import { ConversationApprovalNotificationOutcomes } from "../approval-notifications/conversation-approval-notification.types";
import { KurrentConversationApprovalNotificationPublisher } from "../approval-notifications/kurrent-conversation-approval-notification";
import { ConversationComputerToolResultOutcomes } from "../conversation-computer-continuation.types";
import { _ToolContinuationHarness } from "./conversation-tool-continuation.fixture";

afterEach(function _Restore() { vi.restoreAllMocks(); });

describe("approval history and the saved model continuation", function _Suite()
{
	it.each(["notification", "answer"])("recovers a lost %s reply and keeps the original two-call allowance", async function _Recover(lostReply)
	{
		const f = await _ToolContinuationHarness();
		const historyAuthority = new ConversationHistoryAuthority(f.history);
		const historyReader = new ConversationHistoryReader(f.history);
		const genesis = historyAuthority.genesisAppend({ schemaVersion: 1, siloId: "silo-1", conversationId: "conversation-1", mode: ConversationHistoryModes.AgentSession, agentServiceId: "service-1", createdByPrincipalId: "owner-1", createdAt: new Date().toISOString() }, "71c1f1dc-0010-4f13-9c2f-d3841ffd6651");
		f.history.streams.get(f.stream)![0] = { ...f.history.streams.get(f.stream)![0], ...genesis.events[0], metadata: Object.fromEntries(Object.entries(genesis.events[0].metadata).map(([key, value]) => [key, String(value)])) };
		Object.assign(f.candidate.compiledInput.tools[0], { requiresApproval: true });
		let approved = false;
		const admit = f.proposals.admit.getMockImplementation()!;
		const read = f.results.read.getMockImplementation()!;
		f.proposals.admit.mockImplementation(async function _AdmitAfterApproval(turn)
		{
			if (!approved)
				return { proposalId: turn.toolSelection!.proposalId, outcome: ConversationToolProposalOutcomes.Existing };
			return admit(turn);
		});
		f.results.read.mockImplementation(async function _WaitForDecision(turn)
		{
			if (!approved)
				return { outcome: ConversationComputerToolResultOutcomes.Pending, waitFor: "approval", waitUntilEpochMs: Date.now() + 60_000 } as const;
			return read(turn);
		});

		expect(await f.authority.advance(f.step)).toMatchObject({ outcome: "tool_pending", waitFor: "approval" });
		expect(f.model.request).toHaveBeenCalledOnce();
		expect(f.toolFlags.executions).toBe(0);
		const waiting = (await f.store.load(f.step))!;
		const approvalId = waiting.toolSelection!.proposalId;
		const command = { bootstrapId: f.step, siloId: waiting.siloId, conversationId: waiting.binding.conversationId, runId: waiting.compile.runId, attempt: waiting.compile.attempt, approvalId };
		const request: ConversationElicitation = { version: CONVERSATION_ELICITATION_VERSION, requestId: approvalId, conversationId: command.conversationId, runId: command.runId, attempt: command.attempt, assignedParticipantId: "owner-1", purpose: ElicitationPurposes.ToolApproval, state: ElicitationRequestStates.Requested, body: { kind: ElicitationBodyKinds.Approval, prompt: "Allow this tool call?", action: "Invoke tool", target: "lookup_record", dataUse: "Send the reviewed arguments to the tool.", consequence: "Runs the selected tool once.", proposedArguments: { query: "private-query" } }, requiresStepUp: true, requestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() };
		const requests = { readCurrent: vi.fn().mockResolvedValue(request) };
		let lost = false;
		f.history.afterAppend = async function _LoseOneReply(append)
		{
			const isNotification = append.streamName.startsWith("conversation-approval-notification-");
			const isAnswer = append.streamName === f.stream && append.events[0].id !== approvalId;
			if (!lost && (lostReply === "notification" ? isNotification : isAnswer))
			{
				lost = true;
				throw new Error("committed response lost");
			}
		};
		const notifications = new KurrentConversationApprovalNotificationPublisher(requests, historyAuthority, historyReader, f.history);
		if (lostReply === "notification")
			await expect(notifications.publishRequested(command)).rejects.toThrow("committed response lost");
		else
			await expect(notifications.publishRequested(command)).resolves.toBe(ConversationApprovalNotificationOutcomes.Published);

		const restartedHistoryAuthority = new ConversationHistoryAuthority(f.history);
		const restartedHistoryReader = new ConversationHistoryReader(f.history);
		const restartedNotifications = new KurrentConversationApprovalNotificationPublisher(requests, restartedHistoryAuthority, restartedHistoryReader, f.history);
		await expect(restartedNotifications.publishRequested(command)).resolves.toBe(ConversationApprovalNotificationOutcomes.Published);
		expect(await f.restart().advance(f.step)).toMatchObject({ outcome: "tool_pending", waitFor: "approval" });
		expect(f.model.request).toHaveBeenCalledOnce();
		expect(f.history.streams.get(f.stream)).toHaveLength(3);
		expect(f.history.streams.get(f.stream)![2].data["entry"]).toMatchObject({ id: approvalId, position: "2", phase: "requested" });
		expect(JSON.stringify(f.history.streams.get(f.stream)![2].data)).not.toContain("private-query");

		approved = true;
		const completion = await f.restart().advance(f.step);
		expect(completion.outcome).toBe(lostReply === "answer" ? "model_pending" : "completed");
		expect(await f.restart().advance(f.step)).toEqual({ outcome: "completed" });
		expect(await f.restart().advance(f.step)).toEqual({ outcome: "completed" });
		const completed = (await f.store.load(f.step))!;
		expect(completed.modelReservation).toEqual(waiting.modelReservation);
		expect(completed.continuationReservation?.ordinal).toBe(2);
		expect(completed.outputReceipt?.expectedRevision).toBe("2");
		expect(f.history.streams.get(f.stream)).toHaveLength(4);
		expect(f.history.streams.get(f.stream)![3].data).toEqual(completed.outputReceipt!.event.data);
		expect(f.history.streams.get(`conversation-approval-notification-${approvalId}`)).toHaveLength(1);
		expect(JSON.stringify(f.history.streams.get(`conversation-approval-notification-${approvalId}`)![0].data)).not.toContain("private-query");
		expect(f.model.request).toHaveBeenCalledTimes(2);
		const [first, continuation] = f.model.request.mock.calls.map(call => call[0]);
		expect(first.maxCompletionTokens + continuation.maxCompletionTokens).toBe(f.candidate.compiledInput.budget.maxCompletionTokens);
		expect(continuation).toMatchObject({ tools: ConversationModelToolModes.None, compiledInput: first.compiledInput, key: first.key });
		expect(f.credentials.issueOnce).toHaveBeenCalledOnce();
		expect(f.credentials.reuseExact).toHaveBeenCalledOnce();
		expect(f.toolFlags).toMatchObject({ executions: 1, acknowledgements: 1, consumed: true });
		expect(lost).toBe(true);
	});
});
