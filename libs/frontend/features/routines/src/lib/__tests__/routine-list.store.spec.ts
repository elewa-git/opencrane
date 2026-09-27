import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ROUTINE_GATEWAY, ROUTINE_SESSION, RoutineGatewayError, RoutineGatewayErrorKinds, RoutineStatus, type RoutineGateway, type RoutineListPage } from "@opencrane/state/routines";

import { RoutineReadStates } from "../routine-presentation.types";
import { RoutineListStore } from "../state/routine-list.store";

const _ITEM: RoutineListPage["items"][number] = { routineId: "routine-1", currentRevision: 2, status: RoutineStatus.Active, lifecycleRevision: 3, nextAutomaticOccurrence: "2026-09-28T09:00:00.000Z", ownership: "owner", destinationConversationId: "conversation-1", selectedManagedService: { managedServiceId: "service-1", displayName: "Research" }, schedule: { expression: "0 9 * * *", timezone: "UTC" }, lastAutomaticOccurrence: null, lastFiring: null, capabilities: { revise: true, pause: true, resume: false, retire: true, runNow: true } };

beforeAll(function _InitializeAngularTesting(): void
{
	TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
});

afterEach(function _ResetTestBed(): void
{
	TestBed.resetTestingModule();
});

describe("RoutineListStore", function _RoutineListStoreSuite()
{
	it("aborts a pending read when its route injector is destroyed", async function _DestroyAbortsRead()
	{
		const pending = _Deferred<RoutineListPage>();
		let requestSignal: AbortSignal | undefined;
		const gateway = _Gateway({ list: vi.fn((_query, signal) => { requestSignal = signal; return pending.promise; }) });
		const session = signal<string | null>("session-a");
		const store = _Store(gateway, session);
		const read = store.refresh();
		await _Settled();

		TestBed.resetTestingModule();
		pending.resolve(_Page());
		await read;

		expect(requestSignal?.aborted).toBe(true);
		expect(store.rows()).toEqual([]);
	});

	it("purges the old session before rejecting its late page", async function _SessionLateResponse()
	{
		const pending = _Deferred<RoutineListPage>();
		const gateway = _Gateway({ list: vi.fn().mockReturnValueOnce(pending.promise).mockReturnValue(new Promise<RoutineListPage>(() => undefined)) });
		const session = signal<string | null>("session-a");
		const store = _Store(gateway, session);
		const read = store.refresh();
		await _Settled();

		session.set("session-b");
		TestBed.tick();
		expect(store.rows()).toEqual([]);
		pending.resolve(_Page());
		await read;

		expect(store.rows()).toEqual([]);
		expect(store.state()).toBe(RoutineReadStates.Loading);
	});

	it("purges the protected projection after a current-session 401", async function _UnauthorizedPurge()
	{
		const gateway = _Gateway({ list: vi.fn().mockResolvedValueOnce(_Page()).mockRejectedValueOnce(new RoutineGatewayError(RoutineGatewayErrorKinds.Unauthenticated)) });
		const session = signal<string | null>("session-a");
		const store = _Store(gateway, session);
		await store.refresh();
		expect(store.rows()).toHaveLength(1);

		await store.refresh();

		expect(store.rows()).toEqual([]);
		expect(store.state()).toBe(RoutineReadStates.AccessChanged);
		expect(store.error()).toBeNull();
	});
});

function _Store(gateway: RoutineGateway, session: ReturnType<typeof signal<string | null>>): RoutineListStore
{
	TestBed.configureTestingModule({ providers: [RoutineListStore, { provide: ROUTINE_GATEWAY, useValue: gateway }, { provide: ROUTINE_SESSION, useValue: session }] });
	return TestBed.inject(RoutineListStore);
}

function _Gateway(overrides: Partial<RoutineGateway>): RoutineGateway
{
	const unavailable = vi.fn().mockRejectedValue(new Error("Unexpected gateway call"));
	return { list: unavailable, read: unavailable, firings: unavailable, creationOptions: unavailable, preview: unavailable, create: unavailable, revise: unavailable, pause: unavailable, resume: unavailable, retire: unavailable, runNow: unavailable, ...overrides };
}

function _Page(nextCursor?: string): RoutineListPage
{
	const page = { items: [_ITEM], limit: 20 };

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
