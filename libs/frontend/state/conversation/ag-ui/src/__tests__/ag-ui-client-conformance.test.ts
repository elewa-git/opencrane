import { AbstractAgent, buildResumeArray, isInterruptExpired, type AgentSubscriber } from "@ag-ui/client";
import { EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/core";
import { from } from "rxjs";
import { describe, expect, it } from "vitest";

import { AG_UI_A2UI_ENVELOPE_VERSION, AgUiA2uiSurfaceStates } from "@opencrane/contracts";

/** Exact pinned-client harness around server-projected event batches. */
class _ProjectedEventAgent extends AbstractAgent
{
	/** Run inputs captured to prove exact resume forwarding. */
	public readonly inputs: RunAgentInput[] = [];

	/** Batches returned by consecutive reconnect or resume runs. */
	private readonly _batches: BaseEvent[][];

	public constructor(batches: BaseEvent[][])
	{
		super({ threadId: "conversation-1" });
		this._batches = batches;
	}

	/** @inheritdoc */
	public override run(input: RunAgentInput): ReturnType<AbstractAgent["run"]>
	{
		this.inputs.push(input);
		// The pinned client declares its exact RxJS patch version. The browser Observable is runtime
		// compatible but nominally distinct in TypeScript because both Subscriber classes use protected fields.
		return from(this._batches.shift() ?? []) as unknown as ReturnType<AbstractAgent["run"]>;
	}
}

/** Standard run-start frame for one captured client run. */
function _Started(runId: string): BaseEvent
{
	return { type: EventType.RUN_STARTED, threadId: "conversation-1", runId };
}

/** Standard successful terminal for one captured client run. */
function _Succeeded(runId: string): BaseEvent
{
	return { type: EventType.RUN_FINISHED, threadId: "conversation-1", runId, outcome: { type: "success" } };
}

describe("pinned AG-UI client conformance", function _PinnedClientConformance()
{
	it("drives completion, tool activity, and governed A2UI through client 0.0.57", async function _DrivesHappyPath()
	{
		const a2ui = { version: AG_UI_A2UI_ENVELOPE_VERSION, conversationId: "conversation-1", runId: "run-happy", messageId: "message-1", surfaceId: "surface-1", sequence: 0, state: AgUiA2uiSurfaceStates.Ready, operations: [{ beginRendering: { surfaceId: "surface-1", root: "root-1" } }] };
		const events: BaseEvent[] =
		[
			_Started("run-happy"),
			{ type: EventType.TEXT_MESSAGE_START, messageId: "message-1", role: "assistant" },
			{ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "message-1", delta: "Checking the record." },
			{ type: EventType.TEXT_MESSAGE_END, messageId: "message-1" },
			{ type: EventType.TOOL_CALL_START, toolCallId: "tool-1", toolCallName: "records.search" },
			{ type: EventType.TOOL_CALL_ARGS, toolCallId: "tool-1", delta: "{\"query\":\"renewal\"}" },
			{ type: EventType.TOOL_CALL_END, toolCallId: "tool-1" },
			{ type: EventType.TOOL_CALL_RESULT, toolCallId: "tool-1", messageId: "tool-message-1", role: "tool", content: "Found one record" },
			{ type: EventType.CUSTOM, name: AG_UI_A2UI_ENVELOPE_VERSION, value: a2ui },
			_Succeeded("run-happy")
		];
		const observed: BaseEvent[] = [];
		const subscriber: AgentSubscriber = { onEvent: function _Event({ event }): void { observed.push(event); } };
		const agent = new _ProjectedEventAgent([events]);

		await expect(agent.runAgent({ runId: "run-happy" }, subscriber)).resolves.toBeDefined();
		expect(observed.map(function _Type(event) { return event.type; })).toEqual(events.map(function _Type(event) { return event.type; }));
		expect(observed.find(function _A2ui(event) { return event.type === EventType.CUSTOM; })).toMatchObject({ name: AG_UI_A2UI_ENVELOPE_VERSION, value: a2ui });
		expect(agent.inputs[0]?.threadId).toBe("conversation-1");
	});

	it("preserves one open approval across reconnect and forwards approve-with-edits exactly", async function _ApprovalResume()
	{
		const interrupt = { id: "approval-1", reason: "tool_approval", message: "Review the exact query", toolCallId: "tool-1", responseSchema: { type: "object", required: ["query"], properties: { query: { type: "string" } } }, expiresAt: "2026-08-12T00:00:00.000Z" };
		const agent = new _ProjectedEventAgent([
			[_Started("run-approval"), { type: EventType.RUN_FINISHED, threadId: "conversation-1", runId: "run-approval", outcome: { type: "interrupt", interrupts: [interrupt] } }],
			[_Started("run-resume"), _Succeeded("run-resume")]
		]);

		await agent.runAgent({ runId: "run-approval" });
		expect(agent.pendingInterrupts).toEqual([interrupt]);
		const resume = buildResumeArray(agent.pendingInterrupts, { "approval-1": { status: "resolved", payload: { query: "edited query" } } });
		await agent.runAgent({ runId: "run-resume", resume });

		expect(agent.inputs[1]?.resume).toEqual([{ interruptId: "approval-1", status: "resolved", payload: { query: "edited query" } }]);
		expect(agent.pendingInterrupts).toEqual([]);
	});

	it("represents denial and expiry without manufacturing a successful answer", function _DenialAndExpiry()
	{
		const expired = { id: "approval-expired", reason: "tool_approval", expiresAt: "2026-08-10T00:00:00.000Z" };
		const active = { id: "approval-active", reason: "tool_approval", expiresAt: "2026-08-12T00:00:00.000Z" };

		expect(buildResumeArray([active], { "approval-active": { status: "cancelled" } })).toEqual([{ interruptId: "approval-active", status: "cancelled" }]);
		expect(isInterruptExpired(expired, new Date("2026-08-11T00:00:00.000Z"))).toBe(true);
		expect(isInterruptExpired(active, new Date("2026-08-11T00:00:00.000Z"))).toBe(false);
	});

	it.each([
		["failure", "PROVIDER_FAILED"],
		["abort", "RUN_CANCELLED"]
	] as const)("keeps a projected %s terminal on the client error path", async function _ErrorTerminal(_label, code)
	{
		const failures: string[] = [];
		const agent = new _ProjectedEventAgent([[_Started(`run-${code}`), { type: EventType.RUN_ERROR, message: code === "RUN_CANCELLED" ? "Run cancelled" : "Provider failed", code }]]);
		const subscriber: AgentSubscriber = { onRunErrorEvent: function _RunError({ event }): void { failures.push(event.code ?? ""); } };

		await expect(agent.runAgent({ runId: `run-${code}` }, subscriber)).resolves.toBeDefined();
		expect(failures).toEqual([code]);
	});
});
