// @vitest-environment jsdom

import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CONVERSATION_ELICITATION_VERSION, ElicitationBodyKinds, ElicitationPurposes, ElicitationRequestStates, type ConversationElicitation, type ElicitationResponseProjection } from "@opencrane/contracts";

import { __MapToolActivity } from "../conversation-activity.mapper";
import { ConversationActivityKinds } from "../conversation-activity.types";
import { ConversationElicitationStore } from "../conversation-elicitation.store";
import { ElicitationGatewayError, ElicitationGatewayErrorKinds } from "../elicitation-gateway.errors";
import type { ConversationElicitationGateway } from "../elicitation-gateway.types";
import { ELICITATION_GATEWAY } from "../opencrane-conversation-elicitation.gateway";

/** Build one valid requested free-text projection. */
function _Elicitation(): ConversationElicitation
{
	return { version: CONVERSATION_ELICITATION_VERSION, requestId: "request-1", conversationId: "conversation-1", runId: "run-1", attempt: 1, assignedParticipantId: "user-1", purpose: ElicitationPurposes.RuntimeInput, state: ElicitationRequestStates.Requested, body: { kind: ElicitationBodyKinds.FreeText, prompt: "Which option should I use?", maximumLength: 200, allowEmpty: false }, requiresStepUp: false, requestedAt: "2026-08-11T08:00:00.000Z", expiresAt: "2099-08-11T09:00:00.000Z" };
}

/** Create a generated-port double for the component-scoped store. */
function _Gateway(): ConversationElicitationGateway
{
	return { listOpen: vi.fn().mockResolvedValue([]), read: vi.fn().mockResolvedValue(_Elicitation()), respond: vi.fn(), listActivity: vi.fn() };
}

beforeAll(function _InitializeAngularTesting()
{
	TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
	vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("response-key-1") });
});

afterAll(function _ResetAngularTesting()
{
	vi.unstubAllGlobals();
	TestBed.resetTestEnvironment();
});

afterEach(function _ResetTestBed() { vi.useRealTimers(); TestBed.resetTestingModule(); });

describe("ConversationElicitationStore", function _StoreSuite()
{
	it("retains the selected draft and recovery target when verified sign-in is required", async function _StepUpRecovery()
	{
		const gateway = _Gateway();
		vi.mocked(gateway.respond).mockRejectedValue(new ElicitationGatewayError(ElicitationGatewayErrorKinds.StepUpRequired, "/api/v1/auth/reauthenticate"));
		TestBed.configureTestingModule({ providers: [ConversationElicitationStore, { provide: ELICITATION_GATEWAY, useValue: gateway }] });
		const store = TestBed.inject(ConversationElicitationStore);
		await store.load("conversation-1", "request-1");
		store.select({ kind: ElicitationBodyKinds.FreeText, text: "Keep this answer" });

		await expect(store.submit()).resolves.toBe(false);
		expect(store.draft()).toEqual({ kind: ElicitationBodyKinds.FreeText, text: "Keep this answer" });
		expect(store.stepUpPath()).toBe("/api/v1/auth/reauthenticate");
		expect(store.restoreFocusRequestId()).toBe("request-1");

		await store.recoverAfterStepUp();
		expect(store.draft()).toEqual({ kind: ElicitationBodyKinds.FreeText, text: "Keep this answer" });
	});

	it("admits one response command and adopts only its authoritative terminal projection", async function _SingleCommand()
	{
		const gateway = _Gateway();
		let finish: ((projection: ElicitationResponseProjection) => void) | null = null;
		vi.mocked(gateway.respond).mockReturnValue(new Promise<ElicitationResponseProjection>(function _Hold(resolve) { finish = resolve; }));
		TestBed.configureTestingModule({ providers: [ConversationElicitationStore, { provide: ELICITATION_GATEWAY, useValue: gateway }] });
		const store = TestBed.inject(ConversationElicitationStore);
		await store.load("conversation-1", "request-1");
		store.select({ kind: ElicitationBodyKinds.FreeText, text: "Answer" });

		const first = store.submit();
		const duplicate = store.submit();
		expect(gateway.respond).toHaveBeenCalledTimes(1);
		if (finish === null)
			throw new Error("response completion was not captured");
		finish({ requestId: "request-1", state: ElicitationRequestStates.Answered, idempotent: false, resolvedAt: "2026-08-11T08:01:00.000Z" });
		await Promise.all([first, duplicate]);

		expect(store.elicitation()?.state).toBe(ElicitationRequestStates.Answered);
		expect(store.draft()).toBeNull();
	});

	it("keeps every failed tool attempt visible while a later retry is active", function _VisibleRetryFailure()
	{
		const rows = __MapToolActivity("conversation-1", "run-1", { id: "tool-call-1", name: "Search", failures: [{ retrying: true, technicalDetails: { toolIdentifier: "search", toolRevision: "r3", failureCategory: "authentication", providerCode: "invalid_token", httpStatus: 401, occurredAt: "2026-08-11T08:00:00.000Z", retryCount: 1, retryLimit: 3 } }] });

		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ kind: ConversationActivityKinds.ToolFailure, retrying: true, technicalDetails: { providerCode: "invalid_token", httpStatus: 401 } });
	});

	it("clears the selected response and recovery coordinates when conversation access ends", async function _ClearsDraft()
	{
		const gateway = _Gateway();
		TestBed.configureTestingModule({ providers: [ConversationElicitationStore, { provide: ELICITATION_GATEWAY, useValue: gateway }] });
		const store = TestBed.inject(ConversationElicitationStore);
		await store.load("conversation-1", "request-1");
		store.select({ kind: ElicitationBodyKinds.FreeText, text: "Private answer" });
		expect(store.draft()).not.toBeNull();

		store.clear();

		expect(store.elicitation()).toBeNull();
		expect(store.draft()).toBeNull();
		expect(store.stepUpPath()).toBeNull();
		expect(store.restoreFocusRequestId()).toBeNull();
	});

	it("clears private request state when open-request discovery loses access", async function _DiscoveryForbidden()
	{
		const gateway = _Gateway();
		vi.mocked(gateway.listOpen).mockResolvedValueOnce([_Elicitation()]).mockRejectedValueOnce(new ElicitationGatewayError(ElicitationGatewayErrorKinds.Forbidden));
		TestBed.configureTestingModule({ providers: [ConversationElicitationStore, { provide: ELICITATION_GATEWAY, useValue: gateway }] });
		const store = TestBed.inject(ConversationElicitationStore);
		await store.refresh("conversation-1");
		store.select({ kind: ElicitationBodyKinds.FreeText, text: "Private answer" });

		await store.refresh("conversation-1");

		expect(store.elicitation()).toBeNull();
		expect(store.draft()).toBeNull();
		expect(store.error()).toBeNull();
	});

	it("clears private request state when an exact request read loses access", async function _ExactReadForbidden()
	{
		const gateway = _Gateway();
		vi.mocked(gateway.read).mockResolvedValueOnce(_Elicitation()).mockRejectedValueOnce(new ElicitationGatewayError(ElicitationGatewayErrorKinds.Forbidden));
		TestBed.configureTestingModule({ providers: [ConversationElicitationStore, { provide: ELICITATION_GATEWAY, useValue: gateway }] });
		const store = TestBed.inject(ConversationElicitationStore);
		await store.load("conversation-1", "request-1");
		store.select({ kind: ElicitationBodyKinds.FreeText, text: "Private answer" });

		await store.load("conversation-1", "request-1");

		expect(store.elicitation()).toBeNull();
		expect(store.draft()).toBeNull();
		expect(store.error()).toBeNull();
	});

	it("discovers the oldest open request and preserves its draft on harmless refresh", async function _DiscoveryRefresh()
	{
		const gateway = _Gateway();
		vi.mocked(gateway.listOpen).mockResolvedValue([_Elicitation(), { ..._Elicitation(), requestId: "request-2" }]);
		TestBed.configureTestingModule({ providers: [ConversationElicitationStore, { provide: ELICITATION_GATEWAY, useValue: gateway }] });
		const store = TestBed.inject(ConversationElicitationStore);
		await store.refresh("conversation-1");
		store.select({ kind: ElicitationBodyKinds.FreeText, text: "Keep this answer" });
		await store.refresh("conversation-1");
		expect(store.elicitation()?.requestId).toBe("request-1");
		expect(store.draft()).toEqual({ kind: ElicitationBodyKinds.FreeText, text: "Keep this answer" });
	});

	it("re-reads the displayed request when discovery no longer reports it open", async function _TerminalReconciliation()
	{
		const gateway = _Gateway();
		vi.mocked(gateway.listOpen).mockResolvedValueOnce([_Elicitation()]).mockResolvedValueOnce([]);
		vi.mocked(gateway.read).mockResolvedValue({ ..._Elicitation(), state: ElicitationRequestStates.Expired, resolvedAt: "2026-08-11T09:00:00.000Z" });
		TestBed.configureTestingModule({ providers: [ConversationElicitationStore, { provide: ELICITATION_GATEWAY, useValue: gateway }] });
		const store = TestBed.inject(ConversationElicitationStore);
		await store.refresh("conversation-1");
		store.select({ kind: ElicitationBodyKinds.FreeText, text: "Too late" });
		await store.refresh("conversation-1");
		expect(gateway.read).toHaveBeenCalledWith("conversation-1", "request-1", expect.any(AbortSignal));
		expect(store.elicitation()?.state).toBe(ElicitationRequestStates.Expired);
		expect(store.draft()).toBeNull();
	});

	it("fences a late discovery result after the selected conversation changes", async function _StaleDiscovery()
	{
		const gateway = _Gateway();
		let finish: ((requests: readonly ConversationElicitation[]) => void) | null = null;
		vi.mocked(gateway.listOpen).mockReturnValueOnce(new Promise(function _Hold(resolve) { finish = resolve; })).mockResolvedValueOnce([]);
		TestBed.configureTestingModule({ providers: [ConversationElicitationStore, { provide: ELICITATION_GATEWAY, useValue: gateway }] });
		const store = TestBed.inject(ConversationElicitationStore);
		const stale = store.refresh("conversation-1");
		await store.refresh("conversation-2");
		if (finish === null)
			throw new Error("discovery completion was not captured");
		finish([_Elicitation()]);
		await stale;
		expect(store.elicitation()).toBeNull();
	});

	it("does not let an older discovery restore editable state over a terminal response", async function _BusyReadRace()
	{
		const gateway = _Gateway();
		let finishDiscovery: ((requests: readonly ConversationElicitation[]) => void) | null = null;
		let finishResponse: ((projection: ElicitationResponseProjection) => void) | null = null;
		vi.mocked(gateway.listOpen).mockResolvedValueOnce([_Elicitation()]).mockReturnValueOnce(new Promise(function _Hold(resolve) { finishDiscovery = resolve; }));
		vi.mocked(gateway.respond).mockReturnValue(new Promise(function _Hold(resolve) { finishResponse = resolve; }));
		TestBed.configureTestingModule({ providers: [ConversationElicitationStore, { provide: ELICITATION_GATEWAY, useValue: gateway }] });
		const store = TestBed.inject(ConversationElicitationStore);
		await store.refresh("conversation-1");
		store.select({ kind: ElicitationBodyKinds.FreeText, text: "Continue" });
		const staleRefresh = store.refresh("conversation-1");
		const submit = store.submit();
		if (finishDiscovery === null || finishResponse === null)
			throw new Error("controlled completions were not captured");
		finishDiscovery([_Elicitation()]);
		finishResponse({ requestId: "request-1", state: ElicitationRequestStates.Answered, idempotent: false, resolvedAt: "2026-08-11T08:01:00.000Z" });
		await Promise.all([staleRefresh, submit]);
		expect(store.elicitation()?.state).toBe(ElicitationRequestStates.Answered);
		expect(store.draft()).toBeNull();
	});

	it("keeps an uncertain mutation running while fencing its result after selection changes", async function _MutationSelectionFence()
	{
		const gateway = _Gateway();
		let finishResponse: ((projection: ElicitationResponseProjection) => void) | null = null;
		vi.mocked(gateway.respond).mockReturnValue(new Promise(function _Hold(resolve) { finishResponse = resolve; }));
		TestBed.configureTestingModule({ providers: [ConversationElicitationStore, { provide: ELICITATION_GATEWAY, useValue: gateway }] });
		const store = TestBed.inject(ConversationElicitationStore);
		await store.load("conversation-1", "request-1");
		store.select({ kind: ElicitationBodyKinds.FreeText, text: "Continue" });
		const pending = store.submit();
		store.clear();
		if (finishResponse === null)
			throw new Error("response completion was not captured");
		finishResponse({ requestId: "request-1", state: ElicitationRequestStates.Answered, idempotent: false, resolvedAt: "2026-08-11T08:01:00.000Z" });

		await expect(pending).resolves.toBe(false);
		expect(gateway.respond).toHaveBeenCalledTimes(1);
		expect(store.elicitation()).toBeNull();
		expect(store.busy()).toBe(false);
	});

	it("clears private request state when mutation reconciliation confirms access loss", async function _ReconciliationForbidden()
	{
		const gateway = _Gateway();
		vi.mocked(gateway.respond).mockRejectedValue(new ElicitationGatewayError(ElicitationGatewayErrorKinds.Unavailable));
		vi.mocked(gateway.read).mockResolvedValueOnce(_Elicitation()).mockRejectedValueOnce(new ElicitationGatewayError(ElicitationGatewayErrorKinds.Forbidden));
		TestBed.configureTestingModule({ providers: [ConversationElicitationStore, { provide: ELICITATION_GATEWAY, useValue: gateway }] });
		const store = TestBed.inject(ConversationElicitationStore);
		await store.load("conversation-1", "request-1");
		store.select({ kind: ElicitationBodyKinds.FreeText, text: "Private answer" });

		await expect(store.submit()).resolves.toBe(false);

		expect(store.elicitation()).toBeNull();
		expect(store.draft()).toBeNull();
		expect(store.error()).toBeNull();
	});

	it("performs one selected-request authority read at the response deadline", async function _DeadlineRefresh()
	{
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-08-11T08:00:00.000Z"));
		const gateway = _Gateway();
		const requested = { ..._Elicitation(), expiresAt: "2026-08-11T08:00:01.000Z" };
		vi.mocked(gateway.listOpen).mockResolvedValue([requested]);
		vi.mocked(gateway.read).mockResolvedValue({ ...requested, state: ElicitationRequestStates.Expired, resolvedAt: requested.expiresAt });
		TestBed.configureTestingModule({ providers: [ConversationElicitationStore, { provide: ELICITATION_GATEWAY, useValue: gateway }] });
		const store = TestBed.inject(ConversationElicitationStore);
		await store.refresh("conversation-1");
		await vi.advanceTimersByTimeAsync(1_000);
		expect(gateway.read).toHaveBeenCalledTimes(1);
		expect(store.elicitation()?.state).toBe(ElicitationRequestStates.Expired);
		expect(store.deadlineReached()).toBe(false);
	});

	it("does not poll when the one deadline read still reports the request open", async function _DeadlineReadIsBounded()
	{
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-08-11T08:00:00.000Z"));
		const gateway = _Gateway();
		const requested = { ..._Elicitation(), expiresAt: "2026-08-11T08:00:01.000Z" };
		vi.mocked(gateway.listOpen).mockResolvedValue([requested]);
		vi.mocked(gateway.read).mockResolvedValue(requested);
		TestBed.configureTestingModule({ providers: [ConversationElicitationStore, { provide: ELICITATION_GATEWAY, useValue: gateway }] });
		const store = TestBed.inject(ConversationElicitationStore);
		await store.refresh("conversation-1");
		store.select({ kind: ElicitationBodyKinds.FreeText, text: "Too late" });
		await vi.advanceTimersByTimeAsync(1_000);
		await vi.advanceTimersByTimeAsync(60_000);

		expect(gateway.read).toHaveBeenCalledTimes(1);
		expect(store.deadlineReached()).toBe(true);
		expect(store.canSubmit()).toBe(false);
	});
});
