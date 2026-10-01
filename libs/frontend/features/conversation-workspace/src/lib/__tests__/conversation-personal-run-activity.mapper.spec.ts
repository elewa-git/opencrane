import { describe, expect, it } from "vitest";

import type { MessageEntry } from "@opencrane/contracts";
import { RunToolProgressPhases } from "@opencrane/contracts";
import type { ConversationPersonalRun } from "@opencrane/state/conversation/workspace";

import { _PersonalRunActivity } from "../conversation-personal-run-activity.mapper";

/** Models a completed API run without implying that its answer is loaded. */
const _RUN: ConversationPersonalRun = { runId: "run", conversationId: "chat", state: "completed", attempt: 1, agentRevisionId: "revision", acceptedAt: "2026-09-08T12:00:00Z", latestTool: null, finishedAt: "2026-09-08T12:00:01Z" };
/** Models a still-running run after its tool result arrived but before an answer is committed. */
const _RUNNING_WITH_TOOL_RESULT: ConversationPersonalRun = { ..._RUN, state: "running", latestTool: { phase: RunToolProgressPhases.ResultReceived }, finishedAt: null };
/** Models an authorized completed agent answer before the feature maps its private payload. */
const _ANSWER: MessageEntry = { schemaVersion: 1, id: "answer", conversationId: "chat", position: "9", author: { kind: "agent", agentIdentityId: "identity", agentServiceId: "service", name: "Assistant", avatarArtifactRevisionId: null }, provenance: "agent-authored", visibility: { audience: "conversation" }, runId: "run", causationId: "run", correlationId: "chat", idempotencyKey: "answer", occurredAt: "2026-09-08T12:00:01Z", attestation: null, kind: "message", state: "completed", blocks: [], replyToEntryId: null, addressedAgentIdentityId: null, activation: "none" };

describe("recent activity answer links", function _Suite()
{
	it("links only a rendered completed answer and chooses the latest numeric position", function _LoadedAnswer()
	{
		const later = { ..._ANSWER, id: "later", position: "10" };
		const row = _PersonalRunActivity([_RUN], "chat", [later, _ANSWER], new Set(["answer", "later"]))[0]!;
		expect(row.target).toEqual({ conversationId: "chat", runId: "run", entryId: "later" });
		expect(row.label).toBe("Assistant work");
	});

	it("does not invent a link from a completed run or an unrendered answer", function _MissingAnswer()
	{
		expect(_PersonalRunActivity([_RUN], "chat", [], new Set())[0]!.target).toBeNull();
		expect(_PersonalRunActivity([_RUN], "chat", [_ANSWER], new Set())[0]!.target).toBeNull();
	});

	it("keeps tool-result progress separate from answer readiness", function _ToolResultProgress()
	{
		const row = _PersonalRunActivity([_RUNNING_WITH_TOOL_RESULT], "chat", [], new Set())[0]!;
		expect(row.status).toBe("running");
		expect(row.latestTool).toEqual({ phase: RunToolProgressPhases.ResultReceived });
		expect(row.target).toBeNull();
	});

	it("rejects answers for another run or conversation and unfinished messages", function _WrongAnswer()
	{
		const entries = [{ ..._ANSWER, id: "foreign-chat", conversationId: "other" }, { ..._ANSWER, id: "foreign-run", runId: "other" }, { ..._ANSWER, id: "streaming", state: "streaming" as const }];
		expect(_PersonalRunActivity([_RUN], "chat", entries, new Set(entries.map(entry => entry.id)))[0]!.target).toBeNull();
		expect(_PersonalRunActivity([_RUN], "other", [_ANSWER], new Set(["answer"]))).toEqual([]);
		expect(_PersonalRunActivity([_RUN], null, [_ANSWER], new Set(["answer"]))).toEqual([]);
	});
});
