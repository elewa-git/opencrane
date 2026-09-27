import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ROUTINE_GATEWAY, ROUTINE_SESSION, RoutineFiringDisposition, RoutineFiringTrigger, RoutineStatus, type RoutineDetails, type RoutineFiringPage, type RoutineGateway as RoutineGatewayPort } from "@opencrane/state/routines";

import { RoutineReadStates } from "../routine-presentation.types";
import { RoutineDetailStore } from "../state/routine-detail.store";
import { RoutineHistoryStore } from "../state/routine-history.store";

const _DETAIL = (routineId: string): RoutineDetails => ({ routineId, currentRevision: 2, status: RoutineStatus.Active, lifecycleRevision: 3, ownership: "owner", destinationConversationId: "conversation-1", selectedManagedService: { managedServiceId: "service-1", displayName: "Research" }, schedule: { expression: "0 9 * * *", timezone: "UTC" }, lastAutomaticOccurrence: null, nextAutomaticOccurrence: "2026-09-28T09:00:00.000Z", lastFiring: null, capabilities: { revise: true, pause: true, resume: false, retire: true, runNow: true }, audienceParticipantRefs: ["participant-self"], audienceChoices: [{ participantRef: "participant-self", displayName: "You", isSelf: true }], instruction: "Review the conversation." });

const _FIRING = (firingId: string) => ({ firingId, routineRevision: 2, trigger: RoutineFiringTrigger.Manual, disposition: RoutineFiringDisposition.Completed, scheduledSlot: null, createdAt: "2026-09-27T09:00:00.000Z", finishedAt: "2026-09-27T09:01:00.000Z", reason: null, runTerminalReason: "success" as const, resultConversationId: "conversation-result", actualCost: null });

beforeAll(function _InitializeAngularTesting(): void
{
	TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
});

afterEach(function _ResetTestBed(): void
{
	TestBed.resetTestingModule();
});

describe("RoutineDetailStore", function _RoutineDetailStoreSuite()
{
	it("fences a late response after the route target changes", async function _TargetLateResponse()
	{
		const first = _Deferred<RoutineDetails>();
		const second = _Deferred<RoutineDetails>();
		const gateway = _Gateway({ read: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) });
		const store = _DetailStore(gateway);

		store.start("routine-1");
		await _Settled();
		store.start("routine-2");
		first.resolve(_DETAIL("routine-1"));
		second.resolve(_DETAIL("routine-2"));
		await _Settled();

		expect(store.authorizedDetail()?.routineId).toBe("routine-2");
	});

	it("purges and fences a late response after the session changes", async function _SessionLateResponse()
	{
		const pending = _Deferred<RoutineDetails>();
		const gateway = _Gateway({ read: vi.fn().mockReturnValueOnce(pending.promise).mockReturnValue(new Promise<RoutineDetails>(() => undefined)) });
		const session = signal<string | null>("session-a");
		const store = _DetailStore(gateway, session);

		store.start("routine-1");
		await _Settled();
		session.set("session-b");
		TestBed.tick();
		pending.resolve(_DETAIL("routine-1"));
		await _Settled();

		expect(store.authorizedDetail()).toBeNull();
		expect(store.state()).toBe(RoutineReadStates.Loading);
	});
});

describe("RoutineHistoryStore", function _RoutineHistoryStoreSuite()
{
	it("fences a late response after the route target changes", async function _TargetLateResponse()
	{
		const first = _Deferred<RoutineFiringPage>();
		const second = _Deferred<RoutineFiringPage>();
		const gateway = _Gateway({ firings: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) });
		const store = _HistoryStore(gateway);

		store.start("routine-1");
		await _Settled();
		store.start("routine-2");
		first.resolve(_Page("firing-old"));
		second.resolve(_Page("firing-new"));
		await _Settled();

		expect(store.rows().map(row => row.firingId)).toEqual(["firing-new"]);
	});

	it("purges and fences a late response after the session changes", async function _SessionLateResponse()
	{
		const pending = _Deferred<RoutineFiringPage>();
		const gateway = _Gateway({ firings: vi.fn().mockReturnValueOnce(pending.promise).mockReturnValue(new Promise<RoutineFiringPage>(() => undefined)) });
		const session = signal<string | null>("session-a");
		const store = _HistoryStore(gateway, session);

		store.start("routine-1");
		await _Settled();
		session.set("session-b");
		TestBed.tick();
		pending.resolve(_Page("firing-old"));
		await _Settled();

		expect(store.rows()).toEqual([]);
		expect(store.state()).toBe(RoutineReadStates.Loading);
	});

	it("appends sparse continuation rows and preserves the terminal cursor state", async function _SparseContinuation()
	{
		const gateway = _Gateway({ firings: vi.fn().mockResolvedValueOnce(_Page("firing-first", "cursor-1")).mockResolvedValueOnce(_Page("firing-second")) });
		const store = _HistoryStore(gateway);

		store.start("routine-1");
		await _Settled();
		store.loadMore();
		await _Settled();

		expect(store.rows().map(row => row.firingId)).toEqual(["firing-first", "firing-second"]);
		expect(store.hasMore()).toBe(false);
		expect(gateway.firings).toHaveBeenNthCalledWith(2, "routine-1", { cursor: "cursor-1", limit: 20 }, expect.any(AbortSignal));
	});
});

function _DetailStore(gateway: RoutineGatewayPort, session = signal<string | null>("session-a")): RoutineDetailStore
{
	TestBed.configureTestingModule({ providers: [RoutineDetailStore, { provide: ROUTINE_GATEWAY, useValue: gateway }, { provide: ROUTINE_SESSION, useValue: session }] });
	return TestBed.inject(RoutineDetailStore);
}

function _HistoryStore(gateway: RoutineGatewayPort, session = signal<string | null>("session-a")): RoutineHistoryStore
{
	TestBed.configureTestingModule({ providers: [RoutineHistoryStore, { provide: ROUTINE_GATEWAY, useValue: gateway }, { provide: ROUTINE_SESSION, useValue: session }] });
	return TestBed.inject(RoutineHistoryStore);
}

function _Gateway(overrides: Partial<RoutineGatewayPort>): RoutineGatewayPort
{
	const unavailable = vi.fn().mockRejectedValue(new Error("Unexpected gateway call"));
	return { list: unavailable, read: unavailable, firings: unavailable, creationOptions: unavailable, preview: unavailable, create: unavailable, revise: unavailable, pause: unavailable, resume: unavailable, retire: unavailable, runNow: unavailable, ...overrides };
}

function _Page(firingId: string, nextCursor?: string): RoutineFiringPage
{
	const page = { items: [_FIRING(firingId)], limit: 20 };

	return nextCursor === undefined ? page : { ...page, nextCursor };
}

function _Deferred<T>(): { readonly promise: Promise<T>; resolve(value: T): void }
{
	let resolvePromise: ((value: T) => void) | null = null;
	const promise = new Promise<T>(resolve => { resolvePromise = resolve; });
	return { promise, resolve(value: T): void { resolvePromise?.(value); } };
}

async function _Settled(): Promise<void>
{
	await Promise.resolve();
	await Promise.resolve();
}
