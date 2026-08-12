// @vitest-environment jsdom

import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { AgUiRunStatuses } from "@opencrane/state/conversation/ag-ui";

import { CONVERSATION_WORKSPACE_GATEWAY } from "../conversation-workspace.gateway.js";
import { ConversationRunStore } from "../conversation-run.store.js";
import { ConversationRunStates, type ConversationRun, type ConversationWorkspaceGateway } from "../conversation-workspace.types.js";

/** Build the smallest gateway double needed by run-state tests. */
function _Gateway(run: ConversationRun): ConversationWorkspaceGateway
{
	return {
		directory: vi.fn(), list: vi.fn(), open: vi.fn(), create: vi.fn(), send: vi.fn(), archive: vi.fn(), close: vi.fn(),
		run: vi.fn().mockResolvedValue(run), steer: vi.fn(), cancel: vi.fn(), retry: vi.fn()
	};
}

/** Inject one component-scoped run store against a controlled gateway. */
function _Store(gateway: ConversationWorkspaceGateway): ConversationRunStore
{
	TestBed.configureTestingModule({ providers: [ConversationRunStore, { provide: CONVERSATION_WORKSPACE_GATEWAY, useValue: gateway }] });
	return TestBed.inject(ConversationRunStore);
}

beforeAll(function _InitializeAngularTesting()
{
	TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
	vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("retry-key") });
});
afterAll(function _ResetAngularTesting() { vi.unstubAllGlobals(); TestBed.resetTestEnvironment(); });
afterEach(function _ResetTestBed() { TestBed.resetTestingModule(); });

describe("ConversationRunStore terminal states", function _RunStateSuite()
{
	it("keeps a failed run visible when the explicit retry is refused", async function _RetryRefusal()
	{
		const run = { runId: "run-1", attempt: 2, state: ConversationRunStates.Failed, conversationId: "conversation-1" };
		const gateway = _Gateway(run);
		vi.mocked(gateway.retry).mockRejectedValue(new Error("refused"));
		const store = _Store(gateway);
		await store.observe(run.runId, "conversation-1", AgUiRunStatuses.Failed);

		expect(store.canRetry()).toBe(true);
		await store.retry("conversation-1");

		expect(gateway.retry).toHaveBeenCalledWith({ conversationId: "conversation-1", runId: "run-1", expectedAttempt: 2, idempotencyKey: "retry-key" });
		expect(store.run()?.state).toBe(ConversationRunStates.Failed);
		expect(store.error()).toBe("OpenCrane could not retry this run.");
	});

	it.each([[ConversationRunStates.Cancelled, false], [ConversationRunStates.RecoveryRequired, true]] as const)("offers no unsafe retry for %s", async function _NoRetry(state, canCancel)
	{
		const run = { runId: "run-1", attempt: 2, state, conversationId: "conversation-1" };
		const gateway = _Gateway(run);
		const store = _Store(gateway);
		await store.observe(run.runId, "conversation-1", AgUiRunStatuses.Failed);

		expect(store.canRetry()).toBe(false);
		expect(store.canCancel()).toBe(canCancel);
		await store.retry("conversation-1");
		expect(gateway.retry).not.toHaveBeenCalled();
	});

	it("refreshes one logical run when its streamed lifecycle becomes terminal", async function _RefreshTerminalLifecycle()
	{
		const running = { runId: "run-1", attempt: 1, state: ConversationRunStates.Running, conversationId: "conversation-1" };
		const failed = { ...running, state: ConversationRunStates.Failed };
		const gateway = _Gateway(running);
		vi.mocked(gateway.run).mockResolvedValueOnce(running).mockResolvedValueOnce(failed);
		const store = _Store(gateway);

		await store.observe(running.runId, "conversation-1", AgUiRunStatuses.Running);
		await store.observe(running.runId, "conversation-1", AgUiRunStatuses.Failed);

		expect(gateway.run).toHaveBeenCalledTimes(2);
		expect(store.run()?.state).toBe(ConversationRunStates.Failed);
		expect(store.canRetry()).toBe(true);
	});

	it("retries a failed status read for the same streamed lifecycle", async function _RetryStatusRead()
	{
		const run = { runId: "run-1", attempt: 1, state: ConversationRunStates.Running, conversationId: "conversation-1" };
		const gateway = _Gateway(run);
		vi.mocked(gateway.run).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(run);
		const store = _Store(gateway);

		await store.observe(run.runId, "conversation-1", AgUiRunStatuses.Running);
		await store.observe(run.runId, "conversation-1", AgUiRunStatuses.Running);

		expect(gateway.run).toHaveBeenCalledTimes(2);
		expect(store.run()).toEqual(run);
	});

	it("reuses the exact steering command after an ambiguous response", async function _RetrySteering()
	{
		const run = { runId: "run-1", attempt: 1, state: ConversationRunStates.Running, conversationId: "conversation-1" };
		const gateway = _Gateway(run);
		vi.mocked(gateway.steer).mockRejectedValueOnce(new Error("connection reset after commit")).mockResolvedValueOnce(undefined);
		const store = _Store(gateway);
		await store.observe(run.runId, "conversation-1", AgUiRunStatuses.Running);
		store.updateSteeringDraft("Focus on risks");

		await store.steer();
		await store.steer();

		expect(gateway.steer).toHaveBeenCalledTimes(2);
		expect(vi.mocked(gateway.steer).mock.calls[1]?.[0]).toEqual(vi.mocked(gateway.steer).mock.calls[0]?.[0]);
		expect(store.steeringDraft()).toBe("");
	});
});
