import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ConversationAssetActionKinds } from "@opencrane/features/conversation-assets";
import { PLATFORM_BRIDGE, PreparedFileOpenCompletionOutcomes, PreparedFileOpenModes, type PlatformBridge, type PreparedFileOpenReservation } from "@opencrane/platform";
import { ConversationAssetContentCommandStates, ConversationAssetContentStore, ConversationAssetDisposition, type ConversationAssetContent } from "@opencrane/state/conversation/assets";

import { ConversationAssetContentCoordinator } from "../conversation-asset-content.coordinator";

/** Controlled promise for selection and destruction races. */
function _Deferred<Value>(): { readonly promise: Promise<Value>; readonly resolve: (value: Value) => void }
{
	let resolvePromise: ((value: Value) => void) | undefined;
	const promise = new Promise<Value>(function _Create(resolve) { resolvePromise = resolve; });
	return { promise, resolve: function _Resolve(value) { if (resolvePromise === undefined)
		throw new Error("Deferred promise is unavailable."); resolvePromise(value); } };
}

/** Verified content fixture returned by the scoped state owner. */
function _Content(disposition = ConversationAssetDisposition.Preview): ConversationAssetContent
{
	return { blob: new Blob(["brief"], { type: "application/pdf" }), displayName: "brief.pdf", mediaType: "application/pdf", byteLength: 5, disposition };
}

/** Build one coordinator around controlled state and platform ports. */
function _Coordinator(content: Partial<ConversationAssetContentStore>, platform: Partial<PlatformBridge>): ConversationAssetContentCoordinator
{
	const completeContent = {
		state: vi.fn().mockReturnValue(ConversationAssetContentCommandStates.Idle),
		disposition: vi.fn().mockReturnValue(ConversationAssetDisposition.Preview),
		read: vi.fn().mockResolvedValue(_Content()),
		markFailed: vi.fn(),
		...content
	};
	const completePlatform = {
		isDesktop: false,
		bindFolder: vi.fn(),
		openAuthenticationWindow: vi.fn(),
		prepareFileOpen: vi.fn(),
		...platform
	};
	TestBed.configureTestingModule({ providers: [ConversationAssetContentCoordinator, { provide: ConversationAssetContentStore, useValue: completeContent }, { provide: PLATFORM_BRIDGE, useValue: completePlatform }] });
	return TestBed.inject(ConversationAssetContentCoordinator);
}

/** Reservation with controlled completion outcome. */
function _Reservation(outcome = PreparedFileOpenCompletionOutcomes.Completed): PreparedFileOpenReservation
{
	return { complete: vi.fn().mockReturnValue(outcome), cancel: vi.fn() };
}

beforeAll(function _InitializeAngularTesting() { TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()); });
afterAll(function _ResetAngularTesting() { TestBed.resetTestEnvironment(); });
afterEach(function _ResetTestBed() { TestBed.resetTestingModule(); });

describe("ConversationAssetContentCoordinator", function _Suite()
{
	it("prepares Preview before awaiting bytes and completes with verified content", async function _Preview()
	{
		const order: string[] = [];
		const reservation = _Reservation();
		const read = vi.fn().mockImplementation(async function _Read() { order.push("read"); return _Content(); });
		const prepareFileOpen = vi.fn().mockImplementation(function _Prepare() { order.push("prepare"); return reservation; });
		const coordinator = _Coordinator({ read } as Partial<ConversationAssetContentStore>, { prepareFileOpen });

		await coordinator.open({ kind: ConversationAssetActionKinds.Preview, assetId: "asset-1" });

		expect(order).toEqual(["prepare", "read"]);
		expect(prepareFileOpen).toHaveBeenCalledWith(PreparedFileOpenModes.Preview);
		expect(reservation.complete).toHaveBeenCalledWith(expect.any(Blob), "brief.pdf");
		expect(reservation.cancel).not.toHaveBeenCalled();
	});

	it("does not read when the runtime refuses the synchronous reservation", async function _Blocked()
	{
		const read = vi.fn();
		const markFailed = vi.fn();
		const coordinator = _Coordinator({ read, markFailed } as Partial<ConversationAssetContentStore>, { prepareFileOpen: vi.fn().mockReturnValue(null) });

		await coordinator.open({ kind: ConversationAssetActionKinds.Preview, assetId: "asset-1" });

		expect(read).not.toHaveBeenCalled();
		expect(markFailed).toHaveBeenCalledWith("asset-1");
	});

	it("refuses a busy duplicate before preparing another browser action", async function _Duplicate()
	{
		const prepareFileOpen = vi.fn();
		const coordinator = _Coordinator({ state: vi.fn().mockReturnValue(ConversationAssetContentCommandStates.Loading) } as Partial<ConversationAssetContentStore>, { prepareFileOpen });

		await coordinator.open({ kind: ConversationAssetActionKinds.Open, assetId: "asset-1" });

		expect(prepareFileOpen).not.toHaveBeenCalled();
	});

	it("cancels a pending reservation immediately when selection scope clears", async function _ScopeClear()
	{
		const deferred = _Deferred<ConversationAssetContent | null>();
		const reservation = _Reservation();
		const coordinator = _Coordinator({ read: vi.fn().mockReturnValue(deferred.promise) } as Partial<ConversationAssetContentStore>, { prepareFileOpen: vi.fn().mockReturnValue(reservation) });
		const pending = coordinator.open({ kind: ConversationAssetActionKinds.Open, assetId: "asset-1" });

		coordinator.clear();
		expect(reservation.cancel).toHaveBeenCalledTimes(1);
		deferred.resolve(_Content());
		await pending;
		expect(reservation.complete).not.toHaveBeenCalled();
	});

	it("cancels after a denied or stale read without showing a second error", async function _ReadDenied()
	{
		const reservation = _Reservation();
		const markFailed = vi.fn();
		const coordinator = _Coordinator({ read: vi.fn().mockResolvedValue(null), markFailed } as Partial<ConversationAssetContentStore>, { prepareFileOpen: vi.fn().mockReturnValue(reservation) });

		await coordinator.open({ kind: ConversationAssetActionKinds.Open, assetId: "asset-1" });

		expect(reservation.cancel).toHaveBeenCalledTimes(1);
		expect(markFailed).not.toHaveBeenCalled();
	});

	it("never completes Preview when the authoritative disposition changes during the read", async function _ChangedDisposition()
	{
		const reservation = _Reservation();
		const markFailed = vi.fn();
		const coordinator = _Coordinator({ read: vi.fn().mockResolvedValue(_Content(ConversationAssetDisposition.Download)), markFailed } as Partial<ConversationAssetContentStore>, { prepareFileOpen: vi.fn().mockReturnValue(reservation) });

		await coordinator.open({ kind: ConversationAssetActionKinds.Preview, assetId: "asset-1" });

		expect(reservation.complete).not.toHaveBeenCalled();
		expect(reservation.cancel).toHaveBeenCalledTimes(1);
		expect(markFailed).toHaveBeenCalledWith("asset-1");
	});

	it("uses Download for an explicit download even when safe preview is available", async function _Download()
	{
		const reservation = _Reservation();
		const prepareFileOpen = vi.fn().mockReturnValue(reservation);
		const coordinator = _Coordinator({}, { prepareFileOpen });

		await coordinator.open({ kind: ConversationAssetActionKinds.Download, assetId: "asset-1" });

		expect(prepareFileOpen).toHaveBeenCalledWith(PreparedFileOpenModes.Download);
		expect(reservation.complete).toHaveBeenCalledOnce();
	});

	it("shows a scoped failure when a prepared action expires before completion", async function _Expired()
	{
		const reservation = _Reservation(PreparedFileOpenCompletionOutcomes.Unavailable);
		const markFailed = vi.fn();
		const coordinator = _Coordinator({ markFailed } as Partial<ConversationAssetContentStore>, { prepareFileOpen: vi.fn().mockReturnValue(reservation) });

		await coordinator.open({ kind: ConversationAssetActionKinds.Open, assetId: "asset-1" });

		expect(markFailed).toHaveBeenCalledWith("asset-1");
	});
});
