// @vitest-environment jsdom

import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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
		await store.observe(run.runId, "conversation-1");

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
		await store.observe(run.runId, "conversation-1");

		expect(store.canRetry()).toBe(false);
		expect(store.canCancel()).toBe(canCancel);
		await store.retry("conversation-1");
		expect(gateway.retry).not.toHaveBeenCalled();
	});
});
