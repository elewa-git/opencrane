// @vitest-environment jsdom

import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { __CreateConversationHistoryProjection } from "@opencrane/state/conversation/stream";
import { ConversationLifecycles, ConversationModes } from "@opencrane/models/conversations";

import { CONVERSATION_CURRENT_SUBJECT } from "../conversation-workspace.gateway";
import { ConversationWorkspaceGatewayError, ConversationWorkspaceGatewayErrorKinds } from "../conversation-workspace-gateway.errors";
import { ConversationPersonalRunsStore } from "../conversation-personal-runs.store";
import { CONVERSATION_PERSONAL_RUNS_GATEWAY, type ConversationPersonalRun } from "../conversation-personal-runs.types";
import { ConversationWorkspaceStore } from "../conversation-workspace.store";
import { ConversationWorkspaceRouteStates, type ConversationWorkspaceDetail } from "../conversation-workspace.types";

/** Supplies the selected personal chat without borrowing the real workspace's transport. */
function _Detail(id = "chat-1"): ConversationWorkspaceDetail
{
	return { id, mode: ConversationModes.AgentSession, lifecycle: ConversationLifecycles.Open, agentServiceId: "agent", participantRefs: ["self"], archivedAt: null, readThroughPosition: "0", updatedAt: "2026-09-08T12:00:00.000Z", visibleFromPosition: "0", parent: null, accessEndedPosition: null };
}

/** Creates a current API projection with no copied transcript or internal authority fields. */
function _Run(conversationId = "chat-1", state: ConversationPersonalRun["state"] = "completed"): ConversationPersonalRun
{
	return { runId: `run-${conversationId}`, conversationId, state, attempt: 1, agentRevisionId: "revision", acceptedAt: "2026-09-08T12:00:00.000Z", finishedAt: state === "completed" ? "2026-09-08T12:00:02.000Z" : null };
}

/** Provides signals that can change independently while an uncancellable request is pending. */
function _Store(listPersonalRuns = vi.fn().mockResolvedValue([_Run()]))
{
	const selected = signal<ConversationWorkspaceDetail | null>(_Detail());
	const subject = signal<string | null>("user-1");
	const routeState = signal(ConversationWorkspaceRouteStates.Ready);
	const live = signal(__CreateConversationHistoryProjection());
	TestBed.configureTestingModule({ providers: [ConversationPersonalRunsStore, { provide: CONVERSATION_PERSONAL_RUNS_GATEWAY, useValue: { listPersonalRuns } }, { provide: CONVERSATION_CURRENT_SUBJECT, useValue: subject }, { provide: ConversationWorkspaceStore, useValue: { selected, routeState, live } }] });
	return { store: TestBed.inject(ConversationPersonalRunsStore), selected, subject, routeState, live, listPersonalRuns };
}

/** Lets a request finish after its scope is no longer selected. */
function _Deferred<Value>()
{
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>(function _Promise(callback) { resolve = callback; });
	return { promise, resolve: (value: Value) => resolve(value) };
}

/** Settles resource effects without advancing the automatic refresh clock. */
async function _Settle(): Promise<void>
{
	TestBed.flushEffects();
	await Promise.resolve();
	await Promise.resolve();
	TestBed.flushEffects();
}

beforeAll(function _Initialize() { TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()); });
afterAll(function _ResetEnvironment() { TestBed.resetTestEnvironment(); });
afterEach(function _Reset() { TestBed.resetTestingModule(); vi.useRealTimers(); });

describe("personal recent work", function _Suite()
{
	it("keeps only selected rows and replaces them when permissions return an empty list", async function _FilterAndClear()
	{
		const fixture = _Store(vi.fn().mockResolvedValueOnce([_Run(), _Run("chat-2")]).mockResolvedValueOnce([]));
		await vi.waitFor(() => expect(fixture.store.runs()).toEqual([_Run()]));
		fixture.store.refresh();
		await vi.waitFor(() => expect(fixture.store.runs()).toEqual([]));
		expect(fixture.listPersonalRuns).toHaveBeenCalledTimes(2);
	});

	it.each(["subject", "selection", "access", "route"])("clears rows immediately when %s changes", async function _Invalidation(kind)
	{
		const fixture = _Store();
		await vi.waitFor(() => expect(fixture.store.runs()).toHaveLength(1));
		if (kind === "subject")
			fixture.subject.set("user-2");
		if (kind === "selection")
			fixture.selected.set(_Detail("chat-2"));
		if (kind === "access")
			fixture.selected.set({ ..._Detail(), accessEndedPosition: "3" });
		if (kind === "route")
			fixture.routeState.set(ConversationWorkspaceRouteStates.AccessChanged);
		expect(fixture.store.runs()).toEqual([]);
	});

	it("rejects late results after switching away and reopening the same chat", async function _LateRead()
	{
		const first = _Deferred<readonly ConversationPersonalRun[]>();
		const fixture = _Store(vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue([]));
		await vi.waitFor(() => expect(fixture.listPersonalRuns).toHaveBeenCalledOnce());
		const signal = fixture.listPersonalRuns.mock.calls[0]![0] as AbortSignal;
		fixture.selected.set(_Detail("chat-2"));
		await vi.waitFor(() => expect(fixture.listPersonalRuns).toHaveBeenCalledTimes(2));
		fixture.selected.set(_Detail());
		await vi.waitFor(() => expect(fixture.listPersonalRuns).toHaveBeenCalledTimes(3));
		first.resolve([_Run()]);
		await _Settle();
		expect(signal.aborted).toBe(true);
		expect(fixture.store.runs()).toEqual([]);
	});

	it("clears failed refresh rows and stops access-denied retries until reopening", async function _Denied()
	{
		const denied = new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.AccessChanged, "private server detail");
		const fixture = _Store(vi.fn().mockResolvedValueOnce([_Run()]).mockRejectedValueOnce(denied).mockResolvedValue([]));
		await vi.waitFor(() => expect(fixture.store.runs()).toHaveLength(1));
		fixture.store.refresh();
		await vi.waitFor(() => expect(fixture.store.accessChanged()).toBe(true));
		expect(fixture.store.runs()).toEqual([]);
		expect(fixture.store.error()).not.toContain("private server detail");
		fixture.store.refresh();
		fixture.live.update(value => ({ ...value, nextPosition: "2" }));
		await _Settle();
		expect(fixture.listPersonalRuns).toHaveBeenCalledTimes(2);
		fixture.selected.set(_Detail());
		await vi.waitFor(() => expect(fixture.listPersonalRuns).toHaveBeenCalledTimes(3));
	});

	it.each([ConversationModes.Direct, ConversationModes.Group])("does not request activity for %s", async function _OrdinaryMode(mode)
	{
		const fixture = _Store();
		fixture.selected.set({ ..._Detail(), mode });
		await _Settle();
		expect(fixture.listPersonalRuns).not.toHaveBeenCalled();
		expect(fixture.store.eligible()).toBe(false);
	});

	it("refreshes active work despite unchanged heartbeats and stops after one minute", async function _RefreshWindow()
	{
		vi.useFakeTimers();
		const fixture = _Store(vi.fn().mockResolvedValue([_Run("chat-1", "running")]));
		await _Settle();
		expect(fixture.listPersonalRuns).toHaveBeenCalledOnce();
		for (let second = 1; second <= 70; second += 1)
		{
			fixture.live.update(value => ({ ...value }));
			await _Settle();
			await vi.advanceTimersByTimeAsync(1_000);
			await _Settle();
		}
		expect(fixture.listPersonalRuns).toHaveBeenCalledTimes(12);
		fixture.store.refresh();
		await _Settle();
		expect(fixture.listPersonalRuns).toHaveBeenCalledTimes(13);
	});

	it("refreshes a status that completes after the answer's history checkpoint", async function _LateCompletion()
	{
		vi.useFakeTimers();
		const fixture = _Store(vi.fn().mockResolvedValueOnce([_Run("chat-1", "running")]).mockResolvedValue([_Run()]));
		await _Settle();
		await vi.advanceTimersByTimeAsync(5_000);
		await _Settle();
		expect(fixture.store.runs()[0]?.state).toBe("completed");
		await vi.advanceTimersByTimeAsync(20_000);
		expect(fixture.listPersonalRuns).toHaveBeenCalledTimes(2);
	});
});
