import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CONVERSATION_ELICITATION_VERSION, ElicitationBodyKinds, ElicitationPurposes, ElicitationRequestStates, type ConversationElicitation } from "@opencrane/contracts";
import { ConversationActivityKinds, ConversationElicitationActivityStore, ConversationElicitationStore, type ConversationActivityRow, type ConversationActivityTarget } from "@opencrane/state/conversation/elicitation";
import { CONVERSATION_CURRENT_SUBJECT, ConversationWorkspaceRouteStates, ConversationWorkspaceStore } from "@opencrane/state/conversation/workspace";

import { ConversationWorkspaceElicitationCoordinator } from "../conversation-workspace-elicitation.coordinator";

/** Controlled promise used to order navigation races. */
function _Deferred<Value>(): { readonly promise: Promise<Value>; readonly resolve: (value: Value) => void }
{
	let resolvePromise: ((value: Value) => void) | null = null;
	const promise = new Promise<Value>(function _Create(resolve) { resolvePromise = resolve; });
	return { promise, resolve: function _Resolve(value) { if (resolvePromise === null)
		throw new Error("Deferred promise is unavailable."); resolvePromise(value); } };
}

/** Build one Activity target. */
function _Target(requestId = "request-1", conversationId = "conversation-1", runId = "run-1"): ConversationActivityTarget
{
	return { conversationId, runId, requestId };
}

/** Build the canonical row which admits one target selection. */
function _Row(target: ConversationActivityTarget): ConversationActivityRow
{
	return { kind: ConversationActivityKinds.Elicitation, id: target.requestId!, label: "Which option should I use?", occurredAt: "2026-09-25T10:00:00.000Z", status: ElicitationRequestStates.Requested, target };
}

/** Build one authoritative exact-request projection. */
function _Elicitation(target: ConversationActivityTarget, runId = target.runId): ConversationElicitation
{
	return { version: CONVERSATION_ELICITATION_VERSION, requestId: target.requestId!, conversationId: target.conversationId, runId, attempt: 1, assignedParticipantId: "participant-1", purpose: ElicitationPurposes.RuntimeInput, state: ElicitationRequestStates.Requested, body: { kind: ElicitationBodyKinds.FreeText, prompt: "Which option should I use?", maximumLength: 200, allowEmpty: false }, requiresStepUp: false, requestedAt: "2026-09-25T10:00:00.000Z", expiresAt: "2099-09-25T11:00:00.000Z" };
}

/** Build the coordinator around signal-backed state doubles. */
function _Fixture(selectedConversationId = "conversation-1")
{
	const subject = signal<string | null>("subject-1");
	const routeState = signal(ConversationWorkspaceRouteStates.Ready);
	const selected = signal<{ readonly id: string } | null>({ id: selectedConversationId });
	const live = signal({ entries: [] as readonly never[] });
	const target = _Target();
	const rows = signal<readonly ConversationActivityRow[]>([_Row(target)]);
	const projection = signal<ConversationElicitation | null>(null);
	const elicitationError = signal<string | null>(null);
	let elicitationScope = 0;
	const elicitation = {
		elicitation: projection,
		error: elicitationError,
		clear: vi.fn(function _Clear() { elicitationScope += 1; projection.set(null); elicitationError.set(null); }),
		refresh: vi.fn().mockResolvedValue(undefined),
		load: vi.fn(async function _Load(conversationId: string, requestId: string)
		{
			const scope = elicitationScope;
			await Promise.resolve();
			if (scope === elicitationScope)
			{
				const current = rows().find(row => row.kind === ConversationActivityKinds.Elicitation && row.target.conversationId === conversationId && row.target.requestId === requestId);
				projection.set(_Elicitation(current?.target ?? _Target(requestId, conversationId)));
			}
		}),
	};
	const activity = { rows, activate: vi.fn(), deactivate: vi.fn(), refresh: vi.fn().mockResolvedValue(undefined) };
	const workspace = {
		routeState,
		selected,
		live,
		open: vi.fn(async function _Open(conversationId: string) { selected.set({ id: conversationId }); }),
	};
	TestBed.configureTestingModule({ providers: [ConversationWorkspaceElicitationCoordinator, { provide: CONVERSATION_CURRENT_SUBJECT, useValue: subject }, { provide: ConversationWorkspaceStore, useValue: workspace }, { provide: ConversationElicitationStore, useValue: elicitation }, { provide: ConversationElicitationActivityStore, useValue: activity }] });
	const coordinator = TestBed.inject(ConversationWorkspaceElicitationCoordinator);
	TestBed.flushEffects();
	vi.mocked(elicitation.clear).mockClear();
	vi.mocked(elicitation.refresh).mockClear();
	vi.mocked(elicitation.load).mockClear();
	vi.mocked(activity.activate).mockClear();
	vi.mocked(activity.deactivate).mockClear();
	vi.mocked(activity.refresh).mockClear();
	vi.mocked(workspace.open).mockClear();
	return { activity, coordinator, elicitation, elicitationError, live, projection, routeState, rows, selected, subject, target, workspace, nextElicitationScope: function _NextScope() { elicitationScope += 1; }, currentElicitationScope: function _CurrentScope() { return elicitationScope; } };
}

beforeAll(function _InitializeAngularTesting() { TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()); });
afterEach(function _ResetTestBed() { TestBed.resetTestingModule(); });
afterAll(function _ResetAngularTesting() { TestBed.resetTestEnvironment(); });

describe("ConversationWorkspaceElicitationCoordinator", function _Suite()
{
	it("loads the exact current Activity request without falling back to oldest discovery", async function _ExactRequest()
	{
		const f = _Fixture();
		await expect(f.coordinator.open(f.target)).resolves.toBe(true);
		expect(f.elicitation.load).toHaveBeenCalledWith("conversation-1", "request-1");
		expect(f.elicitation.refresh).not.toHaveBeenCalled();
		expect(f.coordinator.focusRequest()).toEqual(f.target);
	});

	it("refuses a target which is no longer in the current Activity rows", async function _CurrentRowRequired()
	{
		const f = _Fixture();
		f.rows.set([]);
		await expect(f.coordinator.open(f.target)).resolves.toBe(false);
		expect(f.workspace.open).not.toHaveBeenCalled();
		expect(f.elicitation.load).not.toHaveBeenCalled();
		expect(f.coordinator.navigationError()).toContain("no longer available");
	});

	it("rejects an exact request returned for the wrong run", async function _WrongRun()
	{
		const f = _Fixture();
		vi.mocked(f.elicitation.load).mockImplementationOnce(async function _WrongRun() { f.projection.set(_Elicitation(f.target, "run-other")); });
		await expect(f.coordinator.open(f.target)).resolves.toBe(false);
		expect(f.coordinator.focusRequest()).toBeNull();
		expect(f.coordinator.navigationError()).toContain("no longer available");
	});

	it("drops an exact read when the subject loses access while it is pending", async function _SubjectLoss()
	{
		const f = _Fixture();
		const pending = _Deferred<void>();
		vi.mocked(f.elicitation.load).mockImplementationOnce(async function _Pending() { await pending.promise; f.projection.set(_Elicitation(f.target)); });
		const opened = f.coordinator.open(f.target);
		f.subject.set(null);
		TestBed.flushEffects();
		pending.resolve();
		await expect(opened).resolves.toBe(false);
		expect(f.activity.deactivate).toHaveBeenCalledOnce();
		expect(f.coordinator.focusRequest()).toBeNull();
	});

	it("drops an exact read when workspace access ends while it is pending", async function _WorkspaceAccessLoss()
	{
		const f = _Fixture();
		const pending = _Deferred<void>();
		vi.mocked(f.elicitation.load).mockImplementationOnce(async function _Pending() { await pending.promise; f.projection.set(_Elicitation(f.target)); });
		const opened = f.coordinator.open(f.target);
		f.routeState.set(ConversationWorkspaceRouteStates.AccessChanged);
		TestBed.flushEffects();
		pending.resolve();
		await expect(opened).resolves.toBe(false);
		expect(f.activity.deactivate).toHaveBeenCalledOnce();
		expect(f.coordinator.focusRequest()).toBeNull();
	});

	it("allows only the newer of two exact targets to adopt focus", async function _TwoTargetRace()
	{
		const f = _Fixture();
		const firstTarget = f.target;
		const secondTarget = _Target("request-2");
		f.rows.set([_Row(firstTarget), _Row(secondTarget)]);
		const first = _Deferred<void>();
		const second = _Deferred<void>();
		let loadOrdinal = 0;
		vi.mocked(f.elicitation.load).mockImplementation(async function _Load(conversationId: string, requestId: string)
		{
			loadOrdinal += 1;
			const ordinal = loadOrdinal;
			const scope = f.currentElicitationScope();
			await (ordinal === 1 ? first.promise : second.promise);
			if (scope === f.currentElicitationScope())
				f.projection.set(_Elicitation(_Target(requestId, conversationId)));
		});
		const firstOpen = f.coordinator.open(firstTarget);
		const secondOpen = f.coordinator.open(secondTarget);
		second.resolve();
		await expect(secondOpen).resolves.toBe(true);
		first.resolve();
		await expect(firstOpen).resolves.toBe(false);
		expect(f.coordinator.focusRequest()).toEqual(secondTarget);
	});

	it("cancels a same-conversation exact read when ordinary navigation takes over", async function _SameConversationCancellation()
	{
		const f = _Fixture();
		const pending = _Deferred<void>();
		vi.mocked(f.elicitation.load).mockImplementationOnce(async function _Pending()
		{
			const startingScope = f.currentElicitationScope();
			await pending.promise;
			if (startingScope === f.currentElicitationScope())
				f.projection.set(_Elicitation(f.target));
		});
		const opened = f.coordinator.open(f.target);
		f.coordinator.cancelNavigation();
		expect(f.elicitation.clear).toHaveBeenCalledTimes(2);
		pending.resolve();
		await expect(opened).resolves.toBe(false);
		expect(f.projection()).toBeNull();
		expect(f.coordinator.focusRequest()).toBeNull();
	});

	it("keeps oldest discovery suspended while workspace.open publishes the target selection", async function _WorkspaceOpenOrdering()
	{
		const target = _Target("request-2", "conversation-2", "run-2");
		const f = _Fixture("conversation-1");
		f.rows.set([_Row(target)]);
		vi.mocked(f.workspace.open).mockImplementationOnce(async function _Open()
		{
			f.selected.set({ id: target.conversationId });
			TestBed.flushEffects();
			expect(f.elicitation.refresh).not.toHaveBeenCalled();
		});
		await expect(f.coordinator.open(target)).resolves.toBe(true);
		expect(f.elicitation.load).toHaveBeenCalledWith("conversation-2", "request-2");
		expect(f.coordinator.focusRequest()).toEqual(target);
	});
});
