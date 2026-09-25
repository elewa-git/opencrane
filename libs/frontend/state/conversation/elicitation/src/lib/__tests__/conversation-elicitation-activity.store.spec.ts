// @vitest-environment jsdom

import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CONVERSATION_ELICITATION_VERSION, ElicitationBodyKinds, ElicitationPurposes, ElicitationRequestStates, type ConversationElicitation } from "@opencrane/contracts";

import { ConversationElicitationActivityStore } from "../conversation-elicitation-activity.store";
import { ConversationElicitationActivityReadStates } from "../conversation-elicitation-activity.types";
import { ElicitationGatewayError, ElicitationGatewayErrorKinds } from "../elicitation-gateway.errors";
import type { ConversationElicitationGateway } from "../elicitation-gateway.types";
import { ELICITATION_GATEWAY } from "../opencrane-conversation-elicitation.gateway";

/** Fixed clock used by deadline and polling tests. */
const _NOW = new Date("2026-09-25T10:00:00.000Z");

/** Build one browser-safe RuntimeInput request. */
function _Elicitation(overrides: Partial<ConversationElicitation> = {}): ConversationElicitation
{
	return { version: CONVERSATION_ELICITATION_VERSION, requestId: "request-1", conversationId: "conversation-1", runId: "run-1", attempt: 1, assignedParticipantId: "participant-other", purpose: ElicitationPurposes.RuntimeInput, state: ElicitationRequestStates.Requested, body: { kind: ElicitationBodyKinds.FreeText, prompt: "Which option should I use?", maximumLength: 200, allowEmpty: false }, requiresStepUp: false, requestedAt: "2026-09-25T09:59:00.000Z", expiresAt: "2099-09-25T10:05:00.000Z", ...overrides };
}

/** Create the component-scoped store and its narrow gateway double. */
function _Fixture()
{
	const gateway: ConversationElicitationGateway = { listOpen: vi.fn(), read: vi.fn(), respond: vi.fn(), listActivity: vi.fn().mockResolvedValue([_Elicitation()]) };
	TestBed.configureTestingModule({ providers: [ConversationElicitationActivityStore, { provide: ELICITATION_GATEWAY, useValue: gateway }] });
	return { gateway, store: TestBed.inject(ConversationElicitationActivityStore) };
}

/** Change jsdom visibility and notify the store. */
function _SetVisible(visible: boolean): void
{
	Object.defineProperty(document, "visibilityState", { configurable: true, value: visible ? "visible" : "hidden" });
	document.dispatchEvent(new Event("visibilitychange"));
}

/** Let resolved reads and their continuations settle. */
async function _Flush(): Promise<void> { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }

beforeAll(function _InitializeAngularTesting() { TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()); });
afterEach(function _Reset()
{
	vi.useRealTimers();
	Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
	TestBed.resetTestingModule();
});
afterAll(function _ResetAngularTesting() { TestBed.resetTestEnvironment(); });

describe("ConversationElicitationActivityStore", function _Suite()
{
	it("keeps refreshing beyond one minute without overlapping a pending read", async function _ContinuousNoOverlap()
	{
		vi.useFakeTimers();
		vi.setSystemTime(_NOW);
		const f = _Fixture();
		f.store.activate("session-a");
		await _Flush();
		await vi.advanceTimersByTimeAsync(65_000);
		expect(f.gateway.listActivity).toHaveBeenCalledTimes(14);

		let finish!: (value: readonly ConversationElicitation[]) => void;
		vi.mocked(f.gateway.listActivity).mockImplementationOnce(function _Pending() { return new Promise(function _Read(resolve) { finish = resolve; }); });
		await vi.advanceTimersByTimeAsync(5_000);
		await vi.advanceTimersByTimeAsync(30_000);
		expect(f.gateway.listActivity).toHaveBeenCalledTimes(15);
		finish([_Elicitation()]);
		await _Flush();
	});

	it("pauses and aborts while hidden, then reads immediately when visible", async function _Visibility()
	{
		vi.useFakeTimers();
		vi.setSystemTime(_NOW);
		const f = _Fixture();
		let finishHidden!: (value: readonly ConversationElicitation[]) => void;
		vi.mocked(f.gateway.listActivity).mockImplementationOnce(function _Pending() { return new Promise(function _Read(resolve) { finishHidden = resolve; }); }).mockResolvedValue([_Elicitation()]);
		f.store.activate("session-a");
		const firstSignal = vi.mocked(f.gateway.listActivity).mock.calls[0]?.[1];
		_SetVisible(false);
		expect(firstSignal?.aborted).toBe(true);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(f.gateway.listActivity).toHaveBeenCalledTimes(1);
		_SetVisible(true);
		await _Flush();
		expect(f.gateway.listActivity).toHaveBeenCalledTimes(2);
		finishHidden([_Elicitation()]);
		await _Flush();
	});

	it("drops a row at its deadline before the authority refresh settles", async function _Expiry()
	{
		vi.useFakeTimers();
		vi.setSystemTime(_NOW);
		const f = _Fixture();
		vi.mocked(f.gateway.listActivity).mockResolvedValueOnce([_Elicitation({ expiresAt: "2026-09-25T10:00:01.000Z" })]);
		f.store.activate("session-a");
		await _Flush();
		expect(f.store.pendingCount()).toBe(1);
		let finish!: (value: readonly ConversationElicitation[]) => void;
		vi.mocked(f.gateway.listActivity).mockImplementationOnce(function _Pending() { return new Promise(function _Read(resolve) { finish = resolve; }); });
		await vi.advanceTimersByTimeAsync(1_000);
		expect(f.store.rows()).toEqual([]);
		expect(f.store.pendingCount()).toBe(0);
		expect(f.gateway.listActivity).toHaveBeenCalledTimes(2);
		finish([]);
		await _Flush();
	});

	it("removes listeners and timers when its component injector is destroyed", async function _Cleanup()
	{
		vi.useFakeTimers();
		vi.setSystemTime(_NOW);
		const f = _Fixture();
		f.store.activate("session-a");
		await _Flush();
		TestBed.resetTestingModule();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(f.gateway.listActivity).toHaveBeenCalledTimes(1);
		_SetVisible(false);
		_SetVisible(true);
		expect(f.gateway.listActivity).toHaveBeenCalledTimes(1);
	});

	it("ignores an old session denial after a new session loads", async function _OldSessionDenial()
	{
		let rejectOld!: (error: unknown) => void;
		const oldRead = new Promise<readonly ConversationElicitation[]>(function _Pending(_resolve, reject) { rejectOld = reject; });
		const current = _Elicitation({ requestId: "request-current" });
		const f = _Fixture();
		vi.mocked(f.gateway.listActivity).mockReset().mockReturnValueOnce(oldRead).mockResolvedValueOnce([current]);
		f.store.activate("session-a");
		f.store.activate("session-b");
		await _Flush();
		rejectOld(new ElicitationGatewayError(ElicitationGatewayErrorKinds.Forbidden));
		await _Flush();
		expect(f.store.rows().map(row => row.id)).toEqual(["request-current"]);
		expect(f.store.readState()).toBe(ConversationElicitationActivityReadStates.Ready);
	});

	it("ignores an old session success after a new session loads", async function _OldSessionSuccess()
	{
		let finishOld!: (value: readonly ConversationElicitation[]) => void;
		const oldRead = new Promise<readonly ConversationElicitation[]>(function _Pending(resolve) { finishOld = resolve; });
		const current = _Elicitation({ requestId: "request-current" });
		const f = _Fixture();
		vi.mocked(f.gateway.listActivity).mockReset().mockReturnValueOnce(oldRead).mockResolvedValueOnce([current]);
		f.store.activate("session-a");
		f.store.activate("session-b");
		await _Flush();
		finishOld([_Elicitation({ requestId: "request-old" })]);
		await _Flush();
		expect(f.store.rows().map(row => row.id)).toEqual(["request-current"]);
		expect(f.store.readState()).toBe(ConversationElicitationActivityReadStates.Ready);
	});

	it("stops after access changes and allows an explicit same-session retry", async function _AccessRetry()
	{
		vi.useFakeTimers();
		vi.setSystemTime(_NOW);
		const f = _Fixture();
		vi.mocked(f.gateway.listActivity).mockReset().mockRejectedValueOnce(new ElicitationGatewayError(ElicitationGatewayErrorKinds.Forbidden)).mockResolvedValueOnce([_Elicitation()]);
		f.store.activate("session-a");
		await _Flush();
		expect(f.store.rows()).toEqual([]);
		expect(f.store.readState()).toBe(ConversationElicitationActivityReadStates.Error);
		expect(f.store.refreshAvailable()).toBe(true);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(f.gateway.listActivity).toHaveBeenCalledTimes(1);
		await f.store.refresh();
		expect(f.store.pendingCount()).toBe(1);
		expect(f.store.readState()).toBe(ConversationElicitationActivityReadStates.Ready);
	});

	it("clears private rows synchronously when the identity changes or deactivates", async function _IdentityPartition()
	{
		const f = _Fixture();
		f.store.activate("session-a");
		await _Flush();
		expect(f.store.pendingCount()).toBe(1);
		f.store.activate("session-b");
		expect(f.store.rows()).toEqual([]);
		f.store.deactivate();
		expect(f.store.readState()).toBe(ConversationElicitationActivityReadStates.Idle);
		expect(f.store.refreshAvailable()).toBe(false);
	});

	it("shows only Requested unexpired rows without filtering on assigned participant", async function _PendingProjection()
	{
		const f = _Fixture();
		vi.mocked(f.gateway.listActivity).mockResolvedValueOnce([_Elicitation({ assignedParticipantId: "peer-a" }), _Elicitation({ requestId: "answered", state: ElicitationRequestStates.Answered }), _Elicitation({ requestId: "expired", expiresAt: "2026-09-25T09:59:59.000Z" })]);
		f.store.activate("session-a");
		await _Flush();
		expect(f.store.rows().map(row => row.id)).toEqual(["request-1"]);
		expect(f.store.pendingCount()).toBe(1);
	});
});
