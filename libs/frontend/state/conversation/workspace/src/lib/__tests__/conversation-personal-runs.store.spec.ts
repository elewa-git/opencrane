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
	return { runId: `run-${conversationId}`, conversationId, state, attempt: 1, agentRevisionId: "revision", acceptedAt: "2026-09-08T12:00:00.000Z", latestTool: null, finishedAt: state === "completed" ? "2026-09-08T12:00:02.000Z" : null };
}

/** Provides signals that can change independently while an uncancellable request is pending. */
function _Store(listPersonalRuns = vi.fn().mockResolvedValue([_Run()]), requestStop = vi.fn().mockResolvedValue(undefined))
{
	const selected = signal<ConversationWorkspaceDetail | null>(_Detail());
	const subject = signal<string | null>("user-1");
	const routeState = signal(ConversationWorkspaceRouteStates.Ready);
	const live = signal(__CreateConversationHistoryProjection());
	TestBed.configureTestingModule({ providers: [ConversationPersonalRunsStore, { provide: CONVERSATION_PERSONAL_RUNS_GATEWAY, useValue: { listPersonalRuns, requestStop } }, { provide: CONVERSATION_CURRENT_SUBJECT, useValue: subject }, { provide: ConversationWorkspaceStore, useValue: { selected, routeState, live } }] });
	return { store: TestBed.inject(ConversationPersonalRunsStore), selected, subject, routeState, live, listPersonalRuns, requestStop };
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

	it("keeps company-child work outside the personal requester control", async function _CompanyChild()
	{
		const fixture = _Store();
		fixture.selected.set({ ..._Detail(), parent: { requestId: "request", parentConversationId: "group", parentMessageId: "message", parentMessagePosition: "2" } });
		await _Settle();
		expect(fixture.store.eligible()).toBe(false);
		expect(fixture.store.currentRun()).toBeNull();
		await expect(fixture.store.requestStop()).resolves.toBe(false);
		expect(fixture.requestStop).not.toHaveBeenCalled();
	});

	it("keeps Stop pending until an authoritative cancelling state is read", async function _AuthoritativeStop()
	{
		const list = vi.fn().mockResolvedValueOnce([_Run("chat-1", "running")]).mockResolvedValue([{ ..._Run("chat-1", "running"), state: "cancelling" }]);
		const fixture = _Store(list);
		await vi.waitFor(() => expect(fixture.store.currentRun()?.state).toBe("running"));
		await expect(fixture.store.requestStop()).resolves.toBe(true);
		expect(fixture.requestStop).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "chat-1", runId: "run-chat-1", attempt: 1 }));
		await vi.waitFor(() => expect(fixture.store.currentRun()?.state).toBe("cancelling"));
		await _Settle();
		expect(fixture.store.stopPending()).toBe(false);
		expect(fixture.store.stopError()).toBeNull();
	});

	it("reuses the same Stop key after an ambiguous failure", async function _StableRetry()
	{
		const unavailable = new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.Recoverable, "private");
		const requestStop = vi.fn().mockRejectedValueOnce(unavailable).mockRejectedValueOnce(unavailable);
		const fixture = _Store(vi.fn().mockResolvedValue([_Run("chat-1", "running")]), requestStop);
		await vi.waitFor(() => expect(fixture.store.currentRun()?.state).toBe("running"));
		await expect(fixture.store.requestStop()).resolves.toBe(false);
		await expect(fixture.store.requestStop()).resolves.toBe(false);
		expect(requestStop).toHaveBeenCalledTimes(2);
		expect(requestStop.mock.calls[1]![0].idempotencyKey).toBe(requestStop.mock.calls[0]![0].idempotencyKey);
		expect(fixture.store.stopPending()).toBe(true);
		expect(fixture.store.stopError()).not.toContain("private");
	});

	it("uses a fresh key after a definite conflict while retaining ambiguous retry keys", async function _ConflictRetry()
	{
		const conflict = new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.Conflict, "private");
		const requestStop = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce(undefined);
		const fixture = _Store(vi.fn().mockResolvedValue([_Run("chat-1", "running")]), requestStop);
		await vi.waitFor(() => expect(fixture.store.currentRun()?.state).toBe("running"));
		await expect(fixture.store.requestStop()).resolves.toBe(false);
		expect(fixture.store.stopBusy()).toBe(false);
		expect(fixture.store.stopPending()).toBe(false);
		await _Settle();
		await expect(fixture.store.requestStop()).resolves.toBe(true);
		expect(requestStop.mock.calls[1]![0].idempotencyKey).not.toBe(requestStop.mock.calls[0]![0].idempotencyKey);
	});

	it("allows a fresh explicit Stop when an acknowledged message never changes the run", async function _UnconfirmedAdmission()
	{
		vi.useFakeTimers();
		const fixture = _Store(vi.fn().mockResolvedValue([_Run("chat-1", "running")]));
		await _Settle();
		await vi.advanceTimersByTimeAsync(70_000);
		await _Settle();
		await expect(fixture.store.requestStop()).resolves.toBe(true);
		await _Settle();
		const reads = fixture.listPersonalRuns.mock.calls.length;
		await vi.advanceTimersByTimeAsync(5_000);
		await _Settle();
		expect(fixture.listPersonalRuns.mock.calls.length).toBeGreaterThan(reads);
		expect(fixture.store.stopPending()).toBe(true);
		await vi.advanceTimersByTimeAsync(55_000);
		await _Settle();
		expect(fixture.store.stopPending()).toBe(false);
		expect(fixture.store.stopError()).toContain("Stop has not been confirmed");
		expect(fixture.store.currentRun()?.state).toBe("running");
		expect(fixture.requestStop).toHaveBeenCalledOnce();
		await expect(fixture.store.requestStop()).resolves.toBe(true);
		expect(fixture.requestStop.mock.calls[1]![0].idempotencyKey).not.toBe(fixture.requestStop.mock.calls[0]![0].idempotencyKey);
	});

	it("keeps an ambiguous Stop retry key after the confirmation window would have ended", async function _AmbiguousDeadline()
	{
		vi.useFakeTimers();
		const unavailable = new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.Recoverable, "private");
		const fixture = _Store(vi.fn().mockResolvedValue([_Run("chat-1", "running")]), vi.fn().mockRejectedValue(unavailable));
		await _Settle();
		await expect(fixture.store.requestStop()).resolves.toBe(false);
		await _Settle();
		await vi.advanceTimersByTimeAsync(70_000);
		await _Settle();
		expect(fixture.store.stopPending()).toBe(true);
		await expect(fixture.store.requestStop()).resolves.toBe(false);
		expect(fixture.requestStop.mock.calls[1]![0].idempotencyKey).toBe(fixture.requestStop.mock.calls[0]![0].idempotencyKey);
	});

	it("does not report an unconfirmed Stop after cancellation becomes authoritative", async function _ConfirmedBeforeDeadline()
	{
		vi.useFakeTimers();
		const list = vi.fn().mockResolvedValue([_Run("chat-1", "running")]);
		const fixture = _Store(list);
		await _Settle();
		await expect(fixture.store.requestStop()).resolves.toBe(true);
		list.mockResolvedValue([_Run("chat-1", "cancelled")]);
		await _Settle();
		await vi.advanceTimersByTimeAsync(5_000);
		await _Settle();
		expect(fixture.store.stopPending()).toBe(false);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(fixture.store.stopError()).toBeNull();
	});

	it.each(["queued", "assigned", "recovery_required"])("matches server admission for %s", async function _LifecycleAdmission(state)
	{
		const requestStop = vi.fn().mockResolvedValue(undefined);
		const fixture = _Store(vi.fn().mockResolvedValue([{ ..._Run("chat-1", "running"), state }]), requestStop);
		await vi.waitFor(() => expect(fixture.store.currentRun()?.state).toBe(state));
		await expect(fixture.store.requestStop()).resolves.toBe(state === "recovery_required");
		expect(requestStop).toHaveBeenCalledTimes(state === "recovery_required" ? 1 : 0);
	});

	it.each(["conflict", "unconfirmed"])("does not carry a %s Stop error into another chat", async function _StopErrorSelection(kind)
	{
		vi.useFakeTimers();
		const requestStop = vi.fn().mockResolvedValue(undefined);
		if (kind === "conflict")
			requestStop.mockRejectedValue(new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.Conflict, "private"));
		const list = vi.fn().mockResolvedValue([_Run("chat-1", "running"), _Run("chat-2", "running")]);
		const fixture = _Store(list, requestStop);
		await _Settle();
		await fixture.store.requestStop();
		await _Settle();
		if (kind === "unconfirmed")
			await vi.advanceTimersByTimeAsync(60_000);
		await _Settle();
		expect(fixture.store.stopError()).not.toBeNull();
		fixture.selected.set(_Detail("chat-2"));
		expect(fixture.store.stopError()).toBeNull();
		await _Settle();
		expect(fixture.store.currentRun()?.runId).toBe("run-chat-2");
		expect(fixture.store.stopError()).toBeNull();
		expect(fixture.store.stopPending()).toBe(false);
	});

	it("purges current work and pending Stop state when the command proves access loss", async function _StopAccessLoss()
	{
		const denied = new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.AccessChanged, "private");
		const fixture = _Store(vi.fn().mockResolvedValue([_Run("chat-1", "running")]), vi.fn().mockRejectedValue(denied));
		await vi.waitFor(() => expect(fixture.store.currentRun()?.state).toBe("running"));
		await expect(fixture.store.requestStop()).resolves.toBe(false);
		expect(fixture.store.currentRun()).toBeNull();
		expect(fixture.store.stopPending()).toBe(false);
		expect(fixture.store.stopError()).toBeNull();
	});

	it("fences a late Stop acknowledgement after selection changes", async function _StaleStop()
	{
		const stop = _Deferred<void>();
		const fixture = _Store(vi.fn().mockResolvedValue([_Run("chat-1", "running")]), vi.fn().mockReturnValue(stop.promise));
		await vi.waitFor(() => expect(fixture.store.currentRun()?.state).toBe("running"));
		const pending = fixture.store.requestStop();
		fixture.selected.set(_Detail("chat-2"));
		await _Settle();
		expect(fixture.store.stopPending()).toBe(false);
		stop.resolve();
		await expect(pending).resolves.toBe(false);
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
