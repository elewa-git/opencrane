// @vitest-environment jsdom

import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { AgentThreadStore } from "../agent-thread.store.js";
import { AgentThreadGatewayError, AgentThreadGatewayErrorKinds } from "../agent-thread-gateway.errors.js";
import { AGENT_THREAD_GATEWAY } from "../agent-thread.gateway.js";
import { AgentThreadAccessStates, AgentThreadRecoveryStates, AgentThreadRouteStates, AgentThreadRunStates, AgentThreadSummaryStates, AgentThreadTimelineEntryKinds, type AgentThreadGateway, type AgentThreadSnapshot } from "../agent-thread.types.js";

/** Build one complete display-safe snapshot for store tests. */
function _Snapshot(overrides: Partial<AgentThreadSnapshot> = {}): AgentThreadSnapshot
{
	return {
		parentConversationId: "parent-1",
		childConversationId: "child-1",
		origin: { parentTitle: "Launch planning", parentMessageId: "message-root", invokedByName: "Alex Kimani", invokedByInitials: "AK", ask: "@agent compare the counterproposal", timestampLabel: "11:07" },
		summary: { childConversationId: "child-1", state: AgentThreadSummaryStates.Working, access: AgentThreadAccessStates.Available, title: "Compare the counterproposal", preview: "Reviewing the commercial terms", unreadCount: 0, participantInitials: ["AK", "JR"], replyCount: 2 },
		recovery: AgentThreadRecoveryStates.Live,
		timeline: [
			{ kind: AgentThreadTimelineEntryKinds.RunBoundary, id: "boundary-run-1", run: { runId: "run-1", ordinal: 1, state: AgentThreadRunStates.Working, label: "Run 1" } },
			{ kind: AgentThreadTimelineEntryKinds.Message, id: "message-1", message: { id: "message-1", authorName: "Nova", authorInitials: "N", authoredByAgent: true, timestampLabel: "11:08", body: "I am comparing the terms." } }
		],
		cursor: "opaque-cursor",
		canSendFollowUp: true,
		...overrides
	};
}

/** Mutable dependency-neutral fake that exposes exact gateway outcomes. */
class _FakeAgentThreadGateway implements AgentThreadGateway
{
	/** Next read result or typed error. */
	public readResult: AgentThreadSnapshot | Error = _Snapshot();
	/** Next command result or typed error. */
	public sendResult: AgentThreadSnapshot | Error = _Snapshot();
	/** Submitted command bodies. */
	public readonly sentBodies: string[] = [];

	/** Resolve the configured read result. */
	public async read(): Promise<AgentThreadSnapshot>
	{
		if (this.readResult instanceof Error) throw this.readResult;
		return this.readResult;
	}

	/** Resolve the configured command result while recording only the body. */
	public async sendFollowUp(_childConversationId: string, body: string): Promise<AgentThreadSnapshot>
	{
		this.sentBodies.push(body);
		if (this.sendResult instanceof Error) throw this.sendResult;
		return this.sendResult;
	}
}

/** Create one store and its fake gateway. */
function _CreateStore(): readonly [AgentThreadStore, _FakeAgentThreadGateway]
{
	const gateway = new _FakeAgentThreadGateway();
	TestBed.configureTestingModule({ providers: [AgentThreadStore, { provide: AGENT_THREAD_GATEWAY, useValue: gateway }] });
	return [TestBed.inject(AgentThreadStore), gateway];
}

beforeAll(function _InitializeAngularTesting()
{
	TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
	vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("follow-up-key-1") });
});

afterAll(function _ResetAngularTesting()
{
	vi.unstubAllGlobals();
	TestBed.resetTestEnvironment();
});

afterEach(function _ResetTestBed() { TestBed.resetTestingModule(); });

describe("AgentThreadStore", function _AgentThreadStore()
{
	it("adopts only a snapshot matching both route coordinates", async function _ExactCoordinates()
	{
		const [store, gateway] = _CreateStore();
		gateway.readResult = _Snapshot({ childConversationId: "foreign-child" });
		await store.load("parent-1", "child-1");
		expect(store.routeState()).toBe(AgentThreadRouteStates.Unavailable);
		expect(store.snapshot()).toBeNull();
	});

	it("makes first-view absence and denial indistinguishable", async function _Unavailable()
	{
		const [store, gateway] = _CreateStore();
		gateway.readResult = new AgentThreadGatewayError(AgentThreadGatewayErrorKinds.AccessChanged, "Hidden detail");
		await store.load("parent-1", "child-1");
		expect(store.routeState()).toBe(AgentThreadRouteStates.Unavailable);
		expect(store.error()).toBeNull();
	});

	it("purges child content and draft before exposing proven access loss", async function _AccessChanged()
	{
		const [store, gateway] = _CreateStore();
		await store.load("parent-1", "child-1");
		store.updateDraft("Sensitive follow-up draft");
		gateway.readResult = new AgentThreadGatewayError(AgentThreadGatewayErrorKinds.AccessChanged, "Hidden detail");
		await store.load("parent-1", "child-1");
		expect(store.snapshot()).toBeNull();
		expect(store.draft()).toBe("");
		expect(store.error()).toBeNull();
		expect(store.routeState()).toBe(AgentThreadRouteStates.AccessChanged);
	});

	it("retains a controlled draft while reconnecting", async function _ReconnectDraft()
	{
		const [store] = _CreateStore();
		await store.load("parent-1", "child-1");
		store.updateDraft("What changed in the payment clause?");
		store.beginReconnect();
		expect(store.snapshot()?.recovery).toBe(AgentThreadRecoveryStates.Reconnecting);
		expect(store.draft()).toBe("What changed in the payment clause?");
		expect(store.canSendFollowUp()).toBe(false);
	});

	it("sends the exact draft once and adopts the matching authoritative result", async function _SendFollowUp()
	{
		const [store, gateway] = _CreateStore();
		gateway.sendResult = _Snapshot({ canSendFollowUp: false });
		await store.load("parent-1", "child-1");
		store.updateDraft("Summarise the remaining risk.");
		expect(await store.sendFollowUp()).toBe(true);
		expect(gateway.sentBodies).toEqual(["Summarise the remaining risk."]);
		expect(store.draft()).toBe("");
		expect(store.snapshot()?.canSendFollowUp).toBe(false);
	});
});
